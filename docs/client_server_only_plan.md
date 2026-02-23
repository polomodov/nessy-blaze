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
- This file is the single source of truth for v1 migration execution scope and status.

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
- Chat stream handler contract is side-effect-only in active runtime path (`Promise<void>`); backward-compat return values are removed from SSE/WS invocation flow.
- Active chat stream chunk assembly no longer emits legacy MCP tool visualization tags (`blaze-mcp-tool-call` / `blaze-mcp-tool-result`) in client-server v1 mode.
- WebSocket cancel stream payload contract is requestId-only in active v1 runtime (legacy chatId-targeted cancel fallback removed).
- WebSocket stream payload validation is tightened to active v1 requirements (non-empty request/org/workspace/prompt strings, finite chatId, typed optional fields, and rejection of unsupported top-level keys).
- SSE stream payload validation is tightened to active v1 requirements (strict top-level keys plus typed optional `redo|attachments|selectedComponents` fields).
- Proposal approve/reject HTTP payload contract is tightened to active v1 keys (`messageId` only); unsupported keys are rejected with `400 INVALID_PAYLOAD`.
- Browser backend proposal action mapping no longer duplicates `chatId` in HTTP body (path-only identity, `messageId` payload only).
- Scoped preview restart HTTP payload contract is tightened to active v1 keys (`removeNodeModules` only); unsupported keys are rejected with `400 INVALID_PAYLOAD`.
- Browser backend restart request mapping no longer duplicates `appId` in HTTP body (path-only identity, optional `removeNodeModules` payload).
- Unused MCP consent i18n labels are removed from active UI localization bundles.
- Active chat UI message role mapping uses `assistant` terminology in v1 (legacy `agent` role label removed from renderer message model and typing/status copy).
- Core web E2E suite now includes strict payload rejection checks for v1 chat/proposal/preview contracts (unsupported top-level keys and invalid attachment object shapes).
- Core web E2E suite now covers scoped v1 app CRUD contract flow.
- Core web E2E suite now covers scoped proposal lifecycle contract checks (`get/approve/reject`) with deterministic rejection semantics.
- Core web E2E suite now covers scoped preview lifecycle API flow (`run/stop/restart`).

### Prioritized Checklist (February 23, 2026)

Priority `P0` (must close for v1 cut):

- [ ] Remove remaining integration-specific execution branches from legacy compatibility code paths.
- [ ] Tighten runtime contracts so only v1 core features remain reachable from active UI/API entry points.

Priority `P1` (core flow reliability):

- [x] Extend E2E coverage for core v1 flow:
  - app CRUD
  - chat/proposal lifecycle (approve/reject)
  - preview run/stop/restart
  - strict payload rejection paths

Priority `P2` (UI/API cleanup):

- [ ] Complete MCP/agent-only surface cleanup from active UI entry points in v1.
- [ ] Remove or isolate compatibility-only local-agent artifacts from active web client paths.

Priority `P3` (follow-up hygiene):

- [x] Keep transport policy mapping in sync with runtime API routes.
- [ ] Continue narrowing legacy compatibility utilities not required by active v1 runtime.

### Next implementation sequence

1. Close `P0` runtime branch cleanup (integration-specific compatibility branches).
2. Complete `P1` E2E coverage for CRUD + proposal + preview flows.
3. Finish `P2` MCP/agent UI entry-point cleanup.
4. Execute `P3` compatibility utility reduction pass.
