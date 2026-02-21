# HTTP Transport Policy (IPC Removed from Client Runtime)

Дата: 13 февраля 2026  
Обновлено: 21 февраля 2026  
Статус: Active

## Policy

- Клиентский runtime работает только через HTTP (`/api/v1/...`) и stream endpoints (SSE/WS).
- Legacy endpoint `POST /api/ipc/invoke` удален из runtime цепочки.
- Прямой IPC не используется в active web/client-server режиме.

## Core Mapping (v1)

| Channel | Endpoint |
|---|---|
| `get-user-settings` | `GET /api/v1/user/settings` |
| `set-user-settings` | `PATCH /api/v1/user/settings` |
| `list-apps` | `GET /api/v1/orgs/:orgId/workspaces/:workspaceId/apps` |
| `create-app` | `POST /api/v1/orgs/:orgId/workspaces/:workspaceId/apps` |
| `get-app` | `GET /api/v1/orgs/:orgId/workspaces/:workspaceId/apps/:appId` |
| `read-app-file` | `GET /api/v1/orgs/:orgId/workspaces/:workspaceId/apps/:appId/file?path=...` |
| `get-chats` | `GET /api/v1/orgs/:orgId/workspaces/:workspaceId/chats` / `.../apps/:appId/chats` |
| `create-chat` | `POST /api/v1/orgs/:orgId/workspaces/:workspaceId/apps/:appId/chats` |
| `get-chat` | `GET /api/v1/orgs/:orgId/workspaces/:workspaceId/chats/:chatId` |
| `get-proposal` | `GET /api/v1/orgs/:orgId/workspaces/:workspaceId/chats/:chatId/proposal` |
| `approve-proposal` | `POST /api/v1/orgs/:orgId/workspaces/:workspaceId/chats/:chatId/proposal/approve` |
| `reject-proposal` | `POST /api/v1/orgs/:orgId/workspaces/:workspaceId/chats/:chatId/proposal/reject` |
| `run-app` | `POST /api/v1/orgs/:orgId/workspaces/:workspaceId/apps/:appId/run` |
| `restart-app` | `POST /api/v1/orgs/:orgId/workspaces/:workspaceId/apps/:appId/restart` |
| `stop-app` | `POST /api/v1/orgs/:orgId/workspaces/:workspaceId/apps/:appId/stop` |
| `chat:stream` | `POST /api/v1/orgs/:orgId/workspaces/:workspaceId/chats/:chatId/stream` |
| `chat:cancel` | `POST /api/v1/orgs/:orgId/workspaces/:workspaceId/chats/:chatId/stream/cancel` |

## Runtime Config

- `VITE_BLAZE_BACKEND_URL=https://...` (optional; if absent, window origin is used)
- `VITE_BLAZE_TENANT_ORG_ID` / `VITE_BLAZE_TENANT_WORKSPACE_ID` (optional)
