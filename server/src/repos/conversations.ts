import { db, newId } from "../db/client.js";
import {
  contacts,
  conversations,
  messages,
} from "../db/schema.js";
import {
  and,
  eq,
  isNull,
  desc,
  asc,
  gt,
  sql,
  count,
  inArray,
} from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";

type Conversation = InferSelectModel<typeof conversations>;
type Message = InferSelectModel<typeof messages>;
type Contact = InferSelectModel<typeof contacts>;

// Typed 404 error for easy catching
function notFound(msg = "not found"): never {
  const err = new Error(msg) as Error & { status: number };
  err.status = 404;
  throw err;
}

// ------------------------------------------------------------------
// List conversations (with contact, last message preview, unread count)
// ------------------------------------------------------------------
export interface ConversationRow extends Conversation {
  contact: Contact | null;
  lastMessageBody: string | null;
  unreadCount: number;
}

export async function listConversations(
  workspaceId: string,
  opts: {
    channel?: "chat" | "email";
    status?: "open" | "snoozed" | "resolved";
    assigneeId?: string;
    limit?: number;
  }
): Promise<ConversationRow[]> {
  const limit = opts.limit ?? 50;

  const filters = [eq(conversations.workspaceId, workspaceId)];
  if (opts.channel) filters.push(eq(conversations.channel, opts.channel));
  if (opts.status) filters.push(eq(conversations.status, opts.status));
  // "unassigned" is a sentinel meaning assigneeId IS NULL; a concrete id
  // filters to that agent; undefined means no assignee filter at all.
  if (opts.assigneeId === "unassigned")
    filters.push(isNull(conversations.assigneeId));
  else if (opts.assigneeId)
    filters.push(eq(conversations.assigneeId, opts.assigneeId));

  const rows = await db
    .select()
    .from(conversations)
    .where(and(...filters))
    .orderBy(desc(conversations.lastMessageAt))
    .limit(limit);

  if (rows.length === 0) return [];

  const convIds = rows.map((r) => r.id);
  const contactIds = [...new Set(rows.map((r) => r.contactId))];

  // Fetch contacts
  const contactRows = await db
    .select()
    .from(contacts)
    .where(inArray(contacts.id, contactIds));
  const contactMap = new Map(contactRows.map((c) => [c.id, c]));

  // Fetch last message for each conversation using a subquery approach
  // Get the max seq per conversation, then fetch those messages
  const lastMsgRows = await db.execute(sql`
    SELECT DISTINCT ON (m."conversation_id")
      m."id", m."conversation_id", m."body", m."sender_type", m."seq"
    FROM messages m
    WHERE m."conversation_id" = ANY(${sql.raw(`ARRAY[${convIds.map((id) => `'${id}'`).join(",")}]`)})
    ORDER BY m."conversation_id", m."seq" DESC
  `);
  const lastMsgMap = new Map<string, string>();
  for (const row of lastMsgRows.rows as Array<{
    conversation_id: string;
    body: string;
  }>) {
    lastMsgMap.set(row.conversation_id, row.body);
  }

  // Count unread (contact messages with readAt null) per conversation
  const unreadRows = await db
    .select({
      conversationId: messages.conversationId,
      cnt: count(),
    })
    .from(messages)
    .where(
      and(
        inArray(messages.conversationId, convIds),
        eq(messages.senderType, "contact"),
        isNull(messages.readAt)
      )
    )
    .groupBy(messages.conversationId);
  const unreadMap = new Map(
    unreadRows.map((r) => [r.conversationId, Number(r.cnt)])
  );

  return rows.map((conv) => ({
    ...conv,
    contact: contactMap.get(conv.contactId) ?? null,
    lastMessageBody: lastMsgMap.get(conv.id) ?? null,
    unreadCount: unreadMap.get(conv.id) ?? 0,
  }));
}

