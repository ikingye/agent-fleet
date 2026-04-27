import type { StewardConversation, StewardMessage } from "../../shared/types.js";
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
    const duplicate = await this.findDuplicate(input);

    if (duplicate !== null) {
      return {
        duplicate: true,
        ownerMessage: duplicate.ownerMessage,
        stewardMessage: duplicate.stewardMessage
      };
    }

    const result = await this.options.messageLoop.acceptOwnerMessage({
      conversationId: input.conversationId,
      transport: input.transport,
      externalMessageId: input.externalMessageId,
      idempotencyKey: input.idempotencyKey,
      projectName: input.projectName,
      workspacePath: input.workspacePath,
      goalId: input.goalId,
      body: input.body
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
    const messages = await this.options.store.listStewardMessages({
      projectName: filter.projectName,
      workspacePath: filter.workspacePath,
      transport: filter.transport
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

  private async findDuplicate(input: ConversationOwnerMessageInput): Promise<StewardOwnerMessageResult | null> {
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
