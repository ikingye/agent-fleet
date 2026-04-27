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
  workspacePath: "/Users/yewang/code/project/mahjong",
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
