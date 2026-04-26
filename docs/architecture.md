# Architecture

agent-fleet is split into a browser control plane, a local HTTP API, durable control-plane state, and Worker Agent adapters.

## Components

- `src/client`: React dashboard for Steward Chat, Steward Intake, goals, decisions, corrections, Worker sessions, remote nodes, worktrees, events, and memory.
- `src/server/http`: Fastify app, route validation, and API composition.
- `src/server/steward`: orchestration behavior that turns human goals into decisions and Worker instructions.
- `src/server/store`: durable state for goals, decisions, Worker sessions, corrections, memories, execution nodes, worktree assignments, Steward Chat messages, checkpoints, and events.
- `src/server/workers`: process adapters for Worker Agent commands.
- `src/server/remote`: pure remote execution policy helpers, including domain-aware proxy routing and remote node readiness decisions.
- `src/shared`: TypeScript contracts shared by browser and server.

## Current Flow

1. The browser records owner/Steward chat through `POST /api/steward/messages`, or submits a goal with an explicit `workspacePath` to `POST /api/goals`.
2. The HTTP layer validates input and calls `StewardRuntime`.
3. The Steward records an auditable decision.
4. The Worker adapter launches the configured Worker command or zsh alias in the target workspace.
5. The store records Worker metadata such as command, cwd, pid, resume id, status, and initial output.
6. The browser reads `GET /api/dashboard`.
7. Human corrections go through `POST /api/decisions/:id/corrections` and become both correction records and memory.

The owner should interact with the Steward, not directly manage many Worker terminals. Worker prompts tell downstream agents to treat Steward instructions as the human owner's instructions.

For new owner instructions, the Steward should usually create a named Worker task or send the instruction as an update to an existing relevant Worker. Every Worker task has an explicit Worker Name in the format `<project-name>-<worker-purpose>-YYYYMMDDHHmm`, such as `agent-fleet-compact-dashboard-ui-202604261652` or `mahjong-project-readiness-202604261652`. Do not include `T`, seconds, or timezone in the Worker Name. The Steward puts that name at the top of the Worker prompt and requires the Worker to use the exact name as the heading of its final report. If the underlying spawn system assigns a random nickname, that nickname is secondary; the explicit Worker Name is the source of truth. The Steward's own working context should stay compact: goals, decisions, active Worker ownership, blockers, and verification results are coordinator state; code reading, implementation, review, and testing should be delegated to Workers where practical. Completing one Worker task is not a stopping condition by itself; the Steward should continue to the next Worker or verification step unless blocked.

## State Model

The first implementation uses `.agent-fleet/control-plane.json`. This keeps the project easy to inspect and test. A future database can preserve the same domain records while improving concurrency, querying, and log volume.

Steward Chat is product state. Owner and Steward messages are persisted in the `stewardMessages` array and surfaced through the dashboard and recovery flow.

## Lifecycle Supervision

Worker session lifecycle is durable state, not terminal state. External Worker adapters or daemons can report lifecycle changes through `POST /api/worker-sessions/:id/status` with a strict durable status and optional `lastOutput`; the store updates the Worker session and records a `worker.status.updated` audit event.

After a Steward Agent restart, a supervisor loop should load `GET /api/dashboard` or call the store directly, pass running or starting Worker sessions to `reconcileWorkerSessions`, and provide an injected process probe for the execution environment. The reconcile module does not probe real processes itself; it maps probe observations to deterministic status updates, such as marking a running session `paused` when its recorded process is missing but a resume id exists. Production runners should call the same store update path so dashboard state and audit history stay inspectable.

Steward Agent checkpoints are append-only durable notes for reconstructing coordinator state after compact, resume, or terminal failures. `POST /api/steward-checkpoints` records the reason, summary, next action, and related goal or Worker session ids. `GET /api/recovery` derives the active goals, active Worker sessions, resume commands, worktree metadata, latest checkpoint, and next actions from durable control-plane state. Worker sessions and worktree assignments remain the source of truth; checkpoints should not duplicate process metadata.

## Worktrees

Worktree planning is metadata-only. `planWorktree` derives the intended branch, path, and human-readable command for a Worker Agent assignment without touching git or the filesystem.

Worktree materialization performs the side effects behind an injected runner. `materializeWorktree` checks whether the planned path already exists, creates the parent directory when needed, and runs `git worktree add` with an argument array instead of a shell command string.

## Boundary Rules

- HTTP routes should not directly spawn Worker commands.
- Worker adapters should not own product decision logic.
- Remote helpers should stay pure unless they are explicit adapters; SSH and network probes belong behind adapter boundaries.
- Steward logic should record decisions before launching irreversible or externally visible work.
- Project-specific implementation and business UI belong in the target `workspacePath`; the browser dashboard stays a compact control-plane surface for management, status, review, correction, and recovery.
- Shared types should remain serializable and browser-safe.
