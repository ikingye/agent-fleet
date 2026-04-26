# Configuration

agent-fleet reads configuration from environment variables.

| Variable | Default | Description |
| --- | --- | --- |
| `AGENT_FLEET_HOST` | `127.0.0.1` | Host for the Fastify API. |
| `AGENT_FLEET_PORT` | `8787` | Port for the Fastify API. |
| `AGENT_FLEET_STATE` | `.agent-fleet/control-plane.json` | JSON control-plane state path. |
| `AGENT_FLEET_WORKER_COMMAND` | `codexyoloproxy` | Worker command or zsh alias to launch. |
| `AGENT_FLEET_WORKER_CWD` | current working directory | Working directory passed to Worker sessions. |
| `AGENT_FLEET_MATERIALIZE_WORKTREES` | `false` | Set to `true` to create git worktrees before starting Worker sessions. |

## Local State

`.agent-fleet/` is ignored by git. It may contain resume ids, process metadata, decisions, corrections, and other local context. Do not commit it.

## Worker Command Resolution

The current adapter first checks for an executable on PATH. If that fails, it checks whether the command is a zsh alias available through `zsh -ic`.

This supports aliases such as:

```sh
alias codexyoloproxy='codexawakeproxy --yolo'
```
