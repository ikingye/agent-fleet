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
- Conversation history, including Steward Chat `stewardMessages`, decisions, corrections, goals, checkpoints, resume ids, Worker sessions, remote nodes, worktrees, events, and memory must be durable and inspectable.
- Each owner goal must carry an explicit target `workspacePath`. Worker cwd/project work belongs in that workspace, such as `/Users/yewang/code/project/mahjong`, not in agent-fleet unless the owner explicitly asks to modify agent-fleet.
- Routine decisions should be autonomous; high-impact decisions should be logged for later human review.
- The dashboard is a compact management/control-plane surface for Steward Chat, intake, status, review, recovery, correction, and memory. Do not embed business project UI or product-specific app code in agent-fleet.
- Git worktrees and remote execution are core scalability mechanisms, not optional polish.
- The roadmap should keep moving toward multi-project status review, corrections, double-checks for important decisions, remote-first resource scheduling, proxy-aware execution, resume/session management, and parallel Worker development.

The full product brief lives in [docs/product-brief.md](docs/product-brief.md).

## Steward Operating Rules

- The owner interacts primarily with the Steward; the Steward coordinates Worker Agents instead of asking the owner to manage many terminals.
- When the owner sends a new instruction, the Steward should usually either spawn a named Worker Agent for a concrete task or route the update to an existing relevant Worker.
- Keep Steward context compact: retain goals, decisions, the active Worker map, blockers, and verification results; delegate code reading, implementation, review, and testing to Workers where practical.
- Worker task names and reports should start with a clear task label such as `Worker: compact-dashboard-ui`; random nicknames are not sufficient task identity.
- The Steward should not stop merely because one subtask finished. It should ask what remains and continue with the next Worker or verification step unless blocked.

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
- Require `workspacePath` in product contracts for new project goals and Worker dispatch paths.
- Keep business project implementation and UI in the target workspace; agent-fleet may inspect, coordinate, and report on it, but should not absorb it into the control-plane dashboard.
- Do not commit local runtime state, secrets, logs, worktrees, or `.agent-fleet` data.
- Prefer explicit audit records over hidden automation.
- Treat `workspacePath` / Target directory as the normal project selector. `AGENT_FLEET_WORKER_CWD` is only a fallback for launch paths without a goal workspace.
- Run `npm run check` and `npm run build` before claiming completion.

## Definition Of Done

- New or changed behavior preserves the Steward/Worker model: the owner talks to the Steward, Workers treat Steward instructions as owner instructions, and important decisions remain reviewable.
- Goals, chats, decisions, corrections, checkpoints, Worker sessions, resume ids, and memory remain durable across terminal disconnects and restarts.
- Multi-project work is scoped by explicit `workspacePath`, with Worker cwd in the target workspace unless agent-fleet itself is the target.
- Control-plane UI stays compact and focused on management, status, review, recovery, and correction workflows.
