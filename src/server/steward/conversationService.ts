import type { ConversationTransport, StewardConversation, StewardMessage } from "../../shared/types.js";
import type { JsonControlPlaneStore } from "../store/jsonControlPlaneStore.js";
import type { StewardMessageLoop, StewardOwnerMessageResult } from "./stewardMessageLoop.js";

export interface ConversationOwnerMessageInput {
  conversationId: string;
  transport: string;
  externalMessageId: string | null;
  idempotencyKey: string | null;
  projectName: string | null;
  workspacePath: string | null;
  goalId: string | null;
  body: string;
}

export interface ConversationOwnerMessageResult extends StewardOwnerMessageResult {
  duplicate: boolean;
}

export interface ListConversationsFilter {
  projectName?: string;
  workspacePath?: string;
  transport?: string;
}

interface ConversationServiceOptions {
  store: JsonControlPlaneStore;
  messageLoop: StewardMessageLoop;
}

export class ConversationService {
  constructor(private readonly options: ConversationServiceOptions) {}

  async acceptOwnerMessage(input: ConversationOwnerMessageInput): Promise<ConversationOwnerMessageResult> {
    const transport = requireConversationTransport(input.transport);
    const conversation = await this.options.store.upsertConversation({
      id: input.conversationId,
      transport,
      projectName: input.projectName,
      workspacePath: input.workspacePath,
      externalConversationId: input.conversationId,
      title: input.projectName
    });
    const normalizedInput = {
      ...input,
      conversationId: conversation.id,
      transport
    };
    const duplicate = await this.findDuplicate(normalizedInput);

    if (duplicate !== null) {
      await this.options.store.recordMessageDelivery({
        conversationId: conversation.id,
        stewardMessageId: null,
        transport,
        direction: "inbound",
        externalMessageId: input.externalMessageId,
        idempotencyKey: input.idempotencyKey,
        deliveryStatus: "duplicate"
      });

      return {
        duplicate: true,
        ownerMessage: duplicate.ownerMessage,
        stewardMessage: duplicate.stewardMessage
      };
    }

    const result = await this.options.messageLoop.acceptOwnerMessage({
      conversationId: normalizedInput.conversationId,
      transport: normalizedInput.transport,
      externalMessageId: input.externalMessageId,
      idempotencyKey: input.idempotencyKey,
      projectName: input.projectName,
      workspacePath: input.workspacePath,
      goalId: input.goalId,
      body: input.body
    });

    await this.options.store.recordMessageDelivery({
      conversationId: conversation.id,
      stewardMessageId: result.ownerMessage.id,
      transport,
      direction: "inbound",
      externalMessageId: input.externalMessageId,
      idempotencyKey: input.idempotencyKey,
      deliveryStatus: "delivered"
    });

    return {
      duplicate: false,
      ...result
    };
  }

  async listMessages(conversationId: string): Promise<StewardMessage[]> {
    const messages = await this.options.store.listStewardMessages({ conversationId });

    if (messages.length > 0) {
      return messages;
    }

    return (await this.options.store.listStewardMessages()).filter(
      (message) => (message.conversationId ?? legacyConversationId(message)) === conversationId
    );
  }

  async listConversations(filter: ListConversationsFilter = {}): Promise<StewardConversation[]> {
    const transport =
      filter.transport === undefined ? undefined : requireConversationTransport(filter.transport);
    const messages = await this.options.store.listStewardMessages({
      projectName: filter.projectName,
      workspacePath: filter.workspacePath,
      transport
    });
    const conversations = new Map<string, StewardConversation>();

    for (const message of messages) {
      const conversationId = message.conversationId ?? legacyConversationId(message);
      const existing = conversations.get(conversationId);

      if (existing === undefined) {
        conversations.set(conversationId, {
          id: conversationId,
          projectName: message.projectName,
          workspacePath: message.workspacePath,
          goalId: message.goalId,
          transport: message.transport ?? null,
          messageCount: 1,
          createdAt: message.createdAt,
          lastMessageAt: message.createdAt
        });
        continue;
      }

      existing.messageCount += 1;
      if (Date.parse(message.createdAt) >= Date.parse(existing.lastMessageAt)) {
        existing.projectName = message.projectName;
        existing.workspacePath = message.workspacePath;
        existing.goalId = message.goalId;
        existing.transport = message.transport ?? existing.transport;
        existing.lastMessageAt = message.createdAt;
      }
      if (Date.parse(message.createdAt) < Date.parse(existing.createdAt)) {
        existing.createdAt = message.createdAt;
      }
    }

    return [...conversations.values()].sort(
      (left, right) => Date.parse(right.lastMessageAt) - Date.parse(left.lastMessageAt)
    );
  }

  private async findDuplicate(
    input: ConversationOwnerMessageInput & { transport: ConversationTransport }
  ): Promise<StewardOwnerMessageResult | null> {
    if (input.idempotencyKey === null && input.externalMessageId === null) {
      return null;
    }

    const messages = await this.options.store.listStewardMessages({ conversationId: input.conversationId });
    const ownerMessageIndex = messages.findIndex((message) => {
      if (message.role !== "owner" || message.transport !== input.transport) {
        return false;
      }

      return (
        (input.idempotencyKey !== null && message.idempotencyKey === input.idempotencyKey) ||
        (input.externalMessageId !== null && message.externalMessageId === input.externalMessageId)
      );
    });

    if (ownerMessageIndex === -1) {
      return null;
    }

    const stewardMessage = messages
      .slice(ownerMessageIndex + 1)
      .find((message) => message.role === "steward" && message.conversationId === input.conversationId);

    if (stewardMessage === undefined) {
      return null;
    }

    return {
      ownerMessage: messages[ownerMessageIndex],
      stewardMessage
    };
  }
}

function requireConversationTransport(value: string): ConversationTransport {
  if (value === "web" || value === "cli" || value === "im" || value === "api") {
    return value;
  }

  throw new Error("transport must be one of: web, cli, im, api");
}

function legacyConversationId(message: StewardMessage): string {
  if (message.goalId !== null) {
    return `goal:${message.goalId}`;
  }

  if (message.workspacePath !== null) {
    return `workspace:${message.workspacePath}`;
  }

  if (message.projectName !== null) {
    return `project:${message.projectName}`;
  }

  return "steward";
}
