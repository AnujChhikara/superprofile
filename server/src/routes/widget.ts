import { Router } from "express";
import { z } from "zod";
import crypto from "crypto";
import { db } from "../db/client.js";
import { workspaces, contacts } from "../db/schema.js";
import { and, eq } from "drizzle-orm";
import {
  findOrCreateContact,
  createConversation,
  createMessage,
  getConversation,
  listMessages,
  listConversationsForContact,
} from "../repos/conversations.js";
import { emitMessageCreated, emitConversationUpdated } from "../events.js";
import { isAgentOnline } from "../realtime/socket.js";

export const widgetRouter = Router();

// The visitorToken is a bearer-like credential; keep it out of the Referer
// header when the frame links out (e.g. KB article links open in a new tab).
widgetRouter.use((_req, res, next) => {
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
});

// ---- rate limit: 60 req/min per IP + workspaceKey ----
const hits = new Map<string, number[]>();
widgetRouter.use((req, res, next) => {
  const key =
    (req.ip ?? "?") +
    "|" +
    ((req.body?.workspaceKey as string) ??
      (req.query.workspaceKey as string) ??
      "?");
  const now = Date.now();
  const win = 60_000;
  const arr = (hits.get(key) ?? []).filter((t) => now - t < win);
  arr.push(now);
  hits.set(key, arr);
  // Evict stale keys.
  for (const [k, ts] of hits) {
    if (now - (ts[ts.length - 1] ?? 0) >= win) hits.delete(k);
  }
  if (arr.length > 60)
    return void res.status(429).json({ error: "rate limit exceeded" });
  next();
});

async function workspaceByKey(publicKey: string) {
  return (
    await db.select().from(workspaces).where(eq(workspaces.publicKey, publicKey))
  )[0];
}

// POST /api/widget/init
const initBody = z.object({
  workspaceKey: z.string(),
  visitorToken: z.string().optional(),
});
widgetRouter.post("/init", async (req, res) => {
  const parsed = initBody.safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: "invalid body" });
  const ws = await workspaceByKey(parsed.data.workspaceKey);
  if (!ws) return void res.status(404).json({ error: "unknown workspace" });

  const visitorToken =
    parsed.data.visitorToken || crypto.randomUUID();
  const contact = await findOrCreateContact(ws.id, { visitorToken });

  const convs = await listConversationsForContact(ws.id, contact.id);
  return void res.json({
    visitorToken,
    workspaceName: ws.name,
    agentOnline: isAgentOnline(ws.id),
    conversations: convs.map((c) => ({
      id: c.id,
      subject: c.subject,
      status: c.status,
      lastMessageAt: c.lastMessageAt,
      lastPreview: c.lastMessageBody,
    })),
  });
});

// Resolve workspace + contact for authenticated-by-token widget calls.
async function resolveVisitor(
  workspaceKey: string,
  visitorToken: string
): Promise<{ wsId: string; contactId: string } | null> {
  const ws = await workspaceByKey(workspaceKey);
  if (!ws) return null;
  const contact = (
    await db
      .select()
      .from(contacts)
      .where(
        and(
          eq(contacts.workspaceId, ws.id),
          eq(contacts.visitorToken, visitorToken)
        )
      )
  )[0];
  if (!contact) return null;
  return { wsId: ws.id, contactId: contact.id };
}

// POST /api/widget/conversations — start a new chat conversation
const startBody = z.object({
  workspaceKey: z.string(),
  visitorToken: z.string(),
  body: z.string().min(1),
});
widgetRouter.post("/conversations", async (req, res) => {
  const parsed = startBody.safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: "invalid body" });
  const who = await resolveVisitor(
    parsed.data.workspaceKey,
    parsed.data.visitorToken
  );
  if (!who) return void res.status(404).json({ error: "unknown visitor" });

  const conversation = await createConversation(who.wsId, {
    contactId: who.contactId,
    channel: "chat",
  });
  const message = await createMessage(who.wsId, {
    conversationId: conversation.id,
    senderType: "contact",
    senderId: who.contactId,
    body: parsed.data.body,
  });
  const conv = await getConversation(who.wsId, conversation.id);
  emitMessageCreated({ workspaceId: who.wsId, conversation: conv, message });
  emitConversationUpdated({ workspaceId: who.wsId, conversation: conv });
  return void res.status(201).json({ conversation: conv, message });
});

