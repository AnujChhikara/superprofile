import { db } from "../db/client.js";
import { messages, summaries, kbArticles, workspaces } from "../db/schema.js";
import { and, eq, sql } from "drizzle-orm";
import { chat } from "./openai.js";

interface DraftMsg {
  senderType: string;
  body: string;
}

// Pure prompt builder (unit-testable). Grounds the draft in the summary,
// recent messages, and top KB articles; instructs the model not to invent.
export function buildDraftPrompt({
  summary,
  lastMessages,
  kbArticles: kb,
  agentName,
  workspaceName,
}: {
  summary: string | null;
  lastMessages: DraftMsg[];
  kbArticles: Array<{ title: string; body: string }>;
  agentName: string;
  workspaceName: string;
}): { system: string; user: string } {
  const hasKb = kb.length > 0;

  const system = `You are a helpful customer support agent for ${workspaceName}, drafting a reply to a customer message.

RULES:
1. Base your reply on the Knowledge Base articles provided below. Infer the customer's intent charitably — if their question is vague but related to a KB topic, answer from that topic.
2. Only use facts from the Knowledge Base. Do not invent prices, policies, or procedures not mentioned there.
3. If the question is completely unrelated to anything in the Knowledge Base, reply: "Thanks for reaching out! I'll look into this and get back to you shortly."
4. Write in a warm, concise, professional tone — 2 to 4 sentences is usually enough.
5. Sign off as ${agentName}.`;

  const kbBlock = hasKb
    ? "--- KNOWLEDGE BASE ---\n" +
      kb.map((a) => `## ${a.title}\n${a.body.slice(0, 1200)}`).join("\n\n") +
      "\n--- END KNOWLEDGE BASE ---"
    : "--- KNOWLEDGE BASE ---\n(No articles available)\n--- END KNOWLEDGE BASE ---";

  const transcript = lastMessages
    .map((m) => `${m.senderType === "contact" ? "CUSTOMER" : "AGENT"}: ${m.body}`)
    .join("\n");

  const user =
    (summary ? `Conversation summary:\n${summary}\n\n` : "") +
    `${kbBlock}\n\nRecent conversation:\n${transcript}\n\nWrite the agent's next reply:`;

  return { system, user };
}

// Generate a grounded draft reply for a conversation.
export async function generateDraft(
  workspaceId: string,
  conversationId: string,
  agentName: string
): Promise<string> {
  const wsRow = (await db.select({ name: workspaces.name }).from(workspaces).where(eq(workspaces.id, workspaceId)))[0];
  const workspaceName = wsRow?.name ?? "Support";

  const recent = await db
    .select({ senderType: messages.senderType, body: messages.body, seq: messages.seq })
    .from(messages)
    .where(
      and(
        eq(messages.workspaceId, workspaceId),
        eq(messages.conversationId, conversationId)
      )
    )
    .orderBy(messages.seq);
  const lastMessages = recent.slice(-8);
  const lastCustomer = [...recent].reverse().find((m) => m.senderType === "contact");

  let kb: Array<{ title: string; body: string }> = [];
  if (lastCustomer) {
    const hits = await db.execute(sql`
      SELECT title, body_text
      FROM kb_articles
      WHERE workspace_id = ${workspaceId}
        AND status = 'published'
        AND search_vector @@ websearch_to_tsquery('english', ${lastCustomer.body})
      ORDER BY ts_rank(search_vector, websearch_to_tsquery('english', ${lastCustomer.body})) DESC
      LIMIT 3
    `);
    // If FTS finds nothing (short/vague message), fall back to the top published articles
    // so the AI always has KB context rather than returning the generic fallback.
    const rows = hits.rows.length > 0 ? hits.rows : (await db.execute(sql`
      SELECT title, body_text FROM kb_articles
      WHERE workspace_id = ${workspaceId} AND status = 'published'
      ORDER BY updated_at DESC LIMIT 2
    `)).rows;
    kb = (rows as Array<{ title: string; body_text: string }>).map((r) => ({
      title: r.title,
      body: r.body_text,
    }));
  }

  const summaryRow = (
    await db
      .select()
      .from(summaries)
      .where(eq(summaries.conversationId, conversationId))
  )[0];

  const { system, user } = buildDraftPrompt({
    summary: summaryRow?.body ?? null,
    lastMessages,
    kbArticles: kb,
    agentName,
    workspaceName,
  });

  return chat(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    { model: "gpt-4o-mini", temperature: 0.4, maxTokens: 320 }
  );
}
