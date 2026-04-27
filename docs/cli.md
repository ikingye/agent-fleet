# steward CLI

The `steward` CLI is the terminal interface to the same API used by the dashboard. It is useful for quick status checks, one-off messages, and interactive chat from a project directory.

## Commands

| Command | Purpose |
| --- | --- |
| `steward` | Open interactive chat using the current directory as `workspacePath`. |
| `steward status` | Print API health, active goal count, active Worker count, latest checkpoint summary, and next actions. |
| `steward chat` | Send a Steward Chat message or open interactive chat with explicit options. |
| `steward serve` | Start the local API server entrypoint after build. |

## Status

```sh
steward status
```

Use this before dispatching work after a restart. It surfaces recovery-oriented state without forcing the owner into raw Worker session details.

## One-Off Chat

```sh
steward chat \
  --workspace ~/code/project/example-app \
  --project example-app \
  --once "Summarize active blockers."
```

The message is persisted through the same Steward conversation path as the dashboard.

## Interactive Chat

```sh
steward chat --workspace ~/code/project/example-app --project example-app
```

Inside interactive chat:

| Input | Effect |
| --- | --- |
| `/workspace <path>` | Change the target workspace. |
| `/project <name>` | Change the project label. |
| `/status` | Fetch API and recovery status. |
| `/web` | Print the dashboard URL. |
| `/quit` | Exit the chat. |

## API URL And Tokens

The CLI defaults to:

```text
http://127.0.0.1:8787
```

Override it with:

```sh
STEWARD_API_URL=http://127.0.0.1:8787 steward status
steward --api-url http://127.0.0.1:8787 status
```

When a deployment requires API authentication, set a bearer token:

```sh
STEWARD_API_TOKEN=<redacted> steward status
```

`AGENT_FLEET_API_TOKEN` is also accepted for compatibility. Do not commit real tokens.

## Troubleshooting

If `steward status` cannot connect, start the API:

```sh
npm run dev:server
```

If Worker launch fails from the dashboard but works in an interactive shell, check whether `AGENT_FLEET_WORKER_COMMAND` points to an alias that needs a TTY. Prefer a noninteractive executable command:

```sh
AGENT_FLEET_WORKER_COMMAND=codex
AGENT_FLEET_WORKER_ARGS="exec --json --sandbox workspace-write -"
```
