import { createHmac, timingSafeEqual } from "node:crypto";
import type { StewardMessageLoop } from "../steward/stewardMessageLoop.js";

export type WebhookConnectorProvider = "generic" | "wechat-compatible";

export interface WebhookConnectorConfig {
  id: string;
  label: string;
  transport: "webhook";
  provider: WebhookConnectorProvider;
  token: string;
  signingSecret: string;
  projectName: string;
  workspacePath: string;
  allowedSenderIds: string[];
}

export interface PublicWebhookConnectorConfig extends Omit<WebhookConnectorConfig, "token" | "signingSecret"> {
  token: "[redacted]";
  signingSecret: "[redacted]";
}

export interface WebhookConnectorChallengeInput {
  connectorId: string;
  token: string | null;
  challenge: string | null;
}

export interface WebhookConnectorReceiveInput {
  connectorId: string;
  rawBody: string;
  headers: Readonly<Record<string, unknown>>;
  query: Readonly<Record<string, unknown>>;
}

export interface WebhookConnectorReply {
  connectorId: string;
  conversationId: string | null;
  recipientId: string;
  messageType: "text";
  text: string;
}

interface WebhookConnectorHandlerOptions {
  configs: WebhookConnectorConfig[];
  stewardMessageLoop: StewardMessageLoop;
}

interface InboundWebhookMessage {
  senderId: string;
  conversationId: string | null;
  text: string;
}

export function createWebhookConnectorHandler(options: WebhookConnectorHandlerOptions) {
  const configs = new Map(options.configs.map((config) => [config.id, config]));

  return {
    publicConfigs() {
      return options.configs.map(buildWebhookConnectorPublicConfig);
    },

    async verifyChallenge(input: WebhookConnectorChallengeInput): Promise<{ challenge: string }> {
      const config = requireConnectorConfig(configs, input.connectorId);

      if (input.token === null || !constantTimeEquals(input.token, config.token)) {
        throw new WebhookConnectorError(401, "Webhook connector token verification failed");
      }

      if (input.challenge === null || input.challenge.trim() === "") {
        throw new WebhookConnectorError(400, "Webhook connector challenge must be a non-empty string");
      }

      return { challenge: input.challenge };
    },

    async receiveMessage(input: WebhookConnectorReceiveInput): Promise<WebhookConnectorReply> {
      const config = requireConnectorConfig(configs, input.connectorId);

      verifyRequestSignature(config, input);

      const message = parseInboundWebhookMessage(input.rawBody);

      if (config.allowedSenderIds.length > 0 && !config.allowedSenderIds.includes(message.senderId)) {
        throw new WebhookConnectorError(403, "Webhook connector sender is not allowed");
      }

      const stewardResult = await options.stewardMessageLoop.acceptOwnerMessage({
        projectName: config.projectName,
        workspacePath: config.workspacePath,
        goalId: null,
        body: message.text
      });

      return {
        connectorId: config.id,
        conversationId: message.conversationId,
        recipientId: message.senderId,
        messageType: "text",
        text: stewardResult.stewardMessage.body
      };
    }
  };
}

export class WebhookConnectorError extends Error {
  constructor(
    readonly statusCode: 400 | 401 | 403 | 404,
    message: string
  ) {
    super(message);
  }
}

export function buildWebhookConnectorPublicConfig(config: WebhookConnectorConfig): PublicWebhookConnectorConfig {
  return {
    id: config.id,
    label: config.label,
    transport: config.transport,
    provider: config.provider,
    projectName: config.projectName,
    workspacePath: config.workspacePath,
    allowedSenderIds: [...config.allowedSenderIds],
    token: "[redacted]",
    signingSecret: "[redacted]"
  };
}

export function signWebhookConnectorRequest(input: {
  secret: string;
  timestamp: string;
  nonce: string;
  rawBody: string;
}): string {
  return createHmac("sha256", input.secret)
    .update(`${input.timestamp}.${input.nonce}.${input.rawBody}`)
    .digest("hex");
}

function requireConnectorConfig(
  configs: ReadonlyMap<string, WebhookConnectorConfig>,
  connectorId: string
): WebhookConnectorConfig {
  const config = configs.get(connectorId);

  if (config === undefined) {
    throw new WebhookConnectorError(404, `Webhook connector not found: ${connectorId}`);
  }

  return config;
}

function verifyRequestSignature(config: WebhookConnectorConfig, input: WebhookConnectorReceiveInput): void {
  const timestamp = optionalString(input.query.timestamp);
  const nonce = optionalString(input.query.nonce);
  const signature = optionalString(input.query.signature) ?? optionalString(input.headers["x-agent-fleet-signature"]);

  if (timestamp === null || nonce === null || signature === null) {
    throw new WebhookConnectorError(401, "Webhook connector signature verification failed");
  }

  const expected = signWebhookConnectorRequest({
    secret: config.signingSecret,
    timestamp,
    nonce,
    rawBody: input.rawBody
  });

  if (!constantTimeEquals(signature, expected)) {
    throw new WebhookConnectorError(401, "Webhook connector signature verification failed");
  }
}

function parseInboundWebhookMessage(rawBody: string): InboundWebhookMessage {
  let parsed: unknown;

  try {
    parsed = JSON.parse(rawBody);
  } catch {
    throw new WebhookConnectorError(400, "Webhook connector payload must be valid JSON");
  }

  if (parsed === null || typeof parsed !== "object") {
    throw new WebhookConnectorError(400, "Webhook connector payload must be a JSON object");
  }

  const body = parsed as Record<string, unknown>;
  const senderId = requiredPayloadString(body.senderId ?? body.fromUserName ?? body.from, "senderId");
  const text = requiredPayloadString(body.text ?? body.content ?? body.Content, "text");
  const conversationId = optionalString(body.conversationId ?? body.roomId ?? body.toUserName ?? body.to);

  return {
    senderId,
    conversationId,
    text
  };
}

function requiredPayloadString(value: unknown, name: string): string {
  const stringValue = optionalString(value);

  if (stringValue === null) {
    throw new WebhookConnectorError(400, `Webhook connector payload ${name} must be a non-empty string`);
  }

  return stringValue;
}

function optionalString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  return trimmed === "" ? null : trimmed;
}

function constantTimeEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
