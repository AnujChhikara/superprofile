import { EventEmitter } from "events";
import type { InferSelectModel } from "drizzle-orm";
import type { conversations, messages } from "./db/schema.js";

type Conversation = InferSelectModel<typeof conversations>;
type Message = InferSelectModel<typeof messages>;

export interface MessageCreatedPayload {
  workspaceId: string;
  conversation: Conversation;
  message: Message;
}

export interface ConversationUpdatedPayload {
  workspaceId: string;
  conversation: Conversation;
}

const emitter = new EventEmitter();
emitter.setMaxListeners(50);

export function onMessageCreated(
  handler: (payload: MessageCreatedPayload) => void
): void {
  emitter.on("messageCreated", handler);
}

export function emitMessageCreated(payload: MessageCreatedPayload): void {
  emitter.emit("messageCreated", payload);
}

export function onConversationUpdated(
  handler: (payload: ConversationUpdatedPayload) => void
): void {
  emitter.on("conversationUpdated", handler);
}

export function emitConversationUpdated(
  payload: ConversationUpdatedPayload
): void {
  emitter.emit("conversationUpdated", payload);
}
