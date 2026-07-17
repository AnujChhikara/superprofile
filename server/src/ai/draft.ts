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

  const system = `You are a customer support agent for ${workspaceName}, drafting a reply to a customer message.

STRICT RULES — follow these exactly:
1. You may ONLY use information from the Knowledge Base articles and conversation history provided below.
2. Do NOT use your own general knowledge, training data, or outside information under any circumstances.
3. If the customer's question is NOT covered by the Knowledge Base articles below, respond with: "Thanks for reaching out! I'll look into this and get back to you shortly." Do not attempt to answer from general knowledge.
4. Never answer technical questions, explain concepts, give advice, or make promises unless that exact information is in the Knowledge Base below.
5. Do not invent policies, prices, features, or procedures.
6. Write in a warm, concise, professional tone.
7. Sign off as ${agentName}.`;

  const kbBlock = hasKb
    ? "--- KNOWLEDGE BASE (use only this) ---\n" +
      kb.map((a) => `## ${a.title}\n${a.body.slice(0, 800)}`).join("\n\n") +
      "\n--- END KNOWLEDGE BASE ---"
    : "--- KNOWLEDGE BASE ---\n(No relevant articles found for this question)\n--- END KNOWLEDGE BASE ---";

  const transcript = lastMessages
    .map((m) => `${m.senderType === "contact" ? "CUSTOMER" : "AGENT"}: ${m.body}`)
    .join("\n");

  const user =
    (summary ? `Conversation summary:\n${summary}\n\n` : "") +
    `${kbBlock}\n\nRecent conversation:\n${transcript}\n\nDraft the next agent reply. If the KB has no answer, use the fallback message from rule 3:`;

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
