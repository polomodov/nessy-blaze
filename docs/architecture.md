# Blaze Architecture (Client-Server v1)

Этот документ описывает актуальную архитектуру проекта в режиме client-server (HTTP-only transport).

## 1. Контекст и границы

### 1.1 Цель

Blaze предоставляет workspace, где пользователь:

- создает/выбирает проект;
- отправляет запрос в чат;
- получает стриминговый ответ модели;
- применяет предложенные изменения;
- видит результат в live preview.

### 1.2 Границы v1

В active runtime path остаются только core-сценарии:

- auth + tenant scope;
- app/chat/proposal/preview lifecycle;
- user settings, необходимые для web UI.

Legacy/compatibility поверхности (desktop-only, local-agent/MCP entry points, интеграционные ветки вне core flow) не должны быть активной частью HTTP v1 контракта.

## 2. Runtime topology

### 2.1 Frontend runtime

- Entry: `src/renderer.tsx`
- Routing: `src/router.ts`, `src/routes/*`
- Shell: `src/app/layout.tsx`
- Main workspace UI: `src/components/workspace/*`

Frontend работает как SPA:

- TanStack Router для маршрутов (`/auth`, `/`);
- TanStack Query + Jotai для состояния и кэшей;
- `IpcClient` как фасад вызовов бэкенда.

### 2.2 Backend runtime

В dev-режиме backend поднимается внутри Vite через плагин `ipcHttpGatewayPlugin` в `vite.renderer.config.mts`:

- `src/http/api_v1_middleware.ts` (REST contract);
- `src/http/chat_stream_middleware.ts` (SSE stream);
- `src/http/chat_ws_server.ts` (WS stream/cancel, feature-flagged);
- `src/http/ipc_http_gateway.ts` (domain handlers).

### 2.3 Data/runtime dependencies

- PostgreSQL + drizzle (`src/db/index.ts`, `src/db/schema.ts`);
- локальная файловая система для app workspaces (`~/blaze-apps/*`);
- системные subprocess для preview run/restart;
- AI provider APIs через настройки/env.

## 3. Layered architecture

### 3.1 UI layer

Ключевые экраны/блоки:

- `BlazeSidebar` (тенант, список проектов, базовые действия);
- `BlazeChatArea` (чат, history, approve/reject, stream UX);
- `BlazePreviewPanel` (run/stop/restart preview, route/device controls, autofix triggers).

### 3.2 Client transport layer

- `src/ipc/backend_client.ts`:
  - маппит channel names на scoped HTTP endpoints (`/api/v1/orgs/:orgId/workspaces/:workspaceId/...`);
  - добавляет auth/dev headers;
  - обрабатывает retriable сетевые ошибки и auth-session-expired.
- `src/ipc/ipc_client.ts`:
  - предоставляет типизированный API для UI;
  - содержит логику SSE streaming, cancel, normalize response payloads.

### 3.3 HTTP contract layer

- `src/http/api_v1_middleware.ts`:

  - strict routing + payload validation;
  - reject unsupported top-level keys;
  - resolve tenant/auth context и прокидывание в gateway.

- `src/http/chat_stream_payload_validation.ts`:
  - отдельная строгая валидация stream payload (prompt, redo, attachments, selectedComponents).

### 3.4 Domain/service layer

- `src/http/ipc_http_gateway.ts`:

  - основной orchestration слой по каналам (apps, chats, proposals, preview, settings, auth);
  - работа с БД, git, файловой системой, quota/audit.

- `src/http/scoped_repositories.ts`:

  - tenant-safe query helpers.

- `src/http/request_context.ts`:
  - JWT/dev-bypass identity resolution;
  - upsert user + org/workspace membership resolution;
  - RBAC checks for mutations.

### 3.5 AI orchestration and apply layer

- `src/ipc/handlers/chat_stream_handlers.ts`:

  - формирует контекст (codebase + history + selected components);
  - запускает `streamText`;
  - стримит chunk events в SSE/WS sinks;
  - финализирует сообщение и решает auto-apply/manual flow.

- `src/ipc/processors/response_processor.ts`:
  - парсит `<blaze-*>` action tags;
  - применяет write/rename/delete/search-replace/dependency changes;
  - коммитит изменения в git;
  - сохраняет статус применения.

