# What Is agent-fleet

agent-fleet is a Steward Agent control plane for coordinating coding agents across projects, worktrees, sessions, and execution machines.

The goal is simple: the owner should interact with one Steward Agent, while bounded Worker Agents do concrete work behind a durable, inspectable control plane.

## What It Solves

Modern agent work often spreads across terminals, branches, remote hosts, chat transcripts, and half-remembered resume ids. agent-fleet turns that into structured product state:

- Goals have explicit target `workspacePath` values.
- Steward Chat is durable through `stewardMessages`.
- Steward decisions include rationale, risk, confidence, reversibility, and review needs.
- Worker sessions record command, cwd, pid, resume id, status, host, and report summaries.
- Corrections become durable memory instead of being lost in terminal scrollback.
- Recovery reports reconstruct active goals, sessions, checkpoints, worktrees, and next actions after restart.

## The Core Model

agent-fleet has two product roles.

| Role | Responsibility | Boundary |
| --- | --- | --- |
| Steward Agent | Owner-facing decision maker and orchestrator. | Coordinates, delegates, records decisions, communicates status, and preserves context. |
| Worker Agent | Bounded executor such as Codex, Claude Code, Gemini CLI, or a future adapter. | Reads code, implements, verifies, reviews, merges, audits remote processes, and reports results. |

The Steward should not become a coding terminal. Worker Agents should treat Steward instructions as the human owner's instructions.

## What It Is Not

agent-fleet is not a business application host. The dashboard is a compact management and recovery surface. Product-specific UI and implementation belong in the target project workspace, not inside the control-plane repository.

agent-fleet is also not the public npm package named `agent-fleet`. The npm package name `agent-fleet` is already used by another project. This repository is public under Apache-2.0, but `package.json` stays `private: true`; install from the GitHub source checkout for now. Do not run `npm install agent-fleet`.

## Current v0.1.0 Surface

v0.1.0 includes:

- Fastify API for goals, Steward Chat, dashboard state, decisions, corrections, recovery, execution nodes, and webhook connectors.
- React dashboard for the compact owner-facing control plane.
- `steward` CLI for terminal status and chat.
- JSON-backed local state in `.agent-fleet/control-plane.json`.
- Local command Worker adapter and SSH remote Worker adapter.
- Remote node readiness, remote workspace provisioning through git refs, and deploy-key lease helpers.
- Recovery endpoint for terminal disconnects, compacted Steward sessions, and restarts.

v0.1.0 is not a hardened multi-user service. Production supervision loops, multi-user storage, Worker lifecycle and resume hardening, and mature remote fleet scheduling remain roadmap work.
