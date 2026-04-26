# Architecture

agent-fleet is split into a browser control plane, a local HTTP API, durable control-plane state, and Worker Agent adapters.

## Components

- `src/client`: React dashboard for goals, Steward decisions, Worker sessions, corrections, and memory.
- `src/server/http`: Fastify app, route validation, and API composition.
- `src/server/steward`: orchestration behavior that turns human goals into decisions and Worker instructions.
- `src/server/store`: durable state for goals, decisions, Worker sessions, corrections, memories, execution nodes, and events.
- `src/server/workers`: process adapters for Worker Agent commands.
- `src/server/remote`: pure remote execution policy helpers, including domain-aware proxy routing and remote node readiness decisions.
- `src/shared`: TypeScript contracts shared by browser and server.

## Current Flow

1. The browser submits a goal to `POST /api/goals`.
2. The HTTP layer validates input and calls `StewardRuntime`.
3. The Steward records an auditable decision.
4. The Worker adapter launches the configured Worker command or zsh alias.
5. The store records Worker metadata such as command, cwd, pid, resume id, status, and initial output.
6. The browser reads `GET /api/dashboard`.
7. Human corrections go through `POST /api/decisions/:id/corrections` and become both correction records and memory.

## State Model

The first implementation uses `.agent-fleet/control-plane.json`. This keeps the project easy to inspect and test. A future database can preserve the same domain records while improving concurrency, querying, and log volume.

## Boundary Rules

- HTTP routes should not directly spawn Worker commands.
- Worker adapters should not own product decision logic.
- Remote helpers should stay pure unless they are explicit adapters; SSH and network probes belong behind adapter boundaries.
- Steward logic should record decisions before launching irreversible or externally visible work.
- Shared types should remain serializable and browser-safe.
