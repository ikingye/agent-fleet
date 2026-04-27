# Getting Started

This guide brings up the local control plane, verifies the repository, opens the dashboard, and sends a first Steward Chat message.

## Requirements

- Node.js 24 or newer.
- npm 10 or newer.
- Git.
- A Worker command on `PATH`, such as `codex`.

For API-launched Workers, prefer a real executable command over an interactive shell alias. Aliases can depend on a TTY and fail when launched by the server process.

## Install

```sh
npm ci
npm run check
npm run build
```

The repository is intentionally private in v0.1.0. Do not prepare npm publishing.

## Configure A Worker Command

The default Worker command is `codexyoloproxy`, but real Worker sessions are more reliable with noninteractive Codex execution:

```sh
AGENT_FLEET_WORKER_COMMAND=codex
AGENT_FLEET_WORKER_ARGS="exec --json --sandbox workspace-write -"
```

You can put local overrides in `.env`. Keep `.env` and `.agent-fleet/` out of git.

## Start The App

```sh
npm run dev
```

Default URLs:

| Surface | URL |
| --- | --- |
| Web dashboard | `http://127.0.0.1:5173` |
| API | `http://127.0.0.1:8787` |

Run the server and web app separately when debugging one side:

```sh
npm run dev:server
npm run dev:web
```

## Send A First Steward Message

Open the dashboard and use Steward Chat, or use the CLI:

```sh
steward status
steward chat --workspace ~/code/project/example-app --project example-app
steward chat --workspace ~/code/project/example-app --once "What needs my review?"
```

Run `steward` with no arguments to open interactive terminal chat using the current directory as the workspace. Use `STEWARD_API_URL` or `--api-url` when the API is not running at the default local URL.

## Submit Work With Target Directory

Every goal needs an explicit target workspace. In the dashboard this is the Target directory field.

Use the business project workspace for business project work:

```sh
~/code/project/example-app
```

Use the agent-fleet repository only when the owner explicitly asks to change the control plane itself.

## Review The Dashboard

Use the dashboard to inspect:

- Steward Chat history.
- Active and completed goals.
- Steward decisions, risks, confidence, reversibility, and required double-checks.
- Human corrections and memory.
- Worker session audit details.
- Remote nodes, worktrees, events, reports, and recovery state.

Raw Worker messages and command output are secondary audit/debug details.

## Recover After Restart

agent-fleet stores local control-plane state at `.agent-fleet/control-plane.json` by default.

After a terminal disconnect, compacted Steward session, or computer restart:

```sh
npm run dev
curl http://127.0.0.1:8787/api/recovery
```

Use the recovery report before dispatching more work.

## Optional Next Steps

- Configure [IM/webhook connectors](connectors-security.md).
- Prepare [remote Workers](remote-workers.md).
- Read [Recovery And State](recovery.md).
- Build the [docs site](publishing.md) before release.
