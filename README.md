# agent-fleet

agent-fleet is a private-incubation, public-ready Steward Agent control plane for coordinating coding agents across projects, worktrees, sessions, and execution machines.

agent-fleet is the compact management system. Business project UI, product code, and project-specific implementation should stay in the target project workspace, not be embedded in this repository or dashboard.

The project is not open source yet. It is maintained with public-project hygiene now so the repository can become public later without restructuring its docs, safety process, or contributor expectations.

## What It Solves

agent-fleet removes the human bottleneck from multi-agent development:

- One Steward Agent becomes the only human-facing interface.
- Worker Agents such as Codex or Claude receive explicit Worker Names from the Steward, such as `agent-fleet-compact-dashboard-ui-202604261652`, and report back under that same heading. Random spawn nicknames remain secondary.
- Conversation history, goals, decisions, corrections, checkpoints, resume ids, process ids, Worker sessions, and project memory become durable state.
- Owner-facing review centers on Steward decisions, risks, confidence, reversibility, and required double-checks; raw Worker messages, stdout/stderr, command lines, resume mechanics, and protocol output are secondary audit/debug details.
- Every project goal has an explicit target `workspacePath`, for example `~/code/project/mahjong`; Worker cwd/project work happens there unless the owner explicitly asks to work on agent-fleet itself.
- Parallel work can be coordinated through git worktrees instead of one terminal checkout.
- Heavy agent work can later move to remote machines while the local Mac remains usable.

## Current Status

This repository currently contains the first local control-plane slice:

- Fastify API for goals, dashboard state, and decision corrections.
- React dashboard for Steward Chat, Steward Intake with Target directory, Steward decision review, corrections, Worker session audit details, remote nodes, worktrees, events, and memory.
- JSON-backed local state at `.agent-fleet/control-plane.json`, including durable `stewardMessages` for Steward Chat.
- Command Worker adapter that can launch a real executable or a zsh alias such as `codexyoloproxy`; noninteractive executable configuration is preferred for API-launched Workers when available.
- Steward checkpoints and `GET /api/recovery` for reconstructing active goals, Worker sessions, resume commands, worktree metadata, and next actions after terminal disconnects or restarts.

Automatic Worker resume orchestration, richer learning memory, remote-first scheduling, proxy-aware remote execution, and broader parallel Worker development are roadmap items.

## Quick Start

Requirements:

- Node.js 24+
- npm 10+
- A Worker command on PATH. zsh aliases can work, but executable, noninteractive commands are more reliable when launched by the API without a TTY.

Install and verify:

```sh
npm ci
npm run check
npm run build
```

Run locally:

```sh
cd ~/code/project/agent-fleet
npm run dev
```

The API listens on `127.0.0.1:8787` by default and the Vite web app listens on `127.0.0.1:5173`.

After installing or linking the package, the `steward` command can talk to the same API:

```sh
steward status
steward chat --workspace ~/code/project/mahjong --project mahjong
steward chat --workspace ~/code/project/mahjong --once "What needs my review?"
```

`steward` with no arguments opens an interactive chat using the current directory as the workspace. Use
`STEWARD_API_URL` or `--api-url` when the API is not running on `http://127.0.0.1:8787`.

Open `http://127.0.0.1:5173`, use Steward Chat as the owner's primary surface, and submit work through Steward Intake with an explicit Target directory. For normal product work the target `workspacePath` should be the business project, such as `~/code/project/mahjong`, not this agent-fleet repository. The Steward records that path with the goal and Worker cwd/project work belongs there unless the owner explicitly asks to change agent-fleet itself.

Local recovery:

```sh
curl http://127.0.0.1:8787/api/recovery
```

The recovery report is derived from `.agent-fleet/control-plane.json` and is the first place to check after a terminal disconnect, compacted Steward session, or computer restart.

## Configuration

Copy `.env.example` if you want local overrides:

```sh
AGENT_FLEET_HOST=127.0.0.1
AGENT_FLEET_PORT=8787
AGENT_FLEET_STATE=.agent-fleet/control-plane.json
AGENT_FLEET_WORKER_COMMAND=codex
AGENT_FLEET_WORKER_ARGS="exec --json --sandbox workspace-write -"
```

`AGENT_FLEET_WORKER_CWD` is only a fallback cwd for local Worker launch paths that do not receive a goal workspace. It is not the normal project selector; goals and Steward Chat context should carry `workspacePath`.

Interactive aliases such as `codexyoloproxy` may fail when launched by the API without a TTY. Prefer a noninteractive Codex setup:

```sh
AGENT_FLEET_WORKER_COMMAND=codex
AGENT_FLEET_WORKER_ARGS="exec --json --sandbox workspace-write -"
```

See [docs/configuration.md](docs/configuration.md) for details.

## Verification Baseline

At this documentation refresh, the control plane had passed `npm run check` and `npm run build`. The Mahjong target project at `~/code/project/mahjong` had passed `npm test`, `npm run check`, and `npm run build`.

## Repository Layout

```text
src/client/                 React dashboard
src/server/http/            Fastify app and HTTP route tests
src/server/steward/         Steward Agent orchestration runtime
src/server/store/           Durable control-plane store
src/server/workers/         Worker Agent process adapters
src/shared/                 Shared TypeScript contracts
docs/                       Product and engineering docs
.github/                    CI, issue templates, PR template
```

Root-level `package.json`, `tsconfig.*.json`, `vite.config.ts`, `vitest.config.ts`, and `index.html` are normal for a Vite + TypeScript project. Application logic should live under `src`.

## Development

Common commands:

```sh
npm run typecheck
npm test
npm run check
npm run build
```

See [docs/development.md](docs/development.md) and [AGENTS.md](AGENTS.md) before making code changes.

## Safety

Do not commit `.agent-fleet/`, local worktrees, terminal logs, tokens, private hostnames, private IPs, or Worker session transcripts with secrets. See [SECURITY.md](SECURITY.md).

## License

Apache-2.0. The repository remains private until the owner intentionally publishes it.
