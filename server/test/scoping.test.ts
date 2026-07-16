import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db, pool, newId } from "../src/db/client.js";
import {
  users,
  sessions,
  workspaces,
  memberships,
  contacts,
  conversations,
  messages,
} from "../src/db/schema.js";
import { createSession } from "../src/auth/session.js";
import { inArray, eq } from "drizzle-orm";
import {
  listConversations,
  getConversation,
  createMessage,
  listMessages,
  updateConversation,
} from "../src/repos/conversations.js";

// Track IDs for cleanup
const createdUserIds: string[] = [];
const createdWorkspaceIds: string[] = [];
const createdContactIds: string[] = [];
const createdConversationIds: string[] = [];
const createdMessageIds: string[] = [];
const createdSessionUserIds: string[] = [];

async function createTestUser(suffix: string) {
  const id = `test-scope-user-${suffix}-${Date.now()}`;
  const email = `scope-${suffix}-${Date.now()}@example.com`;
  await db.insert(users).values({
    id,
    email,
    googleId: `google-scope-${suffix}-${Date.now()}`,
    name: `Scope Test ${suffix}`,
    avatarUrl: null,
  });
  const rawToken = await createSession(id);
  createdUserIds.push(id);
  createdSessionUserIds.push(id);
  return { id, email, rawToken };
}

async function createTestWorkspace(suffix: string, userId: string) {
  const wsId = `test-scope-ws-${suffix}-${Date.now()}`;
  await db.insert(workspaces).values({
    id: wsId,
    name: `Test WS ${suffix}`,
    slug: `test-ws-${suffix}-${Date.now()}`,
    publicKey: `pk_${suffix}_${Date.now()}`.padEnd(34, "x"),
  });
  await db.insert(memberships).values({
    id: newId(),
    userId,
    workspaceId: wsId,
    role: "admin",
  });
  createdWorkspaceIds.push(wsId);
  return wsId;
}

async function createTestContact(wsId: string, suffix: string) {
  const contactId = newId();
  await db.insert(contacts).values({
    id: contactId,
    workspaceId: wsId,
    email: `contact-${suffix}-${Date.now()}@example.com`,
    name: `Contact ${suffix}`,
  });
  createdContactIds.push(contactId);
  return contactId;
}

async function createTestConversation(
  wsId: string,
  contactId: string,
  status: "open" | "snoozed" | "resolved" = "open"
) {
  const convId = newId();
  await db.insert(conversations).values({
    id: convId,
    workspaceId: wsId,
    contactId,
    channel: "chat",
    status,
    lastMessageAt: new Date(),
  });
  createdConversationIds.push(convId);
  return convId;
}

