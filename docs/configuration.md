# Configuration

agent-fleet reads durable provider configuration from `AGENT_FLEET_CONFIG` when set, otherwise from `XDG_CONFIG_HOME/agent-fleet/config.json` or `~/.config/agent-fleet/config.json`. Environment variables remain available for local deployment overrides and backwards compatibility.

| Variable | Default | Description |
| --- | --- | --- |
| `AGENT_FLEET_HOST` | `127.0.0.1` | Host for the Fastify API. |
| `AGENT_FLEET_PORT` | `8787` | Port for the Fastify API. |
| `AGENT_FLEET_STATE` | `.agent-fleet/control-plane.json` | JSON control-plane state path. |
| `AGENT_FLEET_CONFIG` | `XDG_CONFIG_HOME/agent-fleet/config.json` or `~/.config/agent-fleet/config.json` | Durable provider config path override. |
| `AGENT_FLEET_WORKER_COMMAND` | unset | Legacy Worker command override. When set, it takes precedence over provider config for backwards compatibility. |
| `AGENT_FLEET_WORKER_ARGS` | empty | Legacy Worker command arguments, parsed with basic shell-style quoting. |
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

## Agent Providers

The first `steward config` or `steward providers` command creates the user-level provider config with a backwards-compatible Codex default. Provider auth, API keys, and tokens do not belong in this file; keep them in each provider CLI's auth store or environment.

```json
{
  "version": 1,
  "stewardProviderId": "codexyoloproxy",
  "stewardProvider": {
    "id": "codexyoloproxy",
    "type": "codex",
    "roles": ["steward"],
    "commandProfiles": {
      "default": {
        "commandTemplate": "codexyoloproxy"
      }
    },
    "defaultCommandProfile": "default",
    "defaultModel": null,
    "enabled": true
  },
  "workerProviders": [
    {
      "id": "codexyoloproxy",
      "type": "codex",
      "roles": ["worker"],
      "commandProfiles": {
        "default": {
          "commandTemplate": "codexyoloproxy"
        }
      },
      "defaultCommandProfile": "default",
      "defaultModel": null,
      "enabled": true,
      "priority": 100,
      "tags": [],
      "supportsLocal": true,
      "supportsRemote": true
    }
  ]
}
```

Provider fields:

| Field | Purpose |
| --- | --- |
| `type` | One of `codex`, `claude`, `gemini`, or `custom`. Legacy aliases `claude_code` and `gemini_cli` remain accepted for existing configs. |
| `roles` | `steward`, `worker`, or both. Worker dispatch only considers providers with the `worker` role. |
| `commandProfiles` | Named command and argv templates. v0.1.0 uses `defaultCommandProfile`; supported placeholders are `{model}`, `{providerId}`, and `{providerType}`. Legacy top-level `commandTemplate` is migrated into `commandProfiles.default`. |
| `defaultCommandProfile` | Command profile used when launching a provider. |
| `defaultModel` | Model inserted into `{model}` and recorded on Worker sessions. |
| `enabled` | Disabled providers are ignored for Worker dispatch. |
| `priority` | Higher priority wins after local/remote and tag filtering. |
| `tags` | Required goal resource tags a provider can satisfy, such as `high-cpu`, `gpu`, or `review`. An empty list means general purpose. |
| `supportsLocal` / `supportsRemote` | Whether the provider can be used for local or SSH remote dispatch. |

Common commands:

```sh
steward config init
steward config show
steward providers list
steward providers set \
  --id codex-main \
  --type codex \
  --command "codex exec --model {model} --sandbox workspace-write -" \
  --model gpt-5-codex \
  --priority 200
steward config set-steward --provider codex-main
```

Examples:

```sh
steward providers set --id claude-review --type claude --command "claude --model {model}" --model claude-sonnet --tags review
steward providers set --id gemini-heavy --type gemini --command "gemini --model {model}" --model gemini-2.5-pro --tags high-cpu --remote true
steward providers set --id local-custom --type custom --command "my-agent --model {model} --provider {providerId}" --model local-model
```

For non-interactive setup, run `steward config init` and then one or more `steward providers set ...` commands from a shell script or install step. The v0.1.0 CLI does not yet include an interactive first-run wizard or multi-select prompt, so non-TTY installs should print those commands or point users to this section.

The API also exposes provider config:

| Endpoint | Purpose |
| --- | --- |
| `GET /api/providers` | Returns the current provider config. |
| `PUT /api/providers` | Replaces provider config. Send either the config object or `{ "config": ... }`. |

v0.1.0 records and exposes the configured Steward provider, but the current Steward runtime remains deterministic and does not yet invoke the configured Steward provider as an LLM. Worker dispatch does use configured Worker providers when no explicit test/deployment adapter is injected. Existing `AGENT_FLEET_WORKER_COMMAND` and `AGENT_FLEET_WORKER_ARGS` deployments keep working as legacy overrides.

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

## IM Webhook Connectors

The MVP connector boundary is a generic webhook transport:

1. An IM gateway sends an inbound text payload to `POST /api/connectors/webhook/:connectorId`.
2. agent-fleet validates the connector signature and sender allowlist.
3. The payload is mapped to the same Steward conversation API used by the browser.
4. The Steward reply is returned as a generic text response for the gateway to deliver back to the IM user.

Web remains the richer configuration and history UI. IM connectors are intended for lightweight owner chat with the Steward, not for exposing raw Worker output or replacing dashboard review.

Runtime configuration is currently injected through the server app options. A deployment can load the same shape from local config or environment before calling `createApp`:

```ts
{
  id: "wechat-dev",
  label: "WeChat dev tunnel",
  transport: "webhook",
  provider: "wechat-compatible",
  token: process.env.WECHAT_WEBHOOK_TOKEN,
  signingSecret: process.env.WECHAT_WEBHOOK_SIGNING_SECRET,
  projectName: "mahjong",
  workspacePath: "/workspaces/mahjong",
  allowedSenderIds: ["wechat-user-1"]
}
```

Supported endpoints:

| Endpoint | Purpose |
| --- | --- |
| `GET /api/connectors/webhook` | Lists configured webhook connectors with `token` and `signingSecret` redacted. |
| `GET /api/connectors/webhook/:connectorId?token=...&challenge=...` | Token challenge placeholder for WeChat-compatible callback setup. `echostr` is also accepted as the challenge parameter. |
| `POST /api/connectors/webhook/:connectorId?timestamp=...&nonce=...&signature=...` | Receives a signed text message and returns the Steward reply as `{ messageType: "text", text }`. |

The generic POST signature is `HMAC-SHA256(signingSecret, timestamp + "." + nonce + "." + rawBody)` encoded as hex. This is intentionally a placeholder abstraction, because real WeChat callback verification and message formats vary by account type, gateway, and deployment. Real WeChat API calls are not part of this MVP; use a gateway, mock, or tunnel that can transform WeChat events into this generic payload.

Generic payload fields:

```json
{
  "senderId": "wechat-user-1",
  "conversationId": "wechat-room-1",
  "text": "What is the current recovery state?"
}
```

The mapper also accepts common WeChat-style aliases: `fromUserName` or `from` for `senderId`, `Content` or `content` for `text`, and `toUserName`, `to`, or `roomId` for `conversationId`.

Keep connector secrets out of git and `.agent-fleet` state. Public connector listing redacts `token` and `signingSecret`; logs and docs should use placeholders.
