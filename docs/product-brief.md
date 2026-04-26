# Product Brief

agent-fleet is a Steward Agent platform for coordinating coding agents across many projects, machines, terminals, worktrees, and long-running development sessions.

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
- Autonomy with accountability: the Steward may decide and continue, but must log important decisions and expose them for review.
- Human correction is normal: decisions must be correctable after work has continued.
- Parallelism by default: use worktrees, clear ownership, and independent task scopes to increase throughput.
- Local-first control, remote-capable execution: the developer controls the system locally while expensive work can move elsewhere.
- Durable sessions: terminal lifecycle must not define project lifecycle.
- Context is product data: decisions, preferences, resume ids, task history, review notes, and project constraints are durable and searchable.
- Learn the human: the Steward should continuously improve its model of the human's preferences, quality standards, and decision patterns.
