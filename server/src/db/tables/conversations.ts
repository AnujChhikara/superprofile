import { pgTable, text, timestamp, integer, index } from "drizzle-orm/pg-core";
import { id, ws } from "./_helpers.js";

export const conversations = pgTable(
  "conversations",
  {
    id: id(),
    workspaceId: ws(),
    contactId: text("contact_id").notNull(),
    channel: text("channel", { enum: ["chat", "email"] }).notNull(),
    status: text("status", { enum: ["open", "snoozed", "resolved"] })
      .notNull()
      .default("open"),
    assigneeId: text("assignee_id"),
    subject: text("subject"),
    snoozedUntil: timestamp("snoozed_until"),
    lastMessageAt: timestamp("last_message_at").defaultNow().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("conv_ws_last").on(t.workspaceId, t.lastMessageAt)],
);

export const messages = pgTable(
  "messages",
  {
    id: id(),
    conversationId: text("conversation_id").notNull(),
    workspaceId: ws(),
    senderType: text("sender_type", {
      enum: ["contact", "agent", "system"],
    }).notNull(),
    senderId: text("sender_id"),
    body: text("body").notNull(),
    emailMessageId: text("email_message_id"),
    inReplyTo: text("in_reply_to"),
    emailReferences: text("email_references"),
    seq: integer("seq").generatedAlwaysAsIdentity(),
    readAt: timestamp("read_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("msg_conv_seq").on(t.conversationId, t.seq),
    index("msg_emid").on(t.workspaceId, t.emailMessageId),
  ],
);
