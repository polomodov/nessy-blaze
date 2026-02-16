# IPC → HTTP mapping (Phase 1)

Дата: 13 февраля 2026  
Статус: Draft

## Подход в Phase 1

- В HTTP-режиме frontend вызывает dedicated API endpoints (`/api/v1/...`).
- Для обратной совместимости сохраняется fallback gateway:
  - `POST /api/ipc/invoke`
  - body: `{ "channel": string, "args": unknown[] }`
- Если для канала нет dedicated endpoint, клиент временно использует `/api/ipc/invoke`.

## Таблица соответствия (текущий transitional слой)

| IPC channel | HTTP endpoint (phase 1) | Planned dedicated endpoint (phase 2+) |
|---|---|---|
| `get-user-settings` | `GET /api/v1/user/settings` | `GET /api/v1/user/settings` |
| `set-user-settings` | `PATCH /api/v1/user/settings` | `PATCH /api/v1/user/settings` |
| `list-apps` | `GET /api/v1/apps` | `GET /api/v1/apps` |
| `get-app` | `GET /api/v1/apps/:appId` | `GET /api/v1/apps/:appId` |
| `create-app` | `POST /api/v1/apps` | `POST /api/v1/apps` |
| `rename-app` | `POST /api/ipc/invoke` | `PATCH /api/v1/apps/:appId` |
| `delete-app` | `POST /api/ipc/invoke` | `DELETE /api/v1/apps/:appId` |
| `get-chat` | `GET /api/v1/chats/:chatId` | `GET /api/v1/chats/:chatId` |
| `get-chats` | `GET /api/v1/chats` / `GET /api/v1/apps/:appId/chats` | `GET /api/v1/apps/:appId/chats` |
| `create-chat` | `POST /api/v1/apps/:appId/chats` | `POST /api/v1/apps/:appId/chats` |
| `update-chat` | `POST /api/ipc/invoke` | `PATCH /api/v1/chats/:chatId` |
| `delete-chat` | `POST /api/ipc/invoke` | `DELETE /api/v1/chats/:chatId` |
| `delete-messages` | `POST /api/ipc/invoke` | `DELETE /api/v1/chats/:chatId/messages` |
| `search-app` | `GET /api/v1/apps:search?q=...` | `GET /api/v1/apps:search` |
| `search-chats` | `POST /api/ipc/invoke` | `GET /api/v1/chats:search` |
| `chat:count-tokens` | `POST /api/ipc/invoke` | `POST /api/v1/chat/token-count` |
| `get-proposal` | `POST /api/ipc/invoke` | `GET /api/v1/chats/:chatId/proposal` |
| `approve-proposal` | `POST /api/ipc/invoke` | `POST /api/v1/chats/:chatId/proposal/approve` |
| `reject-proposal` | `POST /api/ipc/invoke` | `POST /api/v1/chats/:chatId/proposal/reject` |

## Каналы, оставленные на IPC в Phase 1

Эти каналы пока принудительно идут через IPC, так как завязаны на локальные event-stream/процессы:

- `chat:stream`
- `chat:cancel`
- `run-app`
- `stop-app`
- `restart-app`
- `respond-to-app-input`
- `github:start-flow`
- `help:chat:start`
- `help:chat:cancel`

## Feature flags / runtime config

- `VITE_DYAD_BACKEND_MODE=ipc|http`
- `VITE_DYAD_BACKEND_URL=https://...`
- `VITE_DYAD_BACKEND_ALLOW_IPC_FALLBACK=true|false`

Local override (dev):

- `localStorage["dyad.backend.mode"]`
- `localStorage["dyad.backend.base_url"]`
- `localStorage["dyad.backend.ipc_fallback"]`