// POST /api/widget/conversations/:id/messages — reply in a conversation
const msgBody = z.object({
  workspaceKey: z.string(),
  visitorToken: z.string(),
  body: z.string().min(1),
});
widgetRouter.post("/conversations/:id/messages", async (req, res) => {
  const parsed = msgBody.safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: "invalid body" });
  const who = await resolveVisitor(
    parsed.data.workspaceKey,
    parsed.data.visitorToken
  );
  if (!who) return void res.status(404).json({ error: "unknown visitor" });

  const id = String(req.params.id);
  let conv;
  try {
    conv = await getConversation(who.wsId, id);
  } catch {
    return void res.status(404).json({ error: "conversation not found" });
  }
  // Tenant isolation for visitors: the conversation must be theirs.
  if (conv.contactId !== who.contactId)
    return void res.status(404).json({ error: "conversation not found" });

  const message = await createMessage(who.wsId, {
    conversationId: id,
    senderType: "contact",
    senderId: who.contactId,
    body: parsed.data.body,
  });
  const updated = await getConversation(who.wsId, id);
  emitMessageCreated({
    workspaceId: who.wsId,
    conversation: updated,
    message,
  });
  emitConversationUpdated({ workspaceId: who.wsId, conversation: updated });
  return void res.status(201).json(message);
});

// GET /api/widget/conversations/:id/messages?after=
// Credentials come from headers (not the query string) so the visitorToken —
// a bearer-like credential — never lands in access logs. workspaceKey is public.
widgetRouter.get("/conversations/:id/messages", async (req, res) => {
  const workspaceKey = String(
    req.header("X-Workspace-Key") ?? req.query.workspaceKey ?? ""
  );
  const visitorToken = String(req.header("X-Visitor-Token") ?? "");
  const who = await resolveVisitor(workspaceKey, visitorToken);
  if (!who) return void res.status(404).json({ error: "unknown visitor" });

  const id = String(req.params.id);
  let conv;
  try {
    conv = await getConversation(who.wsId, id);
  } catch {
    return void res.status(404).json({ error: "conversation not found" });
  }
  if (conv.contactId !== who.contactId)
    return void res.status(404).json({ error: "conversation not found" });

  const afterSeq = req.query.after ? Number(req.query.after) : undefined;
  const msgs = await listMessages(who.wsId, id, { afterSeq });
  return void res.json(msgs);
});

// POST /api/widget/identify — attach email/name, merge with existing contact
const identifyBody = z.object({
  workspaceKey: z.string(),
  visitorToken: z.string(),
  email: z.string().email(),
  name: z.string().optional(),
});
widgetRouter.post("/identify", async (req, res) => {
  const parsed = identifyBody.safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: "invalid body" });
  const who = await resolveVisitor(
    parsed.data.workspaceKey,
    parsed.data.visitorToken
  );
  if (!who) return void res.status(404).json({ error: "unknown visitor" });

  // Only ever label the visitor's OWN contact. We deliberately do NOT merge
  // into a pre-existing contact that already owns this email: the email is
  // unverified (anyone can type any address), so adopting another contact's
  // identity here would let an anonymous visitor read that contact's history.
  // Contact email is a non-unique index, so a duplicate is acceptable; real
  // identity linking would require verification (e.g. emailed code / HMAC).
  await db
    .update(contacts)
    .set({ email: parsed.data.email, name: parsed.data.name ?? undefined })
    .where(eq(contacts.id, who.contactId));
  return void res.json({ ok: true, contactId: who.contactId });
});
