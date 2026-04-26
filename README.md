# agent-fleet

agent-fleet is a private-incubation, public-ready Steward Agent control plane for coordinating coding agents across projects, worktrees, sessions, and execution machines.

The project is not open source yet. It is maintained with public-project hygiene now so the repository can become public later without restructuring its docs, safety process, or contributor expectations.

## What It Solves

agent-fleet removes the human bottleneck from multi-agent development:

- One Steward Agent becomes the only human-facing interface.
- Worker Agents such as Codex or Claude receive instructions from the Steward as if it were the owner.
- Resume ids, process ids, decisions, corrections, and project context become durable state.
- Parallel work can be coordinated through git worktrees instead of one terminal checkout.
- Heavy agent work can later move to remote machines while the local Mac remains usable.

## Current Status

This repository currently contains the first local control-plane slice:

- Fastify API for goals, dashboard state, and decision corrections.
- React dashboard for Steward intake, decisions, Worker sessions, and memory.
- JSON-backed local state at `.agent-fleet/control-plane.json`.
- Command Worker adapter that can launch a real executable or a zsh alias such as `codexyoloproxy`.

Remote execution, automatic worktree scheduling, resumable long-running supervision, and richer learning memory are roadmap items.

## Quick Start

Requirements:

- Node.js 24+
- npm 10+
- A Worker command on PATH or as a zsh alias, for example `codexyoloproxy`

Install and verify:

```sh
npm ci
npm run check
npm run build
```

Run locally:

```sh
npm run dev
```

The API listens on `127.0.0.1:8787` by default and the Vite web app listens on `127.0.0.1:5173`.

## Configuration

Copy `.env.example` if you want local overrides:

```sh
AGENT_FLEET_HOST=127.0.0.1
AGENT_FLEET_PORT=8787
AGENT_FLEET_STATE=.agent-fleet/control-plane.json
AGENT_FLEET_WORKER_COMMAND=codexyoloproxy
AGENT_FLEET_WORKER_CWD=/path/to/project
```

See [docs/configuration.md](docs/configuration.md) for details.

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
