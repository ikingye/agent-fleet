# Product Brief

agent-fleet is a Steward Agent control plane for coordinating coding agents across many projects, machines, terminals, worktrees, and long-running development sessions. It manages work; it is not a host for business project UI or product-specific code.

The core problem is not how to run one coding agent. The core problem is that a human developer becomes the bottleneck when agent work requires constant project switching, terminal babysitting, resume-id tracking, stage-by-stage approvals, local CPU management, and repeated context handoff.

## North Star

The human only talks to the Steward Agent.

Worker Agents should experience the Steward Agent as if it were the human owner of the project. The Steward can make routine decisions, continue work overnight, coordinate parallel execution, record important decisions, ask for human review only when it matters, and correct downstream Worker Agents when the human changes direction.

The long-term goal is a Steward Agent that keeps learning the human's preferences, judgment patterns, quality bar, risk tolerance, communication style, and project context. It should first decide like the human, then gradually become better than the human at managing agent-driven development while remaining aligned with the human's intent.

## Pain Points

1. Worker Agents stop after stage boundaries and wait for the next human instruction.
2. Multi-project progress and decisions are scattered across terminal windows.
3. Agent throughput is too low when all work runs serially in one checkout.
4. Resume ids are managed by human memory instead of infrastructure.
5. Local macOS load becomes too high when many agents, builds, tests, and browsers run concurrently.

## Core Product Principles

- One human-facing agent: the Steward Agent is the only required human interaction surface.
- Workers treat the Steward as the human: Codex, Claude, Gemini, and future adapters receive instructions from the Steward and report back to it.
- Owner-facing decision review: the owner primarily reviews Steward decisions, risks, confidence, reversibility, and required double-checks. Raw Worker messages, stdout/stderr, command lines, resume mechanics, and detailed protocol output are audit/debug information and should be collapsed or secondary by default.
- Delegate all concrete work: the Steward coordinates, delegates, decides, and communicates, but does not directly implement code, run source-of-truth verification, merge, clean branches/worktrees, audit remote processes, or verify status. Those concrete tasks belong to named Worker Agents.
- Compact Steward context: the Steward retains goals, decisions, active Worker ownership, blockers, and Worker-reported verification results while Workers handle code reading, implementation, verification, review/merge, cleanup, remote process audits, and status verification.
- Clear Worker identity: every local Worker task has a human-readable Worker Name in the format `<project-name>-<worker-purpose>-YYYYMMDDHHmm`, such as `agent-fleet-compact-dashboard-ui-202604261652` or `mahjong-project-readiness-202604261652`. Remote-dispatched or high-load Worker tasks include the remote marker before the timestamp, such as `agent-fleet-worker-completion-backend-remote-202604261738`. Do not include `T`, seconds, or timezone in the Worker Name. The Steward puts that name at the top of the Worker prompt and requires the Worker to use the exact name as the heading of its final report. Random spawn-system nicknames are secondary; the explicit Worker Name is the source of truth.
- Continue until blocked or verified: the Steward should ask what remains after each subtask and move to the next Worker or verification step instead of stopping just because one Worker finished.
- Compact control plane, not project host: agent-fleet manages projects; business project UI and product code stay in each target workspace.
- Explicit workspace ownership: every user project goal has a `workspacePath`, and Worker cwd/project work happens there unless the owner explicitly targets agent-fleet itself.
- Durable Steward Chat: owner and Steward messages are persisted as `stewardMessages` in `.agent-fleet/control-plane.json`.
- Autonomy with accountability: the Steward may decide and continue, but must log important decisions and expose them for review.
- Human correction is normal: decisions must be correctable after work has continued.
- Correct the Steward, not Worker chatter: corrections should update Steward decisions, preferences, and memory. Worker communication details should only become owner-facing when they reveal a blocker, risk, or required owner action.
- Multi-project visibility: status, corrections, important decisions, Worker sessions, checkpoints, and memory should be easy to review across projects.
- Parallelism by default: use worktrees, clear ownership, and independent task scopes to increase throughput.
- Local-first control, remote-capable execution: the developer controls the system locally while high-CPU, GPU, or likely long-running work moves to matching ready remote capacity when available, with auditable local fallback.
- Durable sessions: terminal lifecycle must not define project lifecycle.
- Context is product data: decisions, preferences, resume ids, task history, review notes, and project constraints are durable and searchable.
- Learn the human: the Steward should continuously improve its model of the human's preferences, quality standards, and decision patterns.
