import { env } from "../env.js";
import { db } from "../db/client.js";
import { workspaces } from "../db/schema.js";
import { eq } from "drizzle-orm";
import {
  findOrCreateContact,
  createConversation,
  createMessage,
  getConversation,
} from "../repos/conversations.js";
import { emitMessageCreated, emitConversationUpdated } from "../events.js";
import {
  parseAddress,
  workspaceSlugFromRecipient,
  resolveThread,
  htmlToText,
} from "./threading.js";

export interface SendGridInbound {
  to: string;
  from: string;
  subject?: string;
  text?: string;
  html?: string;
  headers?: string;
}

// Pull a single header value (handling simple RFC 5322 line folding).
function headerValue(raw: string | undefined, name: string): string | undefined {
  if (!raw) return undefined;
  const re = new RegExp(`^${name}:\\s*(.*(?:\\r?\\n[ \\t].*)*)`, "im");
  const m = raw.match(re);
  return m ? m[1].replace(/\r?\n[ \t]+/g, " ").trim() : undefined;
}

// Process one inbound email. Always resolves (webhook returns 200) — unknown
// recipients are logged and ignored so SendGrid stops retrying.
export async function handleInbound(fields: SendGridInbound): Promise<void> {
  const slug = workspaceSlugFromRecipient(fields.to, env.PARSE_DOMAIN);
  if (!slug) {
    console.warn("[inbound] recipient not for us:", fields.to);
    return;
  }
  const ws = (
    await db.select().from(workspaces).where(eq(workspaces.slug, slug))
  )[0];
  if (!ws) {
    console.warn("[inbound] unknown workspace slug:", slug);
    return;
  }

  const from = parseAddress(fields.from);
  const contact = await findOrCreateContact(ws.id, {
    email: from.email,
    name: from.name ?? undefined,
  });

  const messageId = headerValue(fields.headers, "Message-ID");
  const inReplyTo = headerValue(fields.headers, "In-Reply-To");
  const references = headerValue(fields.headers, "References");

  let conversationId = await resolveThread(ws.id, { inReplyTo, references });
  if (!conversationId) {
    const conv = await createConversation(ws.id, {
      contactId: contact.id,
      channel: "email",
      subject: fields.subject ?? "(no subject)",
    });
    conversationId = conv.id;
  }

  const body =
    (fields.text && fields.text.trim()) ||
    (fields.html ? htmlToText(fields.html) : "") ||
    "(empty message)";

  // createMessage reopens a resolved conversation on a contact message.
  const message = await createMessage(ws.id, {
    conversationId,
    senderType: "contact",
    senderId: contact.id,
    body,
    emailMessageId: messageId,
    inReplyTo,
    emailReferences: references,
  });

  const conv = await getConversation(ws.id, conversationId);
  emitMessageCreated({ workspaceId: ws.id, conversation: conv, message });
  emitConversationUpdated({ workspaceId: ws.id, conversation: conv });
}
