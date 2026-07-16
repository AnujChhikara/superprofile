import type { InferSelectModel } from "drizzle-orm";
import type { conversations, messages } from "../db/schema.js";

// DTOs are the raw row shapes; JSON serialization turns Date → ISO string.
export type MessageDTO = InferSelectModel<typeof messages>;
export type ConversationDTO = InferSelectModel<typeof conversations>;

// CANONICAL — Tasks 7–10 use these exact names/payloads.
export interface ServerEvents {
  "message:new": { conversationId: string; message: MessageDTO };
  typing: {
    conversationId: string;
    senderType: "contact" | "agent";
    isTyping: boolean;
  };
  presence: { agentOnline: boolean }; // to visitors
  "visitor:presence": { conversationId: string; online: boolean }; // to agents
  read: {
    conversationId: string;
    senderType: "contact" | "agent";
    upToSeq: number;
  };
  "conversation:updated": { conversation: ConversationDTO };
  "summary:updated": {
    conversationId: string;
    body: string;
    updatedAt: string;
  };
}

export interface ClientEvents {
  "message:send": {
    conversationId: string;
    body: string;
    clientRef: string;
  };
  typing: { conversationId: string; isTyping: boolean };
  read: { conversationId: string; upToSeq: number };
  join: { conversationId: string }; // agent subscribes to a conversation room
}

// Room name helpers — single source of truth for room naming.
export const wsRoom = (workspaceId: string) => `ws:${workspaceId}`;
export const wsVisitorsRoom = (workspaceId: string) => `wsv:${workspaceId}`;
export const convRoom = (conversationId: string) => `conv:${conversationId}`;