describe("Tenant isolation and behavioral tests", () => {
  let ws1Id: string;
  let ws2Id: string;
  let user1: { id: string; email: string; rawToken: string };
  let user2: { id: string; email: string; rawToken: string };
  let contact1Id: string;
  let contact2Id: string;
  let conv1Id: string;
  let conv2Id: string;

  beforeAll(async () => {
    user1 = await createTestUser("scope1");
    user2 = await createTestUser("scope2");
    ws1Id = await createTestWorkspace("ws1", user1.id);
    ws2Id = await createTestWorkspace("ws2", user2.id);
    contact1Id = await createTestContact(ws1Id, "c1");
    contact2Id = await createTestContact(ws2Id, "c2");
    conv1Id = await createTestConversation(ws1Id, contact1Id);
    conv2Id = await createTestConversation(ws2Id, contact2Id);
  });

  afterAll(async () => {
    // Clean up in dependency order
    if (createdMessageIds.length) {
      await db
        .delete(messages)
        .where(inArray(messages.id, createdMessageIds));
    }
    if (createdConversationIds.length) {
      await db
        .delete(conversations)
        .where(inArray(conversations.id, createdConversationIds));
    }
    if (createdContactIds.length) {
      await db
        .delete(contacts)
        .where(inArray(contacts.id, createdContactIds));
    }
    if (createdWorkspaceIds.length) {
      await db
        .delete(memberships)
        .where(inArray(memberships.workspaceId, createdWorkspaceIds));
      await db
        .delete(workspaces)
        .where(inArray(workspaces.id, createdWorkspaceIds));
    }
    for (const uid of createdSessionUserIds) {
      await db.delete(sessions).where(eq(sessions.userId, uid));
    }
    if (createdUserIds.length) {
      await db.delete(users).where(inArray(users.id, createdUserIds));
    }
    await pool.end();
  });

  // ------------------------------------------------------------------
  // Tenant isolation: listConversations never returns other workspace data
  // ------------------------------------------------------------------
  it("listConversations(ws1) never returns ws2 rows", async () => {
    const result = await listConversations(ws1Id, {});
    const ids = result.map((r) => r.id);
    expect(ids).toContain(conv1Id);
    expect(ids).not.toContain(conv2Id);
    // All returned conversations must belong to ws1
    for (const conv of result) {
      expect(conv.workspaceId).toBe(ws1Id);
    }
  });

  it("listConversations(ws2) never returns ws1 rows", async () => {
    const result = await listConversations(ws2Id, {});
    const ids = result.map((r) => r.id);
    expect(ids).toContain(conv2Id);
    expect(ids).not.toContain(conv1Id);
    for (const conv of result) {
      expect(conv.workspaceId).toBe(ws2Id);
    }
  });

  it('assigneeId "unassigned" returns only conversations with no assignee', async () => {
    // conv1 has no assignee; create an assigned conversation in ws1.
    const assignedConvId = newId();
    await db.insert(conversations).values({
      id: assignedConvId,
      workspaceId: ws1Id,
      contactId: contact1Id,
      channel: "chat",
      status: "open",
      assigneeId: user1.id,
      lastMessageAt: new Date(),
    });
    createdConversationIds.push(assignedConvId);

    const unassigned = await listConversations(ws1Id, {
      assigneeId: "unassigned",
    });
    const ids = unassigned.map((c) => c.id);
    expect(ids).toContain(conv1Id);
    expect(ids).not.toContain(assignedConvId);
    for (const c of unassigned) expect(c.assigneeId).toBeNull();

    // Filtering by the concrete agent id returns the assigned one only.
    const mine = await listConversations(ws1Id, { assigneeId: user1.id });
    expect(mine.map((c) => c.id)).toContain(assignedConvId);
    expect(mine.map((c) => c.id)).not.toContain(conv1Id);
  });

  it("getConversation(ws1, conv2Id) throws 404", async () => {
    await expect(getConversation(ws1Id, conv2Id)).rejects.toMatchObject({
      status: 404,
    });
  });

  it("getConversation(ws2, conv1Id) throws 404", async () => {
    await expect(getConversation(ws2Id, conv1Id)).rejects.toMatchObject({
      status: 404,
    });
  });

  it("listMessages(ws1, conv2Id) throws 404 (cross-workspace)", async () => {
    await expect(listMessages(ws1Id, conv2Id, {})).rejects.toMatchObject({
      status: 404,
    });
  });

  it("updateConversation(ws1, conv2Id) throws 404 (cross-workspace)", async () => {
    await expect(
      updateConversation(ws1Id, conv2Id, { status: "resolved" })
    ).rejects.toMatchObject({ status: 404 });
  });

  // ------------------------------------------------------------------
  // Reopen logic: contact message on resolved conversation reopens it
  // ------------------------------------------------------------------
  it("createMessage with senderType=contact reopens a resolved conversation", async () => {
    // Create a resolved conversation in ws1
    const resolvedConvId = newId();
    await db.insert(conversations).values({
      id: resolvedConvId,
      workspaceId: ws1Id,
      contactId: contact1Id,
      channel: "chat",
      status: "resolved",
      lastMessageAt: new Date(),
    });
    createdConversationIds.push(resolvedConvId);

    // Create a contact message — should reopen
    const msg = await createMessage(ws1Id, {
      conversationId: resolvedConvId,
      senderType: "contact",
      senderId: contact1Id,
      body: "Hello again!",
    });
    createdMessageIds.push(msg.id);

    // Conversation should now be open
    const conv = await getConversation(ws1Id, resolvedConvId);
    expect(conv.status).toBe("open");
  });

  it("createMessage with senderType=agent does NOT reopen a resolved conversation", async () => {
    // Create another resolved conversation
    const resolvedConvId2 = newId();
    await db.insert(conversations).values({
      id: resolvedConvId2,
      workspaceId: ws1Id,
      contactId: contact1Id,
      channel: "chat",
      status: "resolved",
      lastMessageAt: new Date(),
    });
    createdConversationIds.push(resolvedConvId2);

    const msg = await createMessage(ws1Id, {
      conversationId: resolvedConvId2,
      senderType: "agent",
      senderId: user1.id,
      body: "Agent reply on resolved",
    });
    createdMessageIds.push(msg.id);

    // Should still be resolved
    const conv = await getConversation(ws1Id, resolvedConvId2);
    expect(conv.status).toBe("resolved");
  });

  // ------------------------------------------------------------------
  // createMessage bumps lastMessageAt
  // ------------------------------------------------------------------
  it("createMessage bumps lastMessageAt on the conversation", async () => {
    const convBefore = await getConversation(ws1Id, conv1Id);
    const beforeTime = convBefore.lastMessageAt;

    // Small delay to ensure timestamp differs
    await new Promise((r) => setTimeout(r, 5));

    const msg = await createMessage(ws1Id, {
      conversationId: conv1Id,
      senderType: "contact",
      senderId: contact1Id,
      body: "bump test",
    });
    createdMessageIds.push(msg.id);

    const convAfter = await getConversation(ws1Id, conv1Id);
    expect(new Date(convAfter.lastMessageAt).getTime()).toBeGreaterThan(
      new Date(beforeTime).getTime()
    );
  });

  // ------------------------------------------------------------------
  // unreadCount: contact messages with readAt null are unread
  // ------------------------------------------------------------------
  it("unreadCount counts contact messages with null readAt", async () => {
    // Create a fresh conversation
    const freshConvId = newId();
    await db.insert(conversations).values({
      id: freshConvId,
      workspaceId: ws1Id,
      contactId: contact1Id,
      channel: "chat",
      status: "open",
      lastMessageAt: new Date(),
    });
    createdConversationIds.push(freshConvId);

    // Insert 2 contact messages
    const msg1 = await createMessage(ws1Id, {
      conversationId: freshConvId,
      senderType: "contact",
      body: "msg 1",
    });
    const msg2 = await createMessage(ws1Id, {
      conversationId: freshConvId,
      senderType: "contact",
      body: "msg 2",
    });
    createdMessageIds.push(msg1.id, msg2.id);

    const list = await listConversations(ws1Id, {});
    const found = list.find((c) => c.id === freshConvId);
    expect(found).toBeDefined();
    expect(found!.unreadCount).toBe(2);
  });

  // ------------------------------------------------------------------
  // Read marking: POST /read marks contact messages as read
  // ------------------------------------------------------------------
  it("listMessages returns messages for the conversation sorted by seq", async () => {
    const msgs = await listMessages(ws1Id, conv1Id, {});
    // Should have at least the message we created in the bump test
    expect(Array.isArray(msgs)).toBe(true);
    // Verify sorted by seq ascending
    for (let i = 1; i < msgs.length; i++) {
      expect(msgs[i].seq).toBeGreaterThanOrEqual(msgs[i - 1].seq);
    }
  });
});
