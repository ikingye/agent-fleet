# Development

## Setup

```bash
npm ci
npm run check
npm run build
```

## Test Matrix

- `npm run typecheck`: TypeScript server and web projects.
- `npm run lint`: ESLint.
- `npm test`: Vitest unit and integration tests.
- `npm run test:e2e`: Playwright dashboard smoke test.
- `npm run check:community`: public repository hygiene checks.

## Local Server

```bash
npm run dev
```

The dev server uses:

- API: Fastify through `tsx watch`.
- UI: Vite on `127.0.0.1:5173`.

## Adding Agent Adapters

Keep adapters behind the `AgentAdapter` interface. Adapter code should:

- Accept a worktree path and prompt.
- Capture logs.
- Return explicit success/failure status.
- Avoid leaking provider credentials into task events or logs.

## Adding Database Tables

- Update `src/server/db/schema.ts`.
- Add store methods in `RepositoryStore` or a new focused store.
- Add tests that open a temporary database.
- Keep migrations backward compatible once releases begin.

## Public Docs Rule

Examples must use reserved domains, reserved IP ranges, or generic names. Do not commit real private
server addresses, personal host aliases, tokens, keys, or private repository URLs.
