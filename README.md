# Blaze

Blaze в этом репозитории это client-server приложение для генерации и итеративного изменения фронтенд-проектов через AI-чат.

Текущий runtime по умолчанию: HTTP-only (web-клиент + встроенный backend в dev-сервере).

## Что умеет текущая версия

- Аутентификация: JWT/dev-bypass + OAuth2 callback flow.
- Tenant scope: organization/workspace.
- App lifecycle: создание, поиск, обновление, удаление.
- Chat lifecycle: стриминг ответа (SSE/WS), отмена генерации.
- Proposal lifecycle: получить, approve, reject.
- Preview lifecycle: run, stop, restart приложения.
- User settings для активного UI.

## Технологический стек

- Frontend: React 19, TanStack Router, TanStack Query, Jotai, Tailwind CSS.
- Backend runtime: HTTP middleware в `src/http` + gateway в `src/http/ipc_http_gateway.ts`.
- Streaming: scoped SSE (`/api/v1/orgs/:orgId/workspaces/:workspaceId/chats/:chatId/stream`) и WebSocket (`/api/v1/ws`).
- Data: PostgreSQL + drizzle ORM.
- AI integration: Vercel AI SDK + провайдеры из настроек/env.

## Быстрый старт

### 1. Требования

- Node.js `>=20`
- npm
- Запущенный PostgreSQL

### 2. Установка

```sh
npm install
npm run init-precommit
```

### 3. Конфигурация окружения

Скопируйте `.env.example` в `.env.local` и заполните минимум:

```env
DATABASE_URL=postgresql://...
# или fallback:
# POSTGRES_URL=postgresql://...
```

Рекомендуемые флаги для локальной разработки:

```env
MULTITENANT_MODE=shadow
AUTH_DEV_BYPASS_ENABLED=true
WS_STREAMING_ENABLED=true
```

Если хотите login через Google OAuth2, добавьте `AUTH_OAUTH2_*` переменные.

### 4. Запуск

```sh
npm run dev
```

Приложение поднимается через Vite (по умолчанию на `http://localhost:5173`).

## Команды

- `npm run dev` запуск web-клиента и HTTP backend middleware (режим разработки).
- `npm run build` production build клиента.
- `npm run start` запуск Vite client runtime.
- `npm run ts` проверка TypeScript (`ts:main` + `ts:workers`).
- `npm run lint` запуск oxlint.
- `npm run test` запуск unit/integration тестов (Vitest).
- `npm run e2e` запуск Playwright E2E.
- `npm run db:generate` генерация SQL миграций через drizzle-kit.
- `npm run db:push` применение схемы в БД.
- `npm run db:studio` запуск drizzle studio.

## Архитектура репозитория (кратко)

- `src/renderer.tsx` точка входа UI, QueryClient, RouterProvider, PostHog.
- `src/router.ts`, `src/routes/*` маршруты (`/auth`, `/`).
- `src/components/workspace/*` основной workspace UI (sidebar/chat/preview).
- `src/hooks/*` слой client-side orchestration и реактивных данных.
- `src/ipc/backend_client.ts` transport mapping `channel -> /api/v1/*`.
- `src/ipc/ipc_client.ts` фасад для UI и streaming API.
- `src/http/*` API middleware, stream middleware, WS server, tenant/auth context.
- `src/http/ipc_http_gateway.ts` реализация бизнес-каналов поверх БД/файловой системы.
- `src/ipc/handlers/chat_stream_handlers.ts` LLM orchestration и стриминг ответа.
- `src/ipc/processors/response_processor.ts` применение `<blaze-*>` изменений в кодовую базу приложения.
- `src/db/*` schema, migration bootstrap, init/reset.
- `scaffold/` шаблон, из которого создаются новые пользовательские приложения.

## Поток данных (в двух шагах)

1. UI вызывает `IpcClient` метод -> `BackendClient.invoke(...)` -> HTTP endpoint `/api/v1/...`.
2. Middleware маршрутизирует запрос в `invokeIpcChannelOverHttp` -> `ipc_http_gateway` -> БД/файлы/стриминг -> ответ обратно в UI.

## База данных и миграции

- Источник схемы: `src/db/schema.ts`
- Миграции: `drizzle/`
- Инициализация БД и автопрогон миграций при старте: `src/db/index.ts`

Важно:

- Не писать SQL миграции руками.
- Генерировать через `npm run db:generate`.

## Тестирование

Unit/integration:

```sh
npm run test
```

E2E:

```sh
npm run e2e
```

`playwright.config.ts` поднимает:

- web server (`npm run dev:client` на `127.0.0.1:4173`)
- fake LLM server из `testing/fake-llm-server`

## Частые проблемы

- `DATABASE_URL is not set ...`
  Проверьте `.env.local` и доступность Postgres.

- `TypeError: Failed to fetch`
  Проверьте, что dev-сервер запущен и `VITE_BLAZE_BACKEND_URL`/origin корректны.

- `Invalid payload: unsupported keys (...)`
  HTTP контракты строгие. Удалите лишние поля из payload.

## Документация

- Архитектура: `docs/architecture.md`
- План миграции client-server only: `docs/client_server_only_plan.md`
- Workflow переводов: `docs/i18n_translation_workflow.md`
