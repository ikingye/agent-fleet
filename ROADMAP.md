# Roadmap

## Current Baseline: Local Steward Control Plane

- Durable JSON control-plane state.
- Steward Chat and Steward Intake as the owner's interaction surface.
- Durable `stewardMessages` in `.agent-fleet/control-plane.json`.
- Explicit `workspacePath` per owner goal so Worker project work happens in the target workspace, not inside agent-fleet by default.
- Steward decision ledger.
- Worker command adapter with resume-id capture.
- Web dashboard for Steward Chat, goals, decisions, corrections, Worker sessions, remote nodes, worktrees, events, and memory.
- Steward checkpoints and recovery report for restart/disconnect continuity.
- Control-plane boundary: keep the dashboard compact and management-only; no business project UI or product code embedded in agent-fleet.

## Next: Reliable Supervision

- Long-running Worker monitoring.
- Automatic resume after restart.
- Richer Worker status events and log summaries.
- Human review queue for high-impact decisions.
- Easier multi-project status review, correction, and double-check workflows.
- Noninteractive Worker command configuration as the default documented path; keep aliases as compatibility only.

## Parallel Worktrees

- Worktree creation and ownership tracking.
- Subtask splitting.
- Conflict and dependency tracking.
- Merge readiness review.
- Parallel Worker development across independent project goals.

## Remote Execution

- Remote node inventory.
- SSH execution adapter.
- Domain-aware proxy fallback policy foundation.
- Load-aware placement of Worker Agents.
- Proxy-aware remote execution and remote-first resource scheduling.

## Learning Steward

- Inspectable user and project memory.
- Correction-driven preference learning.
- Decision policies based on risk, reversibility, and user preferences.
- Memory editing and deletion workflows.
