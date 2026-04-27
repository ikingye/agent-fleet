# agent-fleet v0.1.0 Docs

agent-fleet is a Steward Agent control plane for coordinating named Worker Agents across projects, worktrees, sessions, remote nodes, decisions, recovery, and memory.

The documentation is structured like an operator handbook: first understand the product model, then install it, then connect interfaces, then prepare recovery and remote execution.

## Fast Paths

- New operator: start with [What Is agent-fleet](what-is-agent-fleet.md), then [Getting Started](getting-started.md).
- Source install: follow [Getting Started](getting-started.md). This project is not installed from the public npm package named `agent-fleet`.
- Product model review: read [Steward/Worker Model](steward-worker-model.md).
- Terminal usage: read [steward CLI](cli.md).
- Browser usage: read [Web Dashboard](dashboard.md).
- IM or webhook setup: read [Connectors And Security](connectors-security.md).
- Remote execution: read [Remote Workers](remote-workers.md).
- Current scope and limits: read [Current Scope And Limits](v0.1.0-limitations.md).

## Why It Exists

agent-fleet removes the human bottleneck from multi-agent development:

- The owner interacts with one Steward Agent instead of many terminal sessions.
- Worker Agents treat Steward instructions as the human owner's instructions.
- Goals, chat, decisions, corrections, checkpoints, Worker sessions, worktrees, remote nodes, events, and memory are durable and inspectable.
- Every goal carries an explicit target `workspacePath`.
- Raw Worker output remains available for audit and debugging without becoming the primary owner workflow.
- Remote execution and worktrees are treated as core scalability mechanisms.

## Core Rule

The owner talks to the Steward. Worker Agents do concrete work. The Steward records decisions, routes tasks, communicates risks, and keeps durable state, but implementation, verification, review, merge, cleanup, and remote process audits belong to named Workers.

## Start Here

1. Read [What Is agent-fleet](what-is-agent-fleet.md).
2. Install and run the local control plane with [Getting Started](getting-started.md).
3. Learn the delegation boundary in [Steward/Worker Model](steward-worker-model.md).
4. Review [Current Scope And Limits](v0.1.0-limitations.md) before relying on remote execution, connectors, or multi-project supervision.
