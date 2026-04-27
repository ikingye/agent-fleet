# Steward Control Plane Completion Roadmap

This file is archived for v0.1.0 release hygiene. Earlier versions listed P0 gaps from the first local slice; several of those items are now implemented or partially implemented, so this document is no longer the release source of truth.

Use these current docs for v0.1.0 behavior:

- [README](../../README.md): install, server/web startup, CLI, dashboard, webhook connector, remote Worker/offload, release scope, and limitations.
- [Getting Started](../getting-started.md): first-run workflow.
- [Configuration](../configuration.md): environment variables and IM/webhook connector details.
- [Architecture](../architecture.md): Steward/Worker boundaries, durable state, connectors, recovery, worktrees, and remote offload.
- [Remote Offload](../remote/macos-offload.md) and [Remote Codex Bootstrap](../remote/codex-bootstrap.md): remote Worker setup and constraints.

## v0.1.0 Covered Baseline

- Steward Chat, owner goals, decisions, corrections, memory, checkpoints, Worker sessions, execution nodes, worktree assignments, events, and reports are durable local control-plane state.
- The web dashboard and `steward` CLI both use the same local API.
- Goals and chat carry explicit `workspacePath`; Worker cwd/project work belongs in that target workspace unless the owner explicitly targets agent-fleet.
- Generic IM/webhook connectors map authenticated gateway messages into Steward Chat.
- Local command Workers and SSH remote Workers are behind adapter boundaries.
- Remote servers are treated as stateless compute; git refs and local control-plane state remain the durable source of truth.
- Owner-facing UI foregrounds Steward decisions, risks, corrections, recovery, and status; low-level Worker protocol detail stays secondary.
- Named Worker Agents own implementation, verification, review/merge, cleanup, remote process audits, and status verification.

## Post-v0.1.0 Themes

- Harden the autonomous Steward loop for multi-project status review, correction handling, and follow-up dispatch.
- Improve structured Worker final-report ingestion, owner-visible risk review, and double-check workflows.
- Harden remote readiness, remote reconcile, resume/session management, proxy-aware scheduling, and remote resource allocation.
- Improve memory retrieval quality and make memory usage in Steward decisions more inspectable.
- Expand release-manager workflows for merging all release branches into `main`, verifying, and deleting merged branches/worktrees so only `main` remains.
