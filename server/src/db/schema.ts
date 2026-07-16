import { pgTable, text, timestamp, integer, boolean, uniqueIndex, index, customType } from "drizzle-orm/pg-core";
const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });
const id = () => text("id").primaryKey();
const ws = () => text("workspace_id").notNull();

export const users = pgTable("users", {
  id: id(), email: text("email").notNull().unique(), googleId: text("google_id").notNull().unique(),
  name: text("name").notNull(), avatarUrl: text("avatar_url"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export const sessions = pgTable("sessions", {
  id: id(), tokenHash: text("token_hash").notNull().unique(), userId: text("user_id").notNull(),
  expiresAt: timestamp("expires_at").notNull(), createdAt: timestamp("created_at").defaultNow().notNull(),
});
export const workspaces = pgTable("workspaces", {
  id: id(), name: text("name").notNull(), slug: text("slug").notNull().unique(),
  publicKey: text("public_key").notNull().unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export const memberships = pgTable("memberships", {
  id: id(), userId: text("user_id").notNull(), workspaceId: ws(),
  role: text("role", { enum: ["admin", "agent"] }).notNull(),
}, t => [uniqueIndex("mem_user_ws").on(t.userId, t.workspaceId)]);
export const invites = pgTable("invites", {
  id: id(), workspaceId: ws(), email: text("email").notNull(),
  role: text("role", { enum: ["admin", "agent"] }).notNull(), token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(), acceptedAt: timestamp("accepted_at"),
});
export const contacts = pgTable("contacts", {
  id: id(), workspaceId: ws(), email: text("email"), name: text("name"),
  visitorToken: text("visitor_token"), lastSeenAt: timestamp("last_seen_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, t => [uniqueIndex("contact_visitor").on(t.workspaceId, t.visitorToken),
         index("contact_email").on(t.workspaceId, t.email)]);
export const conversations = pgTable("conversations", {
  id: id(), workspaceId: ws(), contactId: text("contact_id").notNull(),
  channel: text("channel", { enum: ["chat", "email"] }).notNull(),
  status: text("status", { enum: ["open", "snoozed", "resolved"] }).notNull().default("open"),
  assigneeId: text("assignee_id"), subject: text("subject"),
  snoozedUntil: timestamp("snoozed_until"),
  lastMessageAt: timestamp("last_message_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, t => [index("conv_ws_last").on(t.workspaceId, t.lastMessageAt)]);
export const messages = pgTable("messages", {
  id: id(), conversationId: text("conversation_id").notNull(), workspaceId: ws(),
  senderType: text("sender_type", { enum: ["contact", "agent", "system"] }).notNull(),
  senderId: text("sender_id"), body: text("body").notNull(),
  emailMessageId: text("email_message_id"), inReplyTo: text("in_reply_to"), emailReferences: text("email_references"),
  seq: integer("seq").generatedAlwaysAsIdentity(),
  readAt: timestamp("read_at"), createdAt: timestamp("created_at").defaultNow().notNull(),
}, t => [index("msg_conv_seq").on(t.conversationId, t.seq), index("msg_emid").on(t.workspaceId, t.emailMessageId)]);
export const kbCategories = pgTable("kb_categories", {
  id: id(), workspaceId: ws(), name: text("name").notNull(), slug: text("slug").notNull(), position: integer("position").notNull().default(0),
}, t => [uniqueIndex("cat_ws_slug").on(t.workspaceId, t.slug)]);
export const kbArticles = pgTable("kb_articles", {
  id: id(), workspaceId: ws(), categoryId: text("category_id"), title: text("title").notNull(),
  slug: text("slug").notNull(), bodyHtml: text("body_html").notNull().default(""), bodyText: text("body_text").notNull().default(""),
  status: text("status", { enum: ["draft", "published"] }).notNull().default("draft"),
  searchVector: tsvector("search_vector"), updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, t => [uniqueIndex("art_ws_slug").on(t.workspaceId, t.slug)]);
export const summaries = pgTable("summaries", {
  conversationId: text("conversation_id").primaryKey(), workspaceId: ws(),
  body: text("body").notNull(), messageCount: integer("message_count").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export const customDomains = pgTable("custom_domains", {
  id: id(), workspaceId: ws(), hostname: text("hostname").notNull().unique(),
  status: text("status", { enum: ["pending_dns", "verifying", "active", "failed"] }).notNull().default("pending_dns"),
  error: text("error"), verifiedAt: timestamp("verified_at"), createdAt: timestamp("created_at").defaultNow().notNull(),
});
export const cannedResponses = pgTable("canned_responses", {
  id: id(), workspaceId: ws(), title: text("title").notNull(), body: text("body").notNull(), createdBy: text("created_by"),
});
