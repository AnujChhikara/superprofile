import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireWorkspace } from "../auth/middleware.js";
import {
  listConversations,
  getConversation,
  listMessages,
  createMessage,
  updateConversation,
  markContactMessagesRead,
} from "../repos/conversations.js";
import {
  emitMessageCreated,
  emitConversationUpdated,
} from "../events.js";
import { sendReply } from "../email/outbound.js";
import { maybeSummarize } from "../ai/summarize.js";

export const conversationsRouter = Router();

// GET /api/conversations
conversationsRouter.get(
  "/",
  requireAuth,
  requireWorkspace(),
  async (req, res) => {
    const wsId = req.workspaceId!;
    const { channel, status, assignee } = req.query as Record<string, string>;

    const channelEnum = ["chat", "email"].includes(channel)
      ? (channel as "chat" | "email")
      : undefined;
    const statusEnum = ["open", "snoozed", "resolved"].includes(status)
      ? (status as "open" | "snoozed" | "resolved")
      : undefined;

    const convs = await listConversations(wsId, {
      channel: channelEnum,
      status: statusEnum,
      // "" (no assignee filter) collapses to undefined; "unassigned" and
      // concrete ids pass through to the repo.
      assigneeId: assignee || undefined,
    });
    return void res.json(convs);
  }
);

// GET /api/conversations/:id
conversationsRouter.get(
  "/:id",
  requireAuth,
  requireWorkspace(),
  async (req, res) => {
    const wsId = req.workspaceId!;
    const id = String(req.params.id);
    try {
      const conv = await getConversation(wsId, id);
      // Fire-and-forget rolling summary refresh (no-op unless due).
      void maybeSummarize(wsId, id).catch((err) =>
        console.error("[summary] maybeSummarize failed:", err)
      );
      return void res.json(conv);
    } catch (err: unknown) {
      if ((err as { status?: number }).status === 404) {
        return void res.status(404).json({ error: "conversation not found" });
      }
      throw err;
    }
  }
);

// GET /api/conversations/:id/messages
conversationsRouter.get(
  "/:id/messages",
  requireAuth,
  requireWorkspace(),
  async (req, res) => {
    const wsId = req.workspaceId!;
    const id = String(req.params.id);
    const afterSeq = req.query.after ? Number(req.query.after) : undefined;

    try {
      const msgs = await listMessages(wsId, id, { afterSeq });
      return void res.json(msgs);
    } catch (err: unknown) {
      if ((err as { status?: number }).status === 404) {
        return void res.status(404).json({ error: "conversation not found" });
      }
      throw err;
    }
  }
);

const replyBody = z.object({
  body: z.string().min(1),
});

// POST /api/conversations/:id/messages (agent reply)
conversationsRouter.post(
  "/:id/messages",
  requireAuth,
  requireWorkspace(),
  async (req, res) => {
    const wsId = req.workspaceId!;
    const id = String(req.params.id);
    const parsed = replyBody.safeParse(req.body);
    if (!parsed.success) {
      return void res
        .status(400)
        .json({ error: "invalid body", details: parsed.error.flatten() });
    }

    try {
      const msg = await createMessage(wsId, {
        conversationId: id,
        senderType: "agent",
        senderId: req.user!.id,
        body: parsed.data.body,
      });

      const conv = await getConversation(wsId, id);
      emitMessageCreated({ workspaceId: wsId, conversation: conv, message: msg });
      emitConversationUpdated({ workspaceId: wsId, conversation: conv });

      // For email conversations, deliver the reply as a threaded email.
      // Fire-and-forget: the message is already saved + shown in the inbox;
      // a delivery failure surfaces as a system message via sendReply.
      if (conv.channel === "email") {
        void sendReply({ workspaceId: wsId, conversation: conv, message: msg }).catch(
          (err) => console.error("[conversations] email reply failed:", err)
        );
      }

      return void res.status(201).json(msg);
    } catch (err: unknown) {
      if ((err as { status?: number }).status === 404) {
        return void res.status(404).json({ error: "conversation not found" });
      }
      throw err;
    }
  }
);

const patchBody = z.object({
  status: z.enum(["open", "snoozed", "resolved"]).optional(),
  assigneeId: z.string().nullable().optional(),
  snoozedUntil: z
    .string()
    .datetime()
    .optional()
    .refine(
      (v) => {
        if (!v) return true;
        return new Date(v) > new Date();
      },
      { message: "snoozedUntil must be a future date" }
    )
    .transform((v) => (v ? new Date(v) : undefined)),
});

// PATCH /api/conversations/:id
conversationsRouter.patch(
  "/:id",
  requireAuth,
  requireWorkspace(),
  async (req, res) => {
    const wsId = req.workspaceId!;
    const id = String(req.params.id);
    const parsed = patchBody.safeParse(req.body);
    if (!parsed.success) {
      return void res
        .status(400)
        .json({ error: "invalid body", details: parsed.error.flatten() });
    }

    // Build the patch from only the fields that were actually provided, so
    // e.g. reassigning a snoozed conversation doesn't wipe its snoozedUntil.
    const patch: {
      status?: "open" | "snoozed" | "resolved";
      assigneeId?: string | null;
      snoozedUntil?: Date | null;
    } = {};
    if (parsed.data.status !== undefined) {
      patch.status = parsed.data.status;
      // Leaving the snoozed state clears the wake-up time.
      if (parsed.data.status !== "snoozed") patch.snoozedUntil = null;
    }
    if (parsed.data.assigneeId !== undefined)
      patch.assigneeId = parsed.data.assigneeId;
    if (parsed.data.snoozedUntil !== undefined)
      patch.snoozedUntil = parsed.data.snoozedUntil;

    try {
      const conv = await updateConversation(wsId, id, patch);
      emitConversationUpdated({ workspaceId: wsId, conversation: conv });
      return void res.json(conv);
    } catch (err: unknown) {
      if ((err as { status?: number }).status === 404) {
        return void res.status(404).json({ error: "conversation not found" });
      }
      throw err;
    }
  }
);

// POST /api/conversations/:id/read
conversationsRouter.post(
  "/:id/read",
  requireAuth,
  requireWorkspace(),
  async (req, res) => {
    const wsId = req.workspaceId!;
    const id = String(req.params.id);

    try {
      // Mark all unread contact messages as read (verifies workspace scope).
      await markContactMessagesRead(wsId, id, "contact");
      return void res.json({ ok: true });
    } catch (err: unknown) {
      if ((err as { status?: number }).status === 404) {
        return void res.status(404).json({ error: "conversation not found" });
      }
      throw err;
    }
  }
);
