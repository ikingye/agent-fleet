# Roadmap

## Phase 1: Local Control Plane

- Durable JSON control-plane state.
- Steward decision ledger.
- Worker command adapter with resume-id capture.
- Web dashboard for goals, decisions, Worker sessions, corrections, and memory.

## Phase 2: Reliable Supervision

- Long-running Worker monitoring.
- Automatic resume after restart.
- Richer Worker status events and log summaries.
- Human review queue for high-impact decisions.

## Phase 3: Parallel Worktrees

- Worktree creation and ownership tracking.
- Subtask splitting.
- Conflict and dependency tracking.
- Merge readiness review.

## Phase 4: Remote Execution

- Remote node inventory.
- SSH execution adapter.
- Domain-aware proxy fallback policy foundation.
- Load-aware placement of Worker Agents.

## Phase 5: Learning Steward

- Inspectable user and project memory.
- Correction-driven preference learning.
- Decision policies based on risk, reversibility, and user preferences.
- Memory editing and deletion workflows.
