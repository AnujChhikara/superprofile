import sanitizeHtml from "sanitize-html";
import { db } from "../db/client.js";
import { messages } from "../db/schema.js";
import { and, eq, inArray } from "drizzle-orm";

// Ordered thread-candidate message-ids: In-Reply-To first, then References
// newest-first, deduped. Empty when both headers are absent.
export function pickThreadCandidates(input: {
  inReplyTo?: string;
  references?: string;
}): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string) => {
    const t = raw.trim();
    if (t && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  };
  if (input.inReplyTo) push(input.inReplyTo);
  if (input.references) {
    const refs = input.references.split(/\s+/).filter(Boolean);
    for (let i = refs.length - 1; i >= 0; i--) push(refs[i]);
  }
  return out;
}

// "Jane Doe <jane@ex.com>" → {name:"Jane Doe", email:"jane@ex.com"}
// "jane@ex.com"            → {name:null, email:"jane@ex.com"}
export function parseAddress(input: string): {
  name: string | null;
  email: string;
} {
  const m = input.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if (m) {
    const name = m[1] ? m[1].replace(/^"|"$/g, "").trim() : "";
    return { name: name || null, email: m[2].trim() };
  }
  return { name: null, email: input.trim() };
}

// "acme@parse.anujchhikara.com" (parseDomain "parse.anujchhikara.com") → "acme"
// anything not addressed to parseDomain → null
export function workspaceSlugFromRecipient(
  recipient: string,
  parseDomain: string
): string | null {
  const { email } = parseAddress(recipient);
  const at = email.lastIndexOf("@");
  if (at === -1) return null;
  const local = email.slice(0, at).toLowerCase();
  const domain = email.slice(at + 1).toLowerCase();
  if (domain !== parseDomain.toLowerCase()) return null;
  return local || null;
}

// RFC message-id we set on outbound so replies thread back to us.
export function newMessageId(messageRowId: string, parseDomain: string): string {
  return `<msg-${messageRowId}@${parseDomain}>`;
}

// Convert an HTML email body to plain text (drop all tags/attrs).
export function htmlToText(html: string): string {
  return sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} })
    .replace(/\s+\n/g, "\n")
    .trim();
}

// Resolve an inbound reply to an existing conversation by matching any of its
// thread candidates against stored emailMessageIds (workspace-scoped).
export async function resolveThread(
  workspaceId: string,
  headers: { inReplyTo?: string; references?: string }
): Promise<string | null> {
  const candidates = pickThreadCandidates(headers);
  if (candidates.length === 0) return null;
  const rows = await db
    .select({
      conversationId: messages.conversationId,
      emailMessageId: messages.emailMessageId,
    })
    .from(messages)
    .where(
      and(
        eq(messages.workspaceId, workspaceId),
        inArray(messages.emailMessageId, candidates)
      )
    );
  if (rows.length === 0) return null;
  // First candidate (most specific) that has a stored match wins.
  const byId = new Map(
    rows.map((r) => [r.emailMessageId as string, r.conversationId])
  );
  for (const c of candidates) {
    const hit = byId.get(c);
    if (hit) return hit;
  }
  return null;
}
