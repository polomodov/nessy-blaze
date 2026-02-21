# Client-Server Only Scope (v1)

This document locks the runtime scope for the HTTP-only migration.

## Keep (core)

- Auth (JWT/dev-bypass + OAuth2 callback flow)
- Tenant scope (org/workspace) and scoped API paths
- App CRUD for core workspace flow
- Chat stream (SSE/WS), including cancel
- Proposal lifecycle: read, approve, reject
- Preview lifecycle: run, stop, restart
- User settings used by core UI

## Remove or Disable in v1

- Desktop runtime specific controls and actions
- IPC runtime invoke path (`/api/ipc/invoke`)
- MCP/agent-only chat modes from active UI entry points
- Integrations UI/API in v1:
  - GitHub
  - Vercel
  - Supabase
  - Neon
  - MCP tooling surfaces
  - Capacitor
  - HelpBot
  - Visual editing extras outside core preview flow
- Deep links and desktop diagnostics surfaces

## Migration Defaults

- Runtime transport is HTTP-only
- Backend stays in-repo (no repo split in v1)
- Namespace cleanup (`src/ipc/*` -> role-based paths) is a later iteration
