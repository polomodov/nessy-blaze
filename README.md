# Blaze (Internal)

Blaze is an internal client-server application for building frontend apps from prompts.
The repository contains both the web client and backend service used in local/dev environments.

## Architecture

- Web client (React + TanStack Router + TanStack Query)
- In-repo HTTP backend (`/api/v1`, SSE/WS chat streaming)
- PostgreSQL + drizzle ORM
- Shared domain types/schemas used by client and server

## Runtime Mode

The default and supported runtime is client-server (HTTP-only transport).
Legacy desktop compatibility paths are being removed from active runtime flow.

## Main Project Parts

- `src/components`, `src/routes`, `src/hooks`: frontend application UI and flows
- `src/http`: HTTP API middleware, chat stream middleware, WS server
- `src/ipc/backend_client.ts`: frontend transport layer to backend HTTP routes
- `src/ipc/ipc_client.ts`: app client facade used by UI hooks/components
- `src/db`: schema, DB setup, and migrations
- `src/pro`: extended internal/pro feature modules

## Development

```sh
npm install
npm run init-precommit
npm run dev
```

Database:

```sh
npm run db:generate
```

## Testing

```sh
npm test
```

## Contributing

Contributions inside the company are welcome.
Contribution rules and process are described in `CONTRIBUTING.md`.
