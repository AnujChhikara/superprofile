import { Router } from "express";
import { db } from "../db/client.js";
import { summaries, messages } from "../db/schema.js";
import { and, eq, count } from "drizzle-orm";
import { requireAuth, requireWorkspace } from "../auth/middleware.js";
import { getConversation } from "../repos/conversations.js";
import { maybeSummarize } from "../ai/summarize.js";

export const summariesRouter = Router();
summariesRouter.use(requireAuth, requireWorkspace());

// GET /api/conversations/:id/summary → cached summary + whether it's stale.
summariesRouter.get("/:id/summary", async (req, res) => {
  const wsId = req.workspaceId!;
  const id = String(req.params.id);
  try {
    await getConversation(wsId, id); // workspace scope check (404 otherwise)
  } catch {
    return void res.status(404).json({ error: "conversation not found" });
  }
  const row = (
    await db.select().from(summaries).where(eq(summaries.conversationId, id))
  )[0];
  const total = (
    await db
      .select({ c: count() })
      .from(messages)
      .where(and(eq(messages.workspaceId, wsId), eq(messages.conversationId, id)))
  )[0];
  const messageCount = Number(total?.c ?? 0);
  if (!row) return void res.json({ summary: null, messageCount });
  return void res.json({
    summary: {
      body: row.body,
      messageCount: row.messageCount,
      updatedAt: row.updatedAt,
    },
    messageCount,
    stale: row.messageCount < messageCount,
  });
});

// POST /api/conversations/:id/summary/regenerate → force a refresh.
summariesRouter.post("/:id/summary/regenerate", async (req, res) => {
  const wsId = req.workspaceId!;
  const id = String(req.params.id);
  try {
    await getConversation(wsId, id);
  } catch {
    return void res.status(404).json({ error: "conversation not found" });
  }
  try {
    await maybeSummarize(wsId, id, { force: true });
    const row = (
      await db.select().from(summaries).where(eq(summaries.conversationId, id))
    )[0];
    return void res.json({ summary: row ?? null });
  } catch (err) {
    console.error("[summary] regenerate failed:", err);
    return void res.status(503).json({ error: "summary unavailable" });
  }
});
