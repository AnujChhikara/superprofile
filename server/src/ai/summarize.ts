import { db } from "../db/client.js";
import { messages, summaries } from "../db/schema.js";
import { and, eq, count } from "drizzle-orm";
import { chat } from "./openai.js";
import { emitToConversation, emitToWorkspace } from "../realtime/socket.js";

interface Msg {
  senderType: string;
  body: string;
  createdAt: Date;
}

// Pure prompt builder (unit-tested). Caps included messages at 30 and folds in
// the previous summary for rolling updates.
export function buildSummaryPrompt({
  previousSummary,
  newMessages,
}: {
  previousSummary: string | null;
  newMessages: Msg[];
}): { system: string; user: string } {
  const recent = newMessages.slice(-30);
  const system = `You summarize customer support conversations for an agent who has not read them.
Output EXACTLY three sections with these labels, <=120 words total, plain text:
What the customer wants: ...
What's been tried: ...
Current status: ...
Never invent details. If unknown, write "unclear".`;
  const transcript = recent
    .map(
      (m) =>
        `${m.senderType === "contact" ? "CUSTOMER" : "AGENT"}: ${m.body.slice(0, 500)}`
    )
    .join("\n");
  const user =
    (previousSummary
      ? `Previous summary (update it with the new messages):\n${previousSummary}\n\nNew messages:\n`
      : `Conversation:\n`) + transcript;
  return { system, user };
}

// In-memory throttle: at most one summarize per conversation per 60s.
const lastRun = new Map<string, number>();

// Fire-and-forget summarizer. No-op unless there are ≥6 messages, there's new
// content since the last summary, and we haven't run in the last 60s.
export async function maybeSummarize(
  workspaceId: string,
  conversationId: string,
  opts: { force?: boolean } = {}
): Promise<void> {
  const total = (
    await db
      .select({ c: count() })
      .from(messages)
      .where(
        and(
          eq(messages.workspaceId, workspaceId),
          eq(messages.conversationId, conversationId)
        )
      )
  )[0];
  const messageCount = Number(total?.c ?? 0);
  if (messageCount < 6) return;

  const existing = (
    await db
      .select()
      .from(summaries)
      .where(eq(summaries.conversationId, conversationId))
  )[0];
  if (!opts.force && existing && messageCount <= existing.messageCount) return;

  const now = Date.now();
  const last = lastRun.get(conversationId) ?? 0;
  if (!opts.force && now - last < 60_000) return;
  lastRun.set(conversationId, now);

  const rows = await db
    .select({
      senderType: messages.senderType,
      body: messages.body,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(messages.seq);

  const { system, user } = buildSummaryPrompt({
    previousSummary: existing?.body ?? null,
    newMessages: rows as Msg[],
  });

  const body = await chat(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    { model: "gpt-4o-mini", temperature: 0.2, maxTokens: 220 }
  );

  const updatedAt = new Date();
  if (existing) {
    await db
      .update(summaries)
      .set({ body, messageCount, updatedAt })
      .where(eq(summaries.conversationId, conversationId));
  } else {
    await db.insert(summaries).values({
      conversationId,
      workspaceId,
      body,
      messageCount,
      updatedAt,
    });
  }

  const payload = {
    conversationId,
    body,
    updatedAt: updatedAt.toISOString(),
  };
  emitToConversation(conversationId, "summary:updated", payload);
  emitToWorkspace(workspaceId, "summary:updated", payload);
}
