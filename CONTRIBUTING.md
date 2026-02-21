# Contributing

Before opening a pull request, please open an issue and discuss whether the change makes sense in Blaze. Ensuring a cohesive user experience sometimes means we can't include every possible feature or we need to consider the long-term design of how we want to support a feature area.

- For a high-level overview of how Blaze works, please see the [Architecture Guide](./docs/architecture.md). Understanding the architecture will help ensure your contributions align with the overall design of the project.
- For a detailed architecture on how the new local agent mode (aka Agent v2) works, please read the [Agent Architecture Guide](./docs/agent_architecture.md)
- For an in-depth overview of the Blaze codebase, see the DeepWiki documentation [![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/blaze-sh/blaze)

> **Note:** By submitting a contribution within `src/pro`, you agree that such contribution is licensed under the Fair Source License (FSL) used by that directory.

## More than code contributions

Something that I really appreciate are all the non-code contributions, such as reporting bugs, writing feature requests and participating on [Blaze's sub-reddit](https://www.reddit.com/r/blazebuilders).

## Development

Blaze runs in client-server web mode for local development.

**Install dependencies:**

```sh
npm install
```

**Configure PostgreSQL connection**

Set one of these environment variables before running Blaze:

```sh
# Preferred
DATABASE_URL=postgresql://<user>:<password>@<host>:<port>/<db>

# Fallback (used only when DATABASE_URL is not set)
POSTGRES_URL=postgresql://<user>:<password>@<host>:<port>/<db>
```

**Generate DB migrations:**

If you change the DB schema (i.e. `src/db/schema.ts`), you will need to generate a DB migration.

```sh
npm run db:generate
```

> If you want to discard a DB migration, reset your Postgres schema (for example, drop and recreate `public` in your local development database).

**Run locally:**

```sh
npm start
```

## Setup

If you'd like to contribute a pull request, we highly recommend setting the pre-commit hooks which will run the formatter and linter before each git commit. This is a great way of catching issues early on without waiting to run the GitHub Actions for your pull request.

Simply run this once in your repo:

```sh
npm run init-precommit
```

## Testing

### Unit tests

```sh
npm test
```

### E2E tests

Build the web app for E2E testing:

```sh
npm run pre:e2e
```

> Note: you only need to re-build the app when changing the app code. You don't need to re-build the app if you're just updating the tests.

Run the whole e2e test suite:

```sh
npm run e2e
```

Run a specific test file:

```sh
npm run e2e e2e-tests/context_manage.spec.ts
```

Update snapshots for a test:

```sh
npm run e2e e2e-tests/context_manage.spec.ts -- --update-snapshots
```

## Code reviews

Blaze relies on several AI code reviewers to catch issues. If a comment is irrelevant please leave a brief comment and mark the comment as resolved.

You can also do local code reviews with the following tools:

- Codex CLI - `codex` -> `/review`
- Claude Code CLI - `claude` -> `/review`
