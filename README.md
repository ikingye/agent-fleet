# agent-fleet

agent-fleet is a local-first control plane for coordinating coding agents across projects, git
worktrees, quality gates, and remote execution nodes.

The goal is to make agent throughput limited by available model tokens and compute, not by manual
project switching. A human gives goals; agent-fleet prepares isolated worktrees, dispatches worker
agents, runs checks, supports review, and keeps project progress visible in a web UI.

> Status: alpha. Codex is the first supported worker adapter. Claude Code and Gemini CLI adapters are
> planned.

## What It Does Today

- Local web dashboard for repositories, task queue, and remote node readiness.
- SQLite control plane stored under `.agent-fleet/`.
- Git worktree creation and merge helpers for concurrent development.
- Codex worker adapter for task execution and review.
- Quality gates for build/test commands.
- GitHub issue import through `gh`.
- Remote node registration and readiness checks for SSH, toolchain, npm direct access, and proxy
  fallback for GitHub/OpenAI/Google-style endpoints.
- Remote full-instance workflow for keeping laptop CPU load low.

## Requirements

- Node.js 24 or newer.
- npm 10 or newer.
- git.
- Optional: `gh` for GitHub issue import.
- Optional: Codex CLI for worker execution.
- Optional: Playwright browser dependencies for e2e tests.

## Quick Start

```bash
git clone https://github.com/ikingye/agent-fleet.git
cd agent-fleet
npm ci
npm run build
AGENT_FLEET_HOST=127.0.0.1 AGENT_FLEET_PORT=8787 npm start
```

Open:

```text
http://127.0.0.1:8787
```

For development:

```bash
npm run dev
```

This starts the Fastify API and Vite web UI.

## Remote Offload

For heavy parallel work, run the full agent-fleet instance on a Linux server and access the UI through
an SSH tunnel. This keeps builds, tests, Playwright, worktrees, and worker agents off your laptop.

```bash
ssh -fN -L 127.0.0.1:8788:127.0.0.1:8787 remote-dev
```

Open:

```text
http://127.0.0.1:8788
```

See [docs/remote/macos-offload.md](docs/remote/macos-offload.md) for proxy fallback and SSH tunnel
details.

## Configuration

Runtime configuration is environment-variable based:

| Variable | Default | Purpose |
| --- | --- | --- |
| `AGENT_FLEET_HOST` | `127.0.0.1` | HTTP bind host. |
| `AGENT_FLEET_PORT` | `8787` | HTTP bind port. |
| `AGENT_FLEET_DB` | `.agent-fleet/agent-fleet.sqlite` | SQLite database path. |

Copy [.env.example](.env.example) if you want a local template.

## Common Commands

```bash
npm run typecheck
npm run lint
npm test
npm run check
npm run build
npm run test:e2e
```

Install Playwright browsers before running e2e tests on a new machine:

```bash
npx playwright install --with-deps chromium
```

## Documentation

- [Getting started](docs/getting-started.md)
- [Architecture](docs/architecture.md)
- [Configuration](docs/configuration.md)
- [Remote macOS offload](docs/remote/macos-offload.md)
- [Development guide](docs/development.md)
- [Roadmap](ROADMAP.md)

## Community

agent-fleet is intended to become a public, community-maintained developer tool. Contributions should
keep the system pragmatic, testable, and safe for local and remote developer machines.

- Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a PR.
- Read [SECURITY.md](SECURITY.md) before reporting vulnerabilities.
- Use GitHub Issues for bugs and feature requests.
- Keep credentials, SSH keys, tokens, local state, logs, and worktrees out of commits.

## License

Apache-2.0. See [LICENSE](LICENSE).
