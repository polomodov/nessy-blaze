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

## Execution Status (February 23, 2026)

### Completed in scope

- Renderer transport path is HTTP-only via `BackendClient`.
- Unsupported legacy channels are blocked in browser runtime (`FeatureDisabledError`).
- User settings payload is sanitized from v1-removed integration keys:
  - `githubUser`
  - `githubAccessToken`
  - `vercelAccessToken`
  - `supabase`
  - `neon`
- App HTTP payload shape no longer exposes legacy integration metadata:
  - `github*`
  - `supabase*`
  - `neon*`
  - `vercel*`
  - legacy `files`

### In progress

- Removing remaining integration-specific execution branches from legacy compatibility code paths.
- Tightening runtime contracts so only v1 core features remain reachable from active UI/API entry points.

### Next steps

1. Remove remaining integration flags from settings/domain schemas where they are no longer consumed in v1.
2. Hard-disable integration side effects in legacy processing paths (Supabase/Neon deployment hooks) for client-server mode.
3. Add/extend E2E coverage for core v1 flow (app CRUD + chat/proposal + preview) with strict payload shape checks.
