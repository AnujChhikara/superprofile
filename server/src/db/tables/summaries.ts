import { pgTable, text, timestamp, integer } from "drizzle-orm/pg-core";
import { ws } from "./_helpers.js";

export const summaries = pgTable("summaries", {
  conversationId: text("conversation_id").primaryKey(),
  workspaceId: ws(),
  body: text("body").notNull(),
  messageCount: integer("message_count").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
