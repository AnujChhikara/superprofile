import { db } from "../db/client.js";
import { messages, summaries, kbArticles } from "../db/schema.js";
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
}: {
  summary: string | null;
  lastMessages: DraftMsg[];
  kbArticles: Array<{ title: string; body: string }>;
  agentName: string;
}): { system: string; user: string } {
  const system = `You are a customer support agent drafting a reply.
Write in a warm, concise, professional tone.
Only state facts present in the provided context (summary, messages, knowledge base). If you don't know, say you'll check.
Do not invent policies, prices, or promises.
Sign off as ${agentName}.`;

  const kbBlock = kb.length
    ? "Knowledge base:\n" +
      kb.map((a) => `# ${a.title}\n${a.body.slice(0, 800)}`).join("\n\n")
    : "Knowledge base: (no relevant articles)";
  const transcript = lastMessages
    .map(
      (m) => `${m.senderType === "contact" ? "CUSTOMER" : "AGENT"}: ${m.body}`
    )
    .join("\n");
  const user =
    (summary ? `Conversation summary:\n${summary}\n\n` : "") +
    `${kbBlock}\n\nRecent messages:\n${transcript}\n\nDraft the next agent reply:`;
  return { system, user };
}

// Generate a grounded draft reply for a conversation.
export async function generateDraft(
  workspaceId: string,
  conversationId: string,
  agentName: string
): Promise<string> {
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
    kb = (hits.rows as Array<{ title: string; body_text: string }>).map((r) => ({
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
  });

  return chat(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    { model: "gpt-4o-mini", temperature: 0.4, maxTokens: 320 }
  );
}