// ------------------------------------------------------------------
// Create a conversation (used by widget chat + inbound email)
// ------------------------------------------------------------------
export async function createConversation(
  workspaceId: string,
  input: {
    contactId: string;
    channel: "chat" | "email";
    subject?: string | null;
    status?: "open" | "snoozed" | "resolved";
  }
): Promise<Conversation> {
  const id = newId();
  await db.insert(conversations).values({
    id,
    workspaceId,
    contactId: input.contactId,
    channel: input.channel,
    subject: input.subject ?? null,
    status: input.status ?? "open",
    lastMessageAt: new Date(),
  });
  const rows = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, id));
  return rows[0];
}

// ------------------------------------------------------------------
// List a single contact's conversations (widget history)
// ------------------------------------------------------------------
export async function listConversationsForContact(
  workspaceId: string,
  contactId: string
): Promise<
  Array<Conversation & { lastMessageBody: string | null }>
> {
  const rows = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.workspaceId, workspaceId),
        eq(conversations.contactId, contactId)
      )
    )
    .orderBy(desc(conversations.lastMessageAt));
  if (rows.length === 0) return [];

  const convIds = rows.map((r) => r.id);
  const lastMsgRows = await db
    .select({
      conversationId: messages.conversationId,
      body: messages.body,
      seq: messages.seq,
    })
    .from(messages)
    .where(inArray(messages.conversationId, convIds))
    .orderBy(desc(messages.seq));
  const lastMsgMap = new Map<string, string>();
  for (const m of lastMsgRows) {
    if (!lastMsgMap.has(m.conversationId))
      lastMsgMap.set(m.conversationId, m.body);
  }
  return rows.map((c) => ({
    ...c,
    lastMessageBody: lastMsgMap.get(c.id) ?? null,
  }));
}

// ------------------------------------------------------------------
// Get single conversation (404 if not in workspace)
// ------------------------------------------------------------------
export async function getConversation(
  workspaceId: string,
  id: string
): Promise<Conversation & { contact: Contact | null }> {
  const rows = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, id), eq(conversations.workspaceId, workspaceId)));

  const conv = rows[0];
  if (!conv) notFound("conversation not found");

  const contactRows = await db
    .select()
    .from(contacts)
    .where(eq(contacts.id, conv.contactId));

  return { ...conv, contact: contactRows[0] ?? null };
}

// ------------------------------------------------------------------
// List messages (404 if conversation not in workspace)
// ------------------------------------------------------------------
export async function listMessages(
  workspaceId: string,
  conversationId: string,
  opts: { afterSeq?: number }
): Promise<Message[]> {
  // Verify conversation belongs to workspace
  const convRows = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.workspaceId, workspaceId)
      )
    );
  if (!convRows[0]) notFound("conversation not found");

  const filters = [eq(messages.conversationId, conversationId)];
  if (opts.afterSeq !== undefined)
    filters.push(gt(messages.seq, opts.afterSeq));

  return db
    .select()
    .from(messages)
    .where(and(...filters))
    .orderBy(asc(messages.seq));
}

// ------------------------------------------------------------------
// Create message (bumps lastMessageAt, reopens resolved on contact msg)
// ------------------------------------------------------------------
export async function createMessage(
  workspaceId: string,
  input: {
    conversationId: string;
    senderType: "contact" | "agent" | "system";
    senderId?: string;
    body: string;
    emailMessageId?: string;
    inReplyTo?: string;
    emailReferences?: string;
  }
): Promise<Message> {
  const {
    conversationId,
    senderType,
    senderId,
    body,
    emailMessageId,
    inReplyTo,
    emailReferences,
  } = input;

  // Verify conversation belongs to workspace
  const convRows = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.workspaceId, workspaceId)
      )
    );
  const conv = convRows[0];
  if (!conv) notFound("conversation not found");

  const msgId = newId();
  const now = new Date();

  await db.insert(messages).values({
    id: msgId,
    conversationId,
    workspaceId,
    senderType,
    senderId: senderId ?? null,
    body,
    emailMessageId: emailMessageId ?? null,
    inReplyTo: inReplyTo ?? null,
    emailReferences: emailReferences ?? null,
    createdAt: now,
  });

  // Bump lastMessageAt
  const updates: Partial<typeof conversations.$inferInsert> = {
    lastMessageAt: now,
  };

  // Reopen resolved conversation when a contact sends a message
  if (senderType === "contact" && conv.status === "resolved") {
    updates.status = "open";
    updates.resolvedAt = null;
  }

  await db
    .update(conversations)
    .set(updates)
    .where(eq(conversations.id, conversationId));

  const msgRows = await db
    .select()
    .from(messages)
    .where(eq(messages.id, msgId));
  return msgRows[0];
}

