# Configuration

agent-fleet reads configuration from environment variables.

| Variable | Default | Description |
| --- | --- | --- |
| `AGENT_FLEET_HOST` | `127.0.0.1` | Host for the Fastify API. |
| `AGENT_FLEET_PORT` | `8787` | Port for the Fastify API. |
| `AGENT_FLEET_STATE` | `.agent-fleet/control-plane.json` | JSON control-plane state path. |
| `AGENT_FLEET_WORKER_COMMAND` | `codexyoloproxy` | Worker command or zsh alias to launch. |
| `AGENT_FLEET_WORKER_ARGS` | empty | Worker command arguments, parsed with basic shell-style quoting. |
| `AGENT_FLEET_WORKER_CWD` | current working directory | Fallback local Worker cwd for launch paths that do not receive a goal workspace. This is not the normal project selector. |
| `AGENT_FLEET_MATERIALIZE_WORKTREES` | `false` | Set to `true` to create git worktrees before starting Worker sessions. |
| `STEWARD_API_URL` | `http://127.0.0.1:8787` | API URL used by the installed `steward` CLI. |
| `STEWARD_API_TOKEN` / `AGENT_FLEET_API_TOKEN` | empty | Optional bearer token sent by the `steward` CLI when a deployment requires API authentication. |

## Workspace Path

Each owner goal must identify the target `workspacePath`, for example `~/code/project/mahjong`. The dashboard labels this field Target directory. The Steward records that path with the goal and Worker sessions should run in that project workspace unless the owner explicitly asks to work on agent-fleet.

`AGENT_FLEET_WORKER_CWD` exists for fallback compatibility. It does not change the product contract that project work is scoped by `workspacePath`.

## Local State

`.agent-fleet/` is ignored by git. It may contain Steward Chat history in `stewardMessages`, goals, checkpoints, resume ids, process metadata, decisions, corrections, Worker sessions, remote nodes, worktrees, events, memory, and other local context. Do not commit it.

The default state path is `.agent-fleet/control-plane.json`. After a terminal disconnect or computer restart, use `GET /api/recovery` to inspect active goals, Worker sessions, resume commands, worktree metadata, the latest checkpoint, and recommended next actions.

## Worker Command Resolution

The current adapter first checks for an executable on PATH. If that fails, it checks whether the command is a zsh alias available through `zsh -ic`.

For real Codex Worker sessions launched by the API, prefer a noninteractive command configuration:

```sh
AGENT_FLEET_WORKER_COMMAND=codex
AGENT_FLEET_WORKER_ARGS="exec --json --sandbox workspace-write -"
```

The Steward supplies the goal prompt on stdin and starts the Worker with `cwd` set to the goal's `workspacePath`.

Aliases such as `codexyoloproxy` are useful for interactive terminal sessions:

```sh
alias codexyoloproxy='codexawakeproxy --yolo'
```

They may not be suitable for API-launched Workers because they can require a TTY and fail with errors such as `stdin is not a terminal`.
