# Core: взаимодействие с Agent при редактировании приложений

Этот документ описывает, как в текущем client-server runtime работает ядро редактирования приложения через агент (LLM) и Blaze-теги.

## 1. Что считается "ядром" в этом потоке

Ключевые модули:

- UI чат-экрана: `src/components/workspace/BlazeChatArea.tsx`
- Клиентский stream transport: `src/ipc/ipc_client.ts`
- SSE middleware (HTTP stream/cancel): `src/http/chat_stream_middleware.ts`
- Основной stream handler: `src/ipc/handlers/chat_stream_handlers.ts`
- Применение изменений из Blaze-тегов: `src/ipc/processors/response_processor.ts`
- Manual approve/reject API: `src/http/ipc_http_gateway.ts`

## 2. End-to-end поток (основной сценарий)

1. Пользователь отправляет сообщение в UI (`BlazeChatArea`).
2. Клиент вызывает `IpcClient.streamMessage(...)`.
3. `IpcClient` отправляет `POST` на scoped endpoint:
   `/api/v1/orgs/:orgId/workspaces/:workspaceId/chats/:chatId/stream`
4. `chat_stream_middleware`:
   - валидирует payload (строгие ключи: `prompt|redo|attachments|selectedComponents`);
   - резолвит tenant/user контекст (`resolveRequestContext`);
   - проверяет доступ к чату (`ensureChatInScope`);
   - открывает SSE stream.
5. `handleChatStreamRequest`:
   - сохраняет user message;
   - создает placeholder assistant message;
   - формирует контекст и запускает генерацию (`streamText`);
   - отправляет промежуточные события `chat:response:chunk`.
6. По завершению stream:
   - в `auto-apply` режиме изменения применяются сразу через `processFullResponseActions`;
   - в manual режиме формируется proposal-путь без немедленного применения файлов;
   - отправляется `chat:response:end`.

## 3. Как агент передает правки

Агент не пишет файлы напрямую. Он отдает управляющие теги в тексте ответа:

- `<blaze-write>`
- `<blaze-search-replace>`
- `<blaze-rename>`
- `<blaze-delete>`
- `<blaze-add-dependency>`
- `<blaze-chat-summary>` (метаданные для заголовка/summary)

Парсинг и применение:

- парсер тегов: `src/ipc/utils/blaze_tag_parser.ts`
- исполнитель: `processFullResponseActions` в `src/ipc/processors/response_processor.ts`

## 4. Auto-apply vs Manual apply

### 4.1 Auto-apply

Если включен `autoApproveChanges` и chat mode не `ask`:

- после генерации вызывается `processFullResponseActions(...)`;
- выполняются file ops (delete -> rename -> search-replace -> write);
- staging/commit в git;
- в БД сохраняются `approvalState`, `commitHash`, статус применения.

### 4.2 Manual apply

Если автоаппрув выключен:

- UI запрашивает pending proposal через `IpcClient.getProposal(chatId)`;
- пользователь нажимает Apply;
- backend вызывает `approve-proposal` -> `processFullResponseActions(...)`.

Роуты:

- approve: `approve-proposal` в `src/http/ipc_http_gateway.ts`
- reject: `reject-proposal` в `src/http/ipc_http_gateway.ts`

Обе операции обернуты в `withLock(...)` для защиты от гонок.

## 5. Отмена генерации

Клиент вызывает `IpcClient.cancelChatStream(chatId)`, отправляя:

- `POST /api/v1/orgs/:orgId/workspaces/:workspaceId/chats/:chatId/stream/cancel`

На backend:

- `handleChatCancelRequest(...)` абортит активный stream;
- в SSE отправляется `chat:response:end`.

## 6. Гарантии и ограничения

- Scoped-only transport: все активные stream endpoints tenant-scoped.
- Строгая валидация payload: неподдерживаемые ключи отклоняются.
- Применение правок только внутри app path (`safeJoin` + app root).
- RBAC/tenant checks на mutation-операциях.
- Ошибки применения возвращаются в structured-форме и попадают в диагностику ответа.

## 7. Где расширять систему

Если добавляется новый тип действия от агента:

1. Добавить тег-парсинг в `src/ipc/utils/blaze_tag_parser.ts`.
2. Добавить применение в `processFullResponseActions(...)`.
3. Обновить system prompt contract в `src/prompts/system_prompt.ts`.
4. Добавить unit/integration тесты:
   - `src/__tests__/chat_stream_handlers.test.ts`
   - `src/http/chat_stream_middleware.test.ts`
   - `src/http/ipc_http_gateway.test.ts`

## 8. Краткая схема данных в потоке

- Вход: `ChatStreamParams` (`chatId`, `prompt`, optional `redo|attachments|selectedComponents`)
- Stream events:
  - `chat:response:chunk`
  - `chat:response:error`
  - `chat:response:end`
- Итог применения:
  - `updatedFiles`
  - optional `extraFiles`, `extraFilesError`
  - `commitHash` в assistant message при успешном apply
