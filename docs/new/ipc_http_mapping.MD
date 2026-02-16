# HTTP transport policy (IPC marked as legacy)

Дата: 13 февраля 2026  
Обновлено: 16 февраля 2026  
Статус: Draft (policy update)

## Policy (актуально)

- IPC взаимодействие между renderer и backend для режима `client-server` считается **legacy**.
- Клиент в режиме `client-server` должен общаться с backend **только через HTTP endpoints**.
- Приоритет:
  1. dedicated REST endpoints (`/api/v1/...`);
  2. временный HTTP gateway `POST /api/ipc/invoke` для каналов без отдельной ручки.
- Прямой IPC разрешен только в legacy desktop compatibility runtime и не является целевым путем развития.

## Таблица соответствия (transitional HTTP layer)

| IPC channel | HTTP endpoint (phase 1) | Planned dedicated endpoint (phase 2+) |
|---|---|---|
| `get-user-settings` | `GET /api/v1/user/settings` | `GET /api/v1/user/settings` |
| `set-user-settings` | `PATCH /api/v1/user/settings` | `PATCH /api/v1/user/settings` |
| `list-apps` | `GET /api/v1/apps` | `GET /api/v1/apps` |
| `get-app` | `GET /api/v1/apps/:appId` | `GET /api/v1/apps/:appId` |
| `create-app` | `POST /api/v1/apps` | `POST /api/v1/apps` |
| `rename-app` | `POST /api/ipc/invoke` (HTTP gateway) | `PATCH /api/v1/apps/:appId` |
| `delete-app` | `POST /api/ipc/invoke` (HTTP gateway) | `DELETE /api/v1/apps/:appId` |
| `get-chat` | `GET /api/v1/chats/:chatId` | `GET /api/v1/chats/:chatId` |
| `get-chats` | `GET /api/v1/chats` / `GET /api/v1/apps/:appId/chats` | `GET /api/v1/apps/:appId/chats` |
| `create-chat` | `POST /api/v1/apps/:appId/chats` | `POST /api/v1/apps/:appId/chats` |
| `update-chat` | `POST /api/ipc/invoke` (HTTP gateway) | `PATCH /api/v1/chats/:chatId` |
| `delete-chat` | `POST /api/ipc/invoke` (HTTP gateway) | `DELETE /api/v1/chats/:chatId` |
| `delete-messages` | `POST /api/ipc/invoke` (HTTP gateway) | `DELETE /api/v1/chats/:chatId/messages` |
| `search-app` | `GET /api/v1/apps:search?q=...` | `GET /api/v1/apps:search` |
| `search-chats` | `POST /api/ipc/invoke` (HTTP gateway) | `GET /api/v1/chats:search` |
| `chat:count-tokens` | `POST /api/ipc/invoke` (HTTP gateway) | `POST /api/v1/chat/token-count` |
| `chat:stream` | `POST /api/v1/chats/:chatId/stream` (SSE) | `POST /api/v1/chats/:chatId/stream` |
| `chat:cancel` | `POST /api/v1/chats/:chatId/stream/cancel` | `POST /api/v1/chats/:chatId/stream/cancel` |
| `get-proposal` | `POST /api/ipc/invoke` (HTTP gateway) | `GET /api/v1/chats/:chatId/proposal` |
| `approve-proposal` | `POST /api/ipc/invoke` (HTTP gateway) | `POST /api/v1/chats/:chatId/proposal/approve` |
| `reject-proposal` | `POST /api/ipc/invoke` (HTTP gateway) | `POST /api/v1/chats/:chatId/proposal/reject` |

## Legacy IPC channels (desktop compatibility only)

Ниже перечислены каналы, которые исторически были завязаны на IPC.  
Для режима `client-server` они должны быть закрыты HTTP ручками (или через временный HTTP gateway), без прямого IPC-вызова из клиента:

- `run-app`
- `stop-app`
- `restart-app`
- `respond-to-app-input`
- `github:start-flow`
- `help:chat:start`
- `help:chat:cancel`

## Feature flags / runtime config

- `VITE_DYAD_BACKEND_MODE=http` (целевой режим по умолчанию для client-server)
- `VITE_DYAD_BACKEND_URL=https://...`
- `VITE_DYAD_BACKEND_ALLOW_IPC_FALLBACK=false` для production client-server профиля

Local override (dev):

- `localStorage["dyad.backend.mode"]`
- `localStorage["dyad.backend.base_url"]`
- `localStorage["dyad.backend.ipc_fallback"]`
