# Repository Agent Guide

## Project setup and lints

Make sure you run this once after doing `npm install` because it will make sure whenever you commit something, it will run pre-commit hooks like linting and formatting.

```sh
npm run init-precommit
```

If you get any lint errors, you can usually fix it by doing:

```sh
npm run lint:fix
```

Note: if you do this, then you will need to re-add the changes and commit again.

## Project context

- The default app mode is now **client-server** (web client + backend service).
- Electron is kept as a legacy/compatibility runtime and must be treated as secondary.
- Frontend is a React app that uses TanStack Router (not Next.js or React Router).
- Data fetching/mutations should be handled with TanStack Query via the `BackendClient` abstraction.

### Default run/build mode

- Default scripts (`npm run dev`, `npm start`, `npm run build`) target client-server mode.
- Electron scripts are explicit opt-in:
  - `npm run dev:desktop`
  - `npm run start:desktop`
  - `npm run package:desktop`
  - `npm run make:desktop`
  - `npm run publish:desktop`

## IPC architecture expectations

1. `src/ipc/ipc_client.ts` runs in the renderer and must use transport abstraction (`BackendClient`).
2. New client features should be transport-agnostic first (HTTP/service-mode first).
3. `src/preload.ts` and `src/ipc/ipc_host.ts` are only for desktop compatibility paths.
4. IPC handlers should `throw new Error("...")` on failure instead of returning `{ success: false }` style payloads.

## React + IPC integration pattern

When creating hooks/components that call backend handlers:

- Wrap reads in `useQuery`, providing a stable `queryKey`, async `queryFn` that calls the relevant `IpcClient` method, and conditionally use `enabled`/`initialData`/`meta` as needed.
- Wrap writes in `useMutation`; validate inputs locally, call the IPC client, and invalidate related queries on success. Use shared utilities (e.g., toast helpers) in `onError`.
- Synchronize TanStack Query data with any global state (like Jotai atoms) via `useEffect` only if required.

## Database

This app uses PostgreSQL and drizzle ORM.

Generate SQL migrations by running this:

```sh
npm run db:generate
```

IMPORTANT: Do NOT generate SQL migration files by hand! This is wrong.

## General guidance

- Favor descriptive module/function names that mirror backend/API semantics.
- Keep Electron security practices in mind **only when touching desktop compatibility code** (no `remote`, validate/lock by `appId` when mutating shared resources).
- Add tests in the same folder tree when touching renderer components.

Use these guidelines whenever you work within this repository.

## Testing

Our project relies on a combination of unit testing and E2E testing. Unless your change is trivial, you MUST add a test, preferably an e2e test case.

### Unit testing

Use unit testing for pure business logic and util functions.

### E2E testing

Use E2E testing when you need to test a complete user flow for a feature.

If you would need to mock a lot of things to unit test a feature, prefer to write an E2E test instead.

Do NOT write lots of e2e test cases for one feature. Each e2e test case adds a significant amount of overhead, so instead prefer just one or two E2E test cases that each have broad coverage of the feature in question.

## Deployment workflow

GitHub-specific deployment and PR routing rules are temporarily removed.
Use the current team process for release/deployment decisions until a new workflow is defined.