// ------------------------------------------------------------------
// Update conversation (status, assigneeId, snoozedUntil)
// ------------------------------------------------------------------
export async function updateConversation(
  workspaceId: string,
  id: string,
  patch: {
    status?: "open" | "snoozed" | "resolved";
    assigneeId?: string | null;
    snoozedUntil?: Date | null;
  }
): Promise<Conversation> {
  const convRows = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, id), eq(conversations.workspaceId, workspaceId)));

  const current = convRows[0];
  if (!current) notFound("conversation not found");

  // Maintain resolvedAt on status transitions. Extend (not replace) the caller's
  // patch so the public signature is unchanged.
  const writePatch: typeof patch & { resolvedAt?: Date | null } = { ...patch };
  if (patch.status !== undefined) {
    if (patch.status === "resolved") {
      // Only stamp resolvedAt when transitioning INTO resolved (idempotent).
      if (current.status !== "resolved") writePatch.resolvedAt = new Date();
    } else {
      // status → open | snoozed clears the resolution timestamp.
      writePatch.resolvedAt = null;
    }
  }

  // Drizzle throws on an empty .set(); nothing to change → return current row.
  if (Object.keys(writePatch).length > 0) {
    await db
      .update(conversations)
      .set(writePatch)
      .where(eq(conversations.id, id));
  }

  const updated = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, id));
  return updated[0];
}

// ------------------------------------------------------------------
// Mark messages from one side as read (agent reads contact msgs, etc.)
// ------------------------------------------------------------------
export async function markContactMessagesRead(
  workspaceId: string,
  conversationId: string,
  senderType: "contact" | "agent"
): Promise<void> {
  // Verify the conversation belongs to this workspace.
  const convRows = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.workspaceId, workspaceId)
      )
    );
  if (!convRows[0]) notFound("conversation not found");

  await db
    .update(messages)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(messages.conversationId, conversationId),
        eq(messages.workspaceId, workspaceId),
        eq(messages.senderType, senderType),
        isNull(messages.readAt)
      )
    );
}

// ------------------------------------------------------------------
// Find or create contact
// ------------------------------------------------------------------
export async function findOrCreateContact(
  workspaceId: string,
  input: { email?: string; visitorToken?: string; name?: string }
): Promise<Contact> {
  const { email, visitorToken, name } = input;

  // Try to find by visitorToken first (most specific)
  if (visitorToken) {
    const rows = await db
      .select()
      .from(contacts)
      .where(
        and(
          eq(contacts.workspaceId, workspaceId),
          eq(contacts.visitorToken, visitorToken)
        )
      );
    if (rows[0]) return rows[0];
  }

  // Try to find by email
  if (email) {
    const rows = await db
      .select()
      .from(contacts)
      .where(
        and(eq(contacts.workspaceId, workspaceId), eq(contacts.email, email))
      );
    if (rows[0]) return rows[0];
  }

  // Create new contact
  const id = newId();
  await db.insert(contacts).values({
    id,
    workspaceId,
    email: email ?? null,
    name: name ?? null,
    visitorToken: visitorToken ?? null,
    lastSeenAt: new Date(),
  });

  const rows = await db.select().from(contacts).where(eq(contacts.id, id));
  return rows[0];
}
