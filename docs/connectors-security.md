# Connectors And Security

Connectors are owner-facing transports into Steward Chat. They are not separate Steward implementations and should not expose raw Worker control.

## v0.1.0 Connector Boundary

v0.1.0 includes a generic webhook connector for IM gateway experiments.

The connector flow:

1. An IM gateway sends a text payload to agent-fleet.
2. agent-fleet verifies connector id, callback token, request signature, and sender allowlist.
3. The connector maps transport fields into Steward Chat input.
4. The Steward records the owner message and returns a text reply.
5. The gateway delivers that reply back to the external channel.

The connector is a generic gateway boundary, not a full WeChat/IM SDK or provider-specific integration.

## Endpoints

| Endpoint | Purpose |
| --- | --- |
| `GET /api/connectors/webhook` | List configured connectors with secrets redacted. |
| `GET /api/connectors/webhook/:connectorId?token=...&challenge=...` | Token challenge placeholder for callback setup. `echostr` is also accepted. |
| `POST /api/connectors/webhook/:connectorId?timestamp=...&nonce=...&signature=...` | Receive a signed text message and return a generic text reply. |

## Payload Shape

Generic payload:

```json
{
  "senderId": "owner-user-1",
  "conversationId": "ops-room-1",
  "text": "What needs my review?"
}
```

The mapper also accepts common aliases:

| Generic field | Accepted aliases |
| --- | --- |
| `senderId` | `fromUserName`, `from` |
| `conversationId` | `toUserName`, `to`, `roomId` |
| `text` | `Content`, `content` |

Every connector must bind inbound messages to a configured `workspacePath`. IM-originated work is scoped the same way as dashboard-originated work.

## HMAC Signature

POST requests use:

```text
HMAC-SHA256(signingSecret, timestamp + "." + nonce + "." + rawBody)
```

The result is encoded as hex and supplied in the `signature` query parameter.

Use placeholders in docs, tests, and examples:

```sh
WECHAT_WEBHOOK_TOKEN=<redacted>
WECHAT_WEBHOOK_SIGNING_SECRET=<redacted>
```

Do not commit real connector tokens, signing secrets, raw gateway transcripts, or `.agent-fleet` state.

## Security Model

Required controls:

- Bind the API to `127.0.0.1` unless the deployment intentionally exposes it behind an authenticated gateway.
- Use per-connector callback tokens.
- Sign POST bodies with connector-specific HMAC secrets.
- Restrict `allowedSenderIds` as the sender allowlist.
- Redact connector secrets from public configuration and logs.
- Treat external channel input as untrusted owner text until authenticated by transport controls.
- Keep Worker stdout/stderr and command details out of connector replies by default.

## What Connectors Should Not Do

Connectors should not:

- Start Workers directly.
- Bypass Steward decisions.
- Expose raw Worker output as the default reply.
- Let arbitrary senders choose unrestricted workspaces.
- Store provider secrets in committed files.
- Copy business project data into the agent-fleet dashboard.

## Roadmap

Post-v0.1.0 work can add provider-specific adapters, richer gateway challenge behavior, outbound delivery retries, and deployment profiles. Those adapters should still map into the same Steward Chat and decision model.
