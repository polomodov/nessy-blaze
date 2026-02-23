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
- User settings read payload is sanitized from v1-removed integration keys:
  - `githubUser`
  - `githubAccessToken`
  - `vercelAccessToken`
  - `supabase`
  - `neon`
- User settings write contract now rejects legacy/unsupported top-level fields instead of silently accepting them.
- User settings HTTP contract strips agent-only fields (`agentToolConsents`) and drops legacy `experiments` payload keys.
- User settings HTTP contract strips desktop diagnostics fields (`isRunning`, `lastKnownPerformance`) from active v1 payloads.
- Shared user settings schema no longer includes `agentToolConsents` in active client-server contracts.
- Shared user settings schema drops unused deprecated keys (`enableProSaverMode`, `blazeProBudget`, `runtimeMode`) and unused `runtimeMode2` from active contracts.
- Shared user settings schema drops unused local-agent UI preference (`hideLocalAgentNewChatToast`) from active contracts.
- Shared user settings schema drops unused desktop-era preference keys (`lastShownReleaseNotesVersion`, `acceptedCommunityCode`, `zoomLevel`, `customNodePath`).
- Shared user settings schema drops unused desktop diagnostics keys (`isRunning`, `lastKnownPerformance`) from active contracts.
- Shared IPC type surface drops unused agent-tool consent DTOs from active client-server contracts.
- Legacy Supabase settings flags are removed from active runtime schema.
- `blaze-execute-sql` integration branch is disabled in response processing for client-server-only mode.
- Manual approval payload extraction no longer treats legacy `blaze-execute-sql` tags as actionable runtime changes.
- Manual approval payload extraction no longer treats UI-only `blaze-command` tags as actionable file-change operations.
- Active build system prompt no longer asks models to emit `blaze-command` tags in client-server mode.
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
- User settings chat mode contract is restricted to HTTP v1 modes (`build|ask`): legacy values (`agent|local-agent`) are normalized on read and rejected on write.
- Runtime system prompt selection is restricted to active v1 chat modes (`build|ask`) with legacy `agent/local-agent` prompt branches removed from the shared selector.
- Legacy unscoped chat stream routes are disabled; active runtime chat streaming is scoped-only:
  - `/api/v1/orgs/:orgId/workspaces/:workspaceId/chats/:chatId/stream`
  - `/api/v1/orgs/:orgId/workspaces/:workspaceId/chats/:chatId/stream/cancel`
- Legacy unscoped stream route compatibility shim is removed from SSE middleware; non-scoped stream URLs are no longer handled in the active stream transport path.
- Proposal payload contract no longer carries Supabase-specific `isServerFunction` file metadata.
- Proposal payload contract no longer carries legacy SQL migration metadata (`sqlQueries`).
- Shared proposal type contract is narrowed to active v1 `code-proposal` payloads (legacy action/tip proposal DTOs removed).
- Removed unused `local_agent_prompt` module from active runtime prompt surface.
- Version history HTTP payload no longer carries legacy integration timestamp metadata (`dbTimestamp`).
- Legacy `versions.neon_db_timestamp` column is removed via generated Drizzle migration.
- HTTP chat stream adapters (SSE/WS) now ignore agent/MCP consent channels and only forward chat response events in v1 mode.
- Unused MCP consent i18n labels are removed from active UI localization bundles.

### In progress

- Removing remaining integration-specific execution branches from legacy compatibility code paths.
- Tightening runtime contracts so only v1 core features remain reachable from active UI/API entry points.

### Next steps

1. Continue reducing compatibility-only integration code outside active runtime path.
2. Add/extend E2E coverage for core v1 flow (app CRUD + chat/proposal + preview) with strict payload shape checks.
3. Plan and execute cleanup of MCP/agent-only surfaces from active UI entry points in v1.
