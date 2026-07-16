import { env } from "../env.js";
import { db } from "../db/client.js";
import { workspaces, messages, contacts, conversations } from "../db/schema.js";
import { and, eq, desc, isNotNull } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import { sendEmail } from "../lib/sendEmail.js";
import { newMessageId } from "./threading.js";
import { createMessage, getConversation } from "../repos/conversations.js";
import { emitMessageCreated, emitConversationUpdated } from "../events.js";

type Conversation = InferSelectModel<typeof conversations>;
type Message = InferSelectModel<typeof messages>;

// Deliver an already-persisted agent message as a threaded email reply.
// Updates the message row with the RFC Message-ID we set. On delivery failure,
// appends a system "delivery failed" message and rethrows (caller logs).
export async function sendReply(params: {
  workspaceId: string;
  conversation: Conversation;
  message: Message;
}): Promise<{ emailMessageId: string }> {
  const { workspaceId, conversation, message } = params;

  const ws = (
    await db.select().from(workspaces).where(eq(workspaces.id, workspaceId))
  )[0];
  if (!ws) throw new Error("workspace not found");

  const contact = (
    await db.select().from(contacts).where(eq(contacts.id, conversation.contactId))
  )[0];
  if (!contact?.email) throw new Error("contact has no email");

  // Most recent inbound message with a stored Message-ID → threading anchor.
  const lastInbound = (
    await db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, conversation.id),
          eq(messages.senderType, "contact"),
          isNotNull(messages.emailMessageId)
        )
      )
      .orderBy(desc(messages.seq))
      .limit(1)
  )[0];

  const mid = newMessageId(message.id, env.PARSE_DOMAIN);
  const headers: Record<string, string> = { "Message-ID": mid };
  if (lastInbound?.emailMessageId) {
    headers["In-Reply-To"] = lastInbound.emailMessageId;
    const chain = [lastInbound.emailReferences, lastInbound.emailMessageId]
      .filter(Boolean)
      .join(" ");
    headers["References"] = chain;
  }

  const subject = conversation.subject
    ? conversation.subject.startsWith("Re:")
      ? conversation.subject
      : `Re: ${conversation.subject}`
    : "Re: your conversation";

  try {
    await sendEmail({
      to: contact.email,
      subject,
      text: message.body,
      from: `${ws.slug}@${env.PARSE_DOMAIN}`,
      fromName: `${ws.name} Support`,
      headers,
    });
  } catch (err) {
    console.error("[outbound] delivery failed:", err);
    const sys = await createMessage(workspaceId, {
      conversationId: conversation.id,
      senderType: "system",
      body: "⚠ Email delivery failed — the reply was not sent.",
    });
    const conv = await getConversation(workspaceId, conversation.id);
    emitMessageCreated({ workspaceId, conversation: conv, message: sys });
    emitConversationUpdated({ workspaceId, conversation: conv });
    throw err;
  }

  await db
    .update(messages)
    .set({ emailMessageId: mid })
    .where(eq(messages.id, message.id));

  return { emailMessageId: mid };
}
