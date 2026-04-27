import { describe, expect, it, vi } from "vitest";
import {
  buildWebhookConnectorPublicConfig,
  createWebhookConnectorHandler,
  signWebhookConnectorRequest,
  type WebhookConnectorConfig
} from "./webhookConnector.js";
import type { ConversationService } from "../steward/conversationService.js";

const baseConfig: WebhookConnectorConfig = {
  id: "wechat-dev",
  label: "WeChat dev tunnel",
  transport: "webhook",
  provider: "wechat-compatible",
  token: "callback-token",
  signingSecret: "signing-secret",
  projectName: "mahjong",
  workspacePath: "/Users/yewang/code/project/mahjong",
  allowedSenderIds: ["wechat-user-1"]
};

function conversationServiceStub(reply = "Steward reply") {
  const acceptOwnerMessage = vi.fn<ConversationService["acceptOwnerMessage"]>(async (input) => ({
    duplicate: false,
    ownerMessage: {
      id: "owner-message-1",
      role: "owner",
      conversationId: input.conversationId,
      transport: input.transport,
      externalMessageId: input.externalMessageId,
      idempotencyKey: input.idempotencyKey,
      projectName: input.projectName,
      workspacePath: input.workspacePath,
      goalId: input.goalId,
      body: input.body,
      createdAt: "2026-04-27T02:24:00.000Z"
    },
    stewardMessage: {
      id: "steward-message-1",
      role: "steward",
      conversationId: input.conversationId,
      transport: input.transport,
      projectName: input.projectName,
      workspacePath: input.workspacePath,
      goalId: input.goalId,
      body: reply,
      createdAt: "2026-04-27T02:24:01.000Z"
    }
  }));

  return {
    acceptOwnerMessage
  } as unknown as ConversationService;
}

describe("webhook connector", () => {
  it("accepts a WeChat-compatible token challenge without exposing connector secrets", async () => {
    const handler = createWebhookConnectorHandler({
      configs: [baseConfig],
      conversationService: conversationServiceStub()
    });

    await expect(
      handler.verifyChallenge({
        connectorId: "wechat-dev",
        token: "callback-token",
        challenge: "wechat-challenge"
      })
    ).resolves.toEqual({ challenge: "wechat-challenge" });
    expect(buildWebhookConnectorPublicConfig(baseConfig)).toEqual({
      id: "wechat-dev",
      label: "WeChat dev tunnel",
      transport: "webhook",
      provider: "wechat-compatible",
      projectName: "mahjong",
      workspacePath: "/Users/yewang/code/project/mahjong",
      allowedSenderIds: ["wechat-user-1"],
      token: "[redacted]",
      signingSecret: "[redacted]"
    });
  });

  it("rejects token challenges with the wrong token", async () => {
    const handler = createWebhookConnectorHandler({
      configs: [baseConfig],
      conversationService: conversationServiceStub()
    });

    await expect(
      handler.verifyChallenge({
        connectorId: "wechat-dev",
        token: "wrong-token",
        challenge: "wechat-challenge"
      })
    ).rejects.toThrow("Webhook connector token verification failed");
  });

  it("maps signed inbound IM messages to the Steward conversation and maps the Steward reply back to text", async () => {
    const conversationService = conversationServiceStub("Workspace status is healthy.");
    const handler = createWebhookConnectorHandler({
      configs: [baseConfig],
      conversationService
    });
    const rawBody = JSON.stringify({
      senderId: "wechat-user-1",
      conversationId: "wechat-room-1",
      messageId: "wechat-message-1",
      text: "What is the current status?"
    });
    const timestamp = "1777256640";
    const nonce = "nonce-1";

    const result = await handler.receiveMessage({
      connectorId: "wechat-dev",
      rawBody,
      headers: {},
      query: {
        timestamp,
        nonce,
        signature: signWebhookConnectorRequest({
          secret: "signing-secret",
          timestamp,
          nonce,
          rawBody
        })
      }
    });

    expect(conversationService.acceptOwnerMessage).toHaveBeenCalledWith({
      conversationId: "webhook:wechat-dev:wechat-room-1",
      transport: "im",
      externalMessageId: "wechat-message-1",
      idempotencyKey: "wechat-message-1",
      projectName: "mahjong",
      workspacePath: "/Users/yewang/code/project/mahjong",
      goalId: null,
      body: "What is the current status?"
    });
    expect(result).toEqual({
      connectorId: "wechat-dev",
      conversationId: "wechat-room-1",
      recipientId: "wechat-user-1",
      duplicate: false,
      messageType: "text",
      text: "Workspace status is healthy."
    });
  });

  it("rejects signed inbound messages from senders outside the connector allowlist", async () => {
    const handler = createWebhookConnectorHandler({
      configs: [baseConfig],
      conversationService: conversationServiceStub()
    });
    const rawBody = JSON.stringify({
      senderId: "wechat-user-2",
      text: "Implement something expensive"
    });
    const timestamp = "1777256640";
    const nonce = "nonce-2";

    await expect(
      handler.receiveMessage({
        connectorId: "wechat-dev",
        rawBody,
        headers: {},
        query: {
          timestamp,
          nonce,
          signature: signWebhookConnectorRequest({
            secret: "signing-secret",
            timestamp,
            nonce,
            rawBody
          })
        }
      })
    ).rejects.toThrow("Webhook connector sender is not allowed");
  });

  it("rejects signed inbound messages when the connector sender allowlist is empty", async () => {
    const conversationService = conversationServiceStub();
    const handler = createWebhookConnectorHandler({
      configs: [{ ...baseConfig, allowedSenderIds: [] }],
      conversationService
    });
    const rawBody = JSON.stringify({
      senderId: "wechat-user-1",
      text: "Implement something expensive"
    });
    const timestamp = "1777256640";
    const nonce = "nonce-empty-allowlist";

    await expect(
      handler.receiveMessage({
        connectorId: "wechat-dev",
        rawBody,
        headers: {},
        query: {
          timestamp,
          nonce,
          signature: signWebhookConnectorRequest({
            secret: "signing-secret",
            timestamp,
            nonce,
            rawBody
          })
        }
      })
    ).rejects.toThrow("Webhook connector sender allowlist is empty");
    expect(conversationService.acceptOwnerMessage).not.toHaveBeenCalled();
  });

  it("rejects inbound messages with an invalid signature before reaching the Steward", async () => {
    const conversationService = conversationServiceStub();
    const handler = createWebhookConnectorHandler({
      configs: [baseConfig],
      conversationService
    });

    await expect(
      handler.receiveMessage({
        connectorId: "wechat-dev",
        rawBody: JSON.stringify({
          senderId: "wechat-user-1",
          text: "What changed?"
        }),
        headers: {},
        query: {
          timestamp: "1777256640",
          nonce: "nonce-3",
          signature: "bad-signature"
        }
      })
    ).rejects.toThrow("Webhook connector signature verification failed");
    expect(conversationService.acceptOwnerMessage).not.toHaveBeenCalled();
  });
});
