# Development Guide

Blaze runs in client-server web mode for local development.

## Reference docs

- Architecture: [docs/architecture.md](./docs/architecture.md)

## Environment setup

Install dependencies:

```sh
npm install
```

Initialize pre-commit hooks:

```sh
npm run init-precommit
```

Configure PostgreSQL with one of the following env vars:

```sh
# Preferred
DATABASE_URL=postgresql://<user>:<password>@<host>:<port>/<db>

# Fallback (used only when DATABASE_URL is not set)
POSTGRES_URL=postgresql://<user>:<password>@<host>:<port>/<db>
```

## Development workflow

Generate DB migrations after changing `src/db/schema.ts`:

```sh
npm run db:generate
```

Run app locally:

```sh
npm start
```

## Testing

Run unit tests:

```sh
npm test
```

Build web app for E2E:

```sh
npm run pre:e2e
```

Run all E2E tests:

```sh
npm run e2e
```

Run a specific E2E file:

```sh
npm run e2e e2e-tests/context_manage.spec.ts
```

Update snapshots for a specific E2E file:

```sh
npm run e2e e2e-tests/context_manage.spec.ts -- --update-snapshots
```
