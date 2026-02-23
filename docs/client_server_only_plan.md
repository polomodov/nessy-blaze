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
- Legacy Supabase settings flags are removed from active runtime schema.
- `blaze-execute-sql` integration branch is disabled in response processing for client-server-only mode.
- Local-agent and response processing contexts no longer depend on Supabase/Neon app metadata.
- Legacy integration columns are removed from the `apps` Drizzle schema and migration is generated.
- Template catalog contract is normalized to transport-agnostic `sourceUrl` and strict API identifiers.
- Unused legacy Vercel/Supabase helper surface is removed (`vercel_utils`, migration file writer hook, stale IPC types).
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

1. Continue reducing compatibility-only integration code outside active runtime path.
2. Add/extend E2E coverage for core v1 flow (app CRUD + chat/proposal + preview) with strict payload shape checks.
3. Plan and execute cleanup of MCP/agent-only surfaces from active UI entry points in v1.