## 4. Ключевые потоки

### 4.1 Standard REST request

1. UI вызывает `IpcClient`.
2. `BackendClient` преобразует channel в HTTP route.
3. `api_v1_middleware` валидирует payload и route params.
4. `resolveRequestContext` определяет tenant+identity.
5. `invokeIpcChannelOverHttp` выполняет handler в `ipc_http_gateway`.
6. Ответ возвращается в envelope `{ data: ... }` или `204`.

### 4.2 Chat stream (SSE/WS)

1. UI вызывает `IpcClient.streamMessage(...)`.
2. SSE POST на scoped `/chats/:chatId/stream` (или WS start message).
3. Middleware валидирует payload + tenant scope.
4. `handleChatStreamRequest`:
   - добавляет user message;
   - создает assistant placeholder;
   - стримит `chat:response:chunk`.
5. На финале:
   - сохраняется итоговый assistant response;
   - при auto-apply вызывается `processFullResponseActions`;
   - отправляется `chat:response:end`.

### 4.3 Proposal lifecycle

- Read proposal: derive из последнего assistant message.
- Approve:
  - validate message ownership/scope;
  - apply actions через `response_processor`;
  - mark approval state.
- Reject:
  - mark `approvalState = rejected`.

### 4.4 Preview lifecycle

- `run-app`:

  - резолвит app path и команды;
  - поднимает subprocess dev server;
  - запускает proxy worker;
  - возвращает `previewUrl` + `originalUrl`.

- `stop-app`:

  - завершает процесс приложения и proxy.

- `restart-app`:
  - stop + optional `removeNodeModules` + start.

## 5. Tenant and auth model

### 5.1 Identity sources

- Bearer JWT (`Authorization`).
- Dev bypass headers (`x-blaze-dev-*`) при `AUTH_DEV_BYPASS_ENABLED=true` и non-production.

### 5.2 Tenant scope

Все core endpoints scoped:

- `/api/v1/orgs/:orgId/workspaces/:workspaceId/...`

Fallback defaults в клиенте:

- `orgId = me`, `workspaceId = me` (если не задано явно).

### 5.3 RBAC

Mutation operations требуют роли выше `viewer` (см. `requireRoleForMutation`).

## 6. Persistence model (high-level)

Ключевые сущности:

- `users`, `organizations`, `workspaces`;
- memberships (`organization_memberships`, `workspace_memberships`);
- `apps`, `chats`, `messages`, `versions`;
- `language_model_providers`, `language_models`;
- `audit_events`, `usage_events`, quotas.

Принцип:

- tenant columns (`organizationId`, `workspaceId`, `createdByUserId`) проходят через scoped flow и проверяются в обработчиках.

## 7. Configuration model

### 7.1 Environment loading

`getEnvVar` объединяет:

1. shell env,
2. `.env`,
3. `.env.local`,
4. `process.env`.

### 7.2 Critical runtime flags

- `DATABASE_URL` (fallback `POSTGRES_URL`)
- `MULTITENANT_MODE` (`shadow` / `enforce`)
- `WS_STREAMING_ENABLED`
- `AUTH_DEV_BYPASS_ENABLED`
- `AUTH_OAUTH2_*`

## 8. Observability and controls

- Audit trail: `writeAuditEvent`.
- Usage/quota: `enforceAndRecordUsage`.
- Stream/transport errors нормализуются в HTTP/WS events.
- Frontend telemetry через PostHog hooks (`src/renderer.tsx`).

## 9. Active vs legacy code

В репозитории еще есть compatibility-артефакты (например local-agent/MCP модули), но активный v1 runtime path построен вокруг HTTP-only контрактов и core workspace flow.

Если добавляется новая фича:

- сначала проектировать ее как HTTP-scoped API;
- затем подключать через `BackendClient`/`IpcClient`;
- только после этого рассматривать compatibility hooks.

## 10. Testing strategy (architecture-level)

- Unit/integration: Vitest для transport/contracts/handlers/utils.
- E2E: Playwright сценарии core web flow + strict payload rejection checks.
- Для контрактных изменений обязательно обновлять:
  - `backend_client` mapping tests,
  - `api_v1_middleware` payload tests,
  - gateway handler tests.
