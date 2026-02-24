# MCP MVP Roadmap: безопасная интеграция инструментов в Blaze

## 1. Цель

Добавить в Blaze MVP-интеграцию MCP (Model Context Protocol), чтобы агент мог вызывать внешние инструменты в рамках чата и редактирования приложения без нарушения текущего client-server контракта и tenant-безопасности.

## 2. Что значит "сделать правильно"

1. Встраивать MCP в активный HTTP v1 flow, а не в legacy desktop/local-agent путь.
2. Сохранить строгий tenant scope (`orgId` + `workspaceId`) на каждом шаге.
3. Добавить явный user consent для потенциально опасных инструментов.
4. Начать с ограниченного и наблюдаемого среза (read-only, HTTP transport first).
5. Не ломать текущий UI API (`streamMessage`, `run/stop/restart`, proposal flow).

## 3. Текущее состояние (as-is)

- Уже есть БД-таблицы:
  - `mcp_servers`
  - `mcp_tool_consents`
  - файл: `src/db/schema.ts`
- Уже есть runtime-утилиты:
  - `src/ipc/utils/mcp_manager.ts`
  - `src/ipc/utils/mcp_consent.ts`
- В активном `chat_stream` пути MCP сейчас не включен:
  - `src/ipc/handlers/chat_stream_handlers.ts` явно исключает `tool-call/tool-result` из v1 stream contract.
- MCP-функциональность сегодня в основном находится в compatibility пути:
  - `src/core/main/ipc/handlers/local_agent/local_agent_handler.ts`

## 4. MVP scope (in / out)

### In scope

- Управление MCP servers в tenant scope (create/list/update/delete/enable).
- Вызов MCP tools из chat runtime через feature flag.
- Consent flow (ask once / always / deny) с сохранением решения в БД.
- Базовая телеметрия, аудит и ограничение таймаутов.

### Out of scope

- Полноценный marketplace MCP servers.
- Автоинсталляция arbitrary stdio-команд в multi-tenant проде.
- Политики уровня enterprise (advanced policy engine, per-tool RBAC матрица).

## 5. Целевая архитектура MVP

## 5.1 Control plane (backend channels)

Добавить/зафиксировать каналы в `src/http/ipc_http_gateway.ts`:

- `list-mcp-servers`
- `create-mcp-server`
- `patch-mcp-server`
- `delete-mcp-server`
- `set-mcp-server-enabled`
- `resolve-mcp-tool-consent`

Требования:

- строгая валидация payload;
- tenant checks через существующий scoped context;
- аудит mutation операций.

## 5.2 Data plane (chat runtime integration)

Интегрировать MCP toolset в `src/ipc/handlers/chat_stream_handlers.ts`:

- собирать toolset из enabled MCP servers в текущем tenant scope;
- включать MCP tools в `ToolSet` за feature flag;
- ограничивать параллелизм и timeout на вызовы;
- нормализовать ошибки tool execution в понятные agent/runtime сообщения.

## 5.3 Consent flow

Расширить stream контракт событиями согласия:

- `mcp:tool-consent-request`
- `mcp:tool-consent-resolved`

Точки интеграции:

- backend transport: `src/http/chat_stream_middleware.ts`, `src/http/chat_ws_server.ts`
- client stream parser: `src/ipc/ipc_client.ts`
- UI consent modal/action: workspace chat UI слой

Важно:

- не смешивать consent с текстовыми чанками ответа;
- consent должен быть отдельным event type с requestId correlation.

## 5.4 Transport policy (MVP)

MVP-рекомендация:

- `http` transport разрешен сразу;
- `stdio` transport только за отдельным флагом и только в trusted dev/stage;
- для production multi-tenant по умолчанию `stdio` выключен.

Это критично, потому что `stdio` = запуск произвольной команды на хосте.

## 6. Этапы внедрения

## P0. Контракт и guardrails

Deliverables:

- [ ] Зафиксировать stream contract для MCP consent событий.
- [ ] Добавить feature flag `BLAZE_MCP_ENABLED=false` (default).
- [ ] Добавить runtime limits: timeout, max tool calls per response, max payload size.
- [ ] Добавить аудит по MCP операциям.

## P1. Управление MCP servers (CRUD)

Deliverables:

- [ ] Реализовать backend channels для MCP server lifecycle.
- [ ] Добавить в UI settings минимальный экран управления серверами.
- [ ] Валидация transport-specific конфигурации (url/command/args/env).

## P2. Read-only MCP tools в chat

Deliverables:

- [ ] Подключить read-only MCP tools к `chat_stream_handlers`.
- [ ] Добавить consent flow для read-only инструментов.
- [ ] Реализовать e2e сценарий: chat -> consent -> tool result -> ответ агента.

## P3. Write-capable MCP tools

Deliverables:

- [ ] Включить write-инструменты только после явного consent policy.
- [ ] Добавить risk labels (`read`, `write`, `network`) и UI индикацию.
- [ ] Добавить deny-by-default для неизвестных/неразмеченных инструментов.

## P4. Production hardening

Deliverables:

- [ ] Rate limits и circuit breaker на проблемные MCP endpoints.
- [ ] Retry policy только для идемпотентных инструментов.
- [ ] Мониторинг/алерты на latency/error/consent-denial spikes.

## 7. Зависимости и порядок

Критические зависимости:

1. `docs/sandboxing_roadmap.md`:
   для `stdio` и потенциально опасных инструментов нужен изолированный runtime.
2. Tenant/auth hardening:
   нельзя выпускать MCP в прод без строгого scoped контроля.

Рекомендуемый порядок:

1. P0 -> P1 -> P2
2. Проверка в dogfood
3. P3 -> P4

## 8. Security baseline для MVP

- Все операции tenant-scoped.
- Секреты не логируются и не отправляются в UI.
- Timeouts обязательны для каждого tool call.
- Ограничение размера ответа инструмента.
- Consent decisions персистятся в `mcp_tool_consents`.
- Любой failure MCP не должен падать весь chat runtime.

## 9. Тестовая стратегия

Unit:

- `src/__tests__/mcp_tool_utils.test.ts`
- новые тесты для сериализации/валидации MCP payload и consent state machine.

Integration:

- `src/http/chat_stream_middleware.test.ts`
- `src/http/chat_ws_server.test.ts`
- `src/http/ipc_http_gateway.test.ts`

E2E (минимум 2):

1. MCP read-only tool: consent once -> успешный ответ.
2. MCP denied tool: отказ -> агент продолжает без tool execution.

## 10. Метрики MVP

- MCP tool call success rate.
- MCP tool call timeout/error rate.
- Consent acceptance rate (`once`/`always`) vs denial rate.
- P95 latency увеличения chat stream при активных MCP tools.
- Доля чатов, где MCP вызов завершился graceful fallback.

## 11. Definition of Done

- [ ] MCP server CRUD работает в tenant scope.
- [ ] Read-only MCP tools вызываются из chat runtime в HTTP v1 режиме.
- [ ] Consent flow работает и хранится в БД.
- [ ] Ошибки MCP изолированы и не роняют stream.
- [ ] Есть unit + integration + минимум 2 e2e кейса.
- [ ] Feature flag rollout документирован (`off -> canary -> on`).

## 12. Текущий статус

`Planned` — roadmap сформирован, implementation не начат.
