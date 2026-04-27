# Configuration Reference

agent-fleet reads runtime configuration from environment variables and server app options.

## Environment Variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `AGENT_FLEET_HOST` | `127.0.0.1` | Fastify API bind host. |
| `AGENT_FLEET_PORT` | `8787` | Fastify API port. |
| `AGENT_FLEET_STATE` | `.agent-fleet/control-plane.json` | JSON control-plane state path. |
| `AGENT_FLEET_WORKER_COMMAND` | `codexyoloproxy` | Worker command or zsh alias. |
| `AGENT_FLEET_WORKER_ARGS` | empty | Worker command arguments parsed with shell-style quoting. |
| `AGENT_FLEET_WORKER_CWD` | current working directory | Fallback cwd only when no goal workspace is supplied. |
| `AGENT_FLEET_MATERIALIZE_WORKTREES` | `false` | Create git worktrees before starting Worker sessions when set to `true`. |
| `STEWARD_API_URL` | `http://127.0.0.1:8787` | API URL used by the installed `steward` CLI. |
| `STEWARD_API_TOKEN` | empty | Optional bearer token for CLI requests. |
| `AGENT_FLEET_API_TOKEN` | empty | Alternate bearer token variable accepted by the CLI. |

## Local Development Example

```sh
AGENT_FLEET_HOST=127.0.0.1
AGENT_FLEET_PORT=8787
AGENT_FLEET_STATE=.agent-fleet/control-plane.json
AGENT_FLEET_WORKER_COMMAND=codex
AGENT_FLEET_WORKER_ARGS="exec --json --sandbox workspace-write -"
```

Do not commit `.env`, `.env.*`, `.agent-fleet/`, logs, or secrets.

## Workspace Selection

The normal project selector is the goal `workspacePath`.

Use:

```text
~/code/project/example-app
```

Do not use `AGENT_FLEET_WORKER_CWD` to choose the project for normal work. It is a compatibility fallback for launch paths that lack a goal workspace.

## Worker Command

The local Worker adapter first checks for an executable on `PATH`. If that fails, it checks whether the command is a zsh alias available through an interactive shell.

Noninteractive executable configuration is preferred:

```sh
AGENT_FLEET_WORKER_COMMAND=codex
AGENT_FLEET_WORKER_ARGS="exec --json --sandbox workspace-write -"
```

Aliases may fail without a TTY.

## Connector Configuration Shape

Webhook connectors are configured through server app options. A deployment may load the same shape from ignored local config or environment:

```ts
{
  id: "im-gateway-dev",
  label: "IM gateway dev tunnel",
  transport: "webhook",
  provider: "wechat-compatible",
  token: process.env.WEBHOOK_CONNECTOR_TOKEN,
  signingSecret: process.env.WEBHOOK_CONNECTOR_SIGNING_SECRET,
  projectName: "example-app",
  workspacePath: "/workspaces/example-app",
  allowedSenderIds: ["owner-user-1"]
}
```

Public connector listings must redact `token` and `signingSecret`.

## Remote Node Fields

| Field | Required | Notes |
| --- | --- | --- |
| `name` | Yes | Stable unique node name. Posting the same name updates the node. |
| `kind` | Yes | `remote` for SSH-backed nodes, `local` for the control-plane host. |
| `status` | Yes | `unknown`, `offline`, or `ready`. |
| `sshHost` | For ready remote nodes | SSH target such as `remote-worker-01`; use `null` for local nodes. |
| `workRoot` | Yes | Absolute scratch path. Prefer `/tmp/agent-fleet/work` for stateless remotes. |
| `proxyUrl` | No | Forwarded proxy URL visible from the remote process, or `null`. |
| `tags` | No | Capability tags such as `remote`, `linux`, `gpu`, `high-cpu`, or `cuda`. |
| `capacity` | No | Maximum concurrent Worker sessions. Missing capacity defaults to `1`. |

## Docs Site Variables

The docs site uses a separate static Vite build.

| Variable | Default | Purpose |
| --- | --- | --- |
| `DOCS_BASE` | derived from `GITHUB_REPOSITORY`, usually `/agent-fleet/` | Base path for GitHub Pages or a custom domain. |

For a custom domain or root deployment:

```sh
DOCS_BASE=/ npm run docs:build
```

For a project Pages URL, the default base is normally correct.
