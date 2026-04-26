# Agent Instructions

## Scope

These instructions apply to the whole repository.

agent-fleet is a Steward Agent control plane. The core product model is:

- **Steward Agent**: the human-facing decision maker and orchestrator.
- **Worker Agent**: a bounded executor such as Codex, Claude Code, Gemini CLI, or a future adapter.

Avoid older terms such as "butler agent" or "task agent" in product copy and code.

## Skills

Shared skills live in `~/.agents/skills`. Codex-specific skills live in `~/.codex/skills`.

Prefer the shared copy when a skill is agent-neutral. Do not duplicate shared skills into Codex-specific directories just to make discovery work; configure loading or symlink bridges instead.

## Product Priorities

- The human should interact with one Steward Agent, not many terminal sessions.
- Worker Agents should treat Steward instructions as the human owner's instructions.
- Decisions, corrections, resume ids, Worker sessions, and memory must be durable and inspectable.
- Routine decisions should be autonomous; high-impact decisions should be logged for later human review.
- Git worktrees and remote execution are core scalability mechanisms, not optional polish.

The full product brief lives in [docs/product-brief.md](docs/product-brief.md).

## Code Organization

- Keep root config files at the repository root: `package.json`, `tsconfig.*.json`, `vite.config.ts`, `vitest.config.ts`, and `index.html`.
- Put application code under `src`.
- Put browser UI under `src/client`.
- Put server code under `src/server` and preserve these boundaries:
  - `src/server/http`: Fastify app and route-level tests.
  - `src/server/steward`: Steward orchestration behavior.
  - `src/server/store`: durable control-plane state.
  - `src/server/workers`: Worker process adapters.
- Put shared TypeScript contracts under `src/shared`.
- Put product and engineering docs under `docs`.

## Engineering Rules

- Write or update tests before changing behavior.
- Keep Worker execution side effects behind adapter boundaries.
- Do not commit local runtime state, secrets, logs, worktrees, or `.agent-fleet` data.
- Prefer explicit audit records over hidden automation.
- Run `npm run check` and `npm run build` before claiming completion.
