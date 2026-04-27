# agent-fleet

agent-fleet is a private-incubation, public-ready Steward Agent control plane for coordinating coding agents across projects, worktrees, sessions, and execution machines.

agent-fleet is the compact management system. Business project UI, product code, and project-specific implementation should stay in the target project workspace, not be embedded in this repository or dashboard.

The project is not open source yet. It is maintained with public-project hygiene now so the repository can become public later without restructuring its docs, safety process, or contributor expectations.

## What It Solves

agent-fleet removes the human bottleneck from multi-agent development:

- One Steward Agent becomes the only human-facing interface.
- The Steward coordinates, delegates, decides, and communicates; named Worker Agents own concrete implementation, source-of-truth verification, review/merge, cleanup, remote process audits, and status verification.
- Worker Agents such as Codex or Claude receive explicit Worker Names from the Steward, such as `agent-fleet-compact-dashboard-ui-202604261652`, and report back under that same heading. Random spawn nicknames remain secondary.
- Conversation history, goals, decisions, corrections, checkpoints, resume ids, process ids, Worker sessions, and project memory become durable state.
- Owner-facing review centers on Steward decisions, risks, confidence, reversibility, and required double-checks; raw Worker messages, stdout/stderr, command lines, resume mechanics, and protocol output are secondary audit/debug details.
- Every project goal has an explicit target `workspacePath`, for example `~/code/project/mahjong`; Worker cwd/project work happens there unless the owner explicitly asks to work on agent-fleet itself.
- Parallel work can be coordinated through git worktrees instead of one terminal checkout.
- Heavy agent work can later move to remote machines while the local Mac remains usable.

## Current Status

This repository currently contains the first local control-plane slice:

- Fastify API for goals, Steward Chat, dashboard state, decision corrections, recovery, execution nodes, and generic IM/webhook connectors.
- React dashboard for Steward Chat, Steward Intake with Target directory, Steward decision review, corrections, Worker session audit details, remote nodes, worktrees, events, and memory.
- `steward` CLI for status and terminal chat against the same API.
- JSON-backed local state at `.agent-fleet/control-plane.json`, including durable `stewardMessages` for Steward Chat.
- Command Worker adapter that can launch a real executable or a zsh alias; noninteractive executable configuration is preferred for API-launched Workers when available.
- SSH remote Worker adapter, remote node registration, remote readiness checks, remote workspace provisioning through git refs, and selective offload for high-load goals.
- Steward checkpoints and `GET /api/recovery` for reconstructing active goals, Worker sessions, resume commands, worktree metadata, and next actions after terminal disconnects or restarts.

Richer autonomous loop behavior, production-grade remote fleet operations, and broader multi-project review are post-v0.1.0 roadmap items.

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

The API listens on `127.0.0.1:8787` by default and the Vite web app listens on `127.0.0.1:5173`. To start them separately:

```sh
npm run dev:server
npm run dev:web
```

After installing or linking the package, the `steward` command can talk to the same API:

```sh
steward config init
steward providers list
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

## Web Dashboard

The dashboard is a compact control-plane surface, not a business app host. Use it to review Steward Chat, intake, active goals, decisions, risks, corrections, Worker sessions, remote nodes, worktrees, recovery, events, memory, and structured Worker reports. Raw Worker messages, stdout/stderr, command lines, resume mechanics, and protocol output are audit/debug details and are collapsed or secondary by default.

## IM And Webhook Connector

The v0.1.0 connector boundary is a generic webhook transport for IM gateways. It maps an authenticated inbound message to Steward Chat, binds it to an explicit `workspacePath`, and returns a generic text reply. It is not a full WeChat provider implementation.

See [docs/configuration.md](docs/configuration.md#im-webhook-connectors) for connector configuration, HMAC signing, challenge handling, and endpoint details.

## Remote Workers

Remote machines are stateless compute resources. Register SSH execution nodes with a scratch `workRoot`, tags, capacity, and optional proxy URL; the Steward selectively offloads high-load goals when a matching ready node has capacity, otherwise it records a local fallback. Remote workspaces are prepared through git refs by default, and private repository access requires owner-authorized credentials such as a deploy key lease.

See [docs/remote/macos-offload.md](docs/remote/macos-offload.md) and [docs/remote/codex-bootstrap.md](docs/remote/codex-bootstrap.md).

## Configuration

Copy `.env.example` if you want local overrides:

```sh
AGENT_FLEET_HOST=127.0.0.1
AGENT_FLEET_PORT=8787
AGENT_FLEET_STATE=.agent-fleet/control-plane.json
# Optional override. By default provider config is user-level:
# XDG_CONFIG_HOME/agent-fleet/config.json or ~/.config/agent-fleet/config.json.
# AGENT_FLEET_CONFIG=~/.config/agent-fleet/config.json
```

Provider and model setup is durable in the user-level provider config:

```sh
steward config init
steward providers set \
  --id codex-main \
  --type codex \
  --command "codex exec --model {model} --sandbox workspace-write -" \
  --model gpt-5-codex \
  --priority 200
steward config set-steward --provider codex-main
```

Provider config stores provider ids, types, roles, command templates, default models, priorities, tags, and local/remote suitability. It should not contain provider secrets; keep auth in each provider CLI or environment.

`AGENT_FLEET_WORKER_CWD` is only a fallback cwd for local Worker launch paths that do not receive a goal workspace. It is not the normal project selector; goals and Steward Chat context should carry `workspacePath`.

`AGENT_FLEET_WORKER_COMMAND` and `AGENT_FLEET_WORKER_ARGS` still work as legacy overrides and take precedence over provider config when set:

```sh
AGENT_FLEET_WORKER_COMMAND=codex
AGENT_FLEET_WORKER_ARGS="exec --json --sandbox workspace-write -"
```

Interactive aliases such as `codexyoloproxy` may fail when launched by the API without a TTY. Prefer a noninteractive provider command template for real Worker sessions.

See [docs/configuration.md](docs/configuration.md) for details.

## v0.1.0 Release Scope

v0.1.0 is a private/internal git release. Keep `private: true`; do not prepare npm public publishing. Release readiness means the repository builds, checks pass, docs avoid private host/path examples, and release branches are merged into `main` by the release manager before branch cleanup.

Known limitations:

- Local JSON state is inspectable and durable, but not a multi-user database.
- Remote execution requires explicit SSH, Codex, proxy, and repository credential setup per node.
- Webhook connectors are generic gateway adapters, not provider-specific IM SDKs.
- Provider config commands are durable and scriptable, but v0.1.0 does not yet include an interactive first-run wizard or multi-select prompt.
- The Steward provider is persisted and exposed for setup, but v0.1.0 does not yet run the Steward through that configured LLM provider. Worker dispatch does use configured Worker providers and models.
- Worker resume and report ingestion exist as control-plane state, but production supervision loops still need hardening.

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
