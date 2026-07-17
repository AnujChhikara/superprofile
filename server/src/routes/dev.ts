import { Router } from "express";
import { db, newId } from "../db/client.js";
import {
  workspaces,
  memberships,
  contacts,
  conversations,
  messages,
  kbCategories,
  kbArticles,
} from "../db/schema.js";
import { eq } from "drizzle-orm";
import { requireAuth } from "../auth/middleware.js";

// Fixed identifiers so the seed is idempotent and /demo can find the workspace.
const DEMO_WS = "demo-acme-ws";
export const DEMO_PUBLIC_KEY = "pk_acmecloud_demo_00000000000000000";

export const devRouter = Router();

// POST /api/dev/seed — creates/refreshes the "Acme Cloud" demo workspace and
// adds the calling user as an admin so they can see it. Idempotent.
devRouter.post("/seed", requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;

    // 1) Workspace (upsert by fixed id).
    const existing = (
      await db.select().from(workspaces).where(eq(workspaces.id, DEMO_WS))
    )[0];
    if (!existing) {
      await db.insert(workspaces).values({
        id: DEMO_WS,
        name: "Acme Cloud",
        slug: "acme",
        publicKey: DEMO_PUBLIC_KEY,
      });
    }

    // 2) Membership for the caller.
    const mem = (
      await db
        .select()
        .from(memberships)
        .where(eq(memberships.workspaceId, DEMO_WS))
    ).find((m) => m.userId === userId);
    if (!mem) {
      await db.insert(memberships).values({
        id: newId(),
        userId,
        workspaceId: DEMO_WS,
        role: "admin",
      });
    }

    // 3) Wipe prior demo content (keep workspace + memberships).
    await db.delete(messages).where(eq(messages.workspaceId, DEMO_WS));
    await db.delete(conversations).where(eq(conversations.workspaceId, DEMO_WS));
    await db.delete(contacts).where(eq(contacts.workspaceId, DEMO_WS));
    await db.delete(kbArticles).where(eq(kbArticles.workspaceId, DEMO_WS));
    await db.delete(kbCategories).where(eq(kbCategories.workspaceId, DEMO_WS));

    // 4) KB: 2 categories + 5 published articles.
    const catGetting = newId();
    const catBilling = newId();
    await db.insert(kbCategories).values([
      { id: catGetting, workspaceId: DEMO_WS, name: "Getting Started", slug: "getting-started", position: 0 },
      { id: catBilling, workspaceId: DEMO_WS, name: "Billing", slug: "billing", position: 1 },
    ]);
    const article = (
      title: string,
      slug: string,
      text: string,
      categoryId: string
    ) => ({
      id: newId(),
      workspaceId: DEMO_WS,
      categoryId,
      title,
      slug,
      bodyHtml: `<p>${text}</p>`,
      bodyText: text,
      status: "published" as const,
    });
    await db.insert(kbArticles).values([
      article("Deploying your first app", "deploying-your-first-app", "Run acme deploy in your project root to ship to the edge in seconds.", catGetting),
      article("Connecting a custom domain", "connecting-a-custom-domain", "Add a CNAME record pointing to your Acme project and verify ownership.", catGetting),
      article("Resetting your password", "resetting-your-password", "Click Forgot password on the login screen and follow the emailed link.", catGetting),
      article("Understanding your invoice", "understanding-your-invoice", "Invoices are issued monthly and itemize bandwidth and build minutes.", catBilling),
      article("Upgrading your plan", "upgrading-your-plan", "Go to Settings then Billing and choose the Pro or Enterprise plan.", catBilling),
    ]);

    // 5) Contacts + conversations (2 chat, 2 email, one long for AI summary).
    const jane = newId();
    const bob = newId();
    await db.insert(contacts).values([
      { id: jane, workspaceId: DEMO_WS, name: "Jane Rivera", email: "jane@example.com", visitorToken: newId(), lastSeenAt: new Date() },
      { id: bob, workspaceId: DEMO_WS, name: "Bob Chen", email: "bob@example.com", lastSeenAt: new Date() },
    ]);

    const mkConv = (
      contactId: string,
      channel: "chat" | "email",
      status: "open" | "snoozed" | "resolved",
      subject: string | null,
      minsAgo: number
    ) => {
      const id = newId();
      return {
        row: {
          id,
          workspaceId: DEMO_WS,
          contactId,
          channel,
          status,
          subject,
          lastMessageAt: new Date(Date.now() - minsAgo * 60_000),
        },
        id,
      };
    };

    const c1 = mkConv(jane, "chat", "open", null, 3);
    const c2 = mkConv(bob, "email", "open", "Trouble with a deploy", 20);
    const c3 = mkConv(jane, "chat", "resolved", null, 180);
    const c4 = mkConv(bob, "email", "snoozed", "Invoice question", 60);
    await db.insert(conversations).values([c1.row, c2.row, c3.row, c4.row]);
    await db
      .update(conversations)
      .set({ snoozedUntil: new Date(Date.now() + 3600_000) })
      .where(eq(conversations.id, c4.id));

    const msg = (
      convId: string,
      sender: "contact" | "agent",
      body: string,
      minsAgo: number
    ) => ({
      id: newId(),
      conversationId: convId,
      workspaceId: DEMO_WS,
      senderType: sender,
      body,
      createdAt: new Date(Date.now() - minsAgo * 60_000),
    });

    await db.insert(messages).values([
      // c1 — long chat for AI summary
      msg(c1.id, "contact", "Hi, my deploy keeps failing with a build error.", 30),
      msg(c1.id, "agent", "Sorry to hear that! What does the error say?", 29),
      msg(c1.id, "contact", "It says 'module not found: acme-config'.", 28),
      msg(c1.id, "agent", "That usually means a missing dependency. Can you run acme install?", 27),
      msg(c1.id, "contact", "Okay, running it now.", 26),
      msg(c1.id, "agent", "Great — let me know if the next deploy succeeds.", 25),
      msg(c1.id, "contact", "Still failing, same error.", 4),
      msg(c1.id, "contact", "Any other ideas?", 3),
      // c2 — email
      msg(c2.id, "contact", "My production deploy has been stuck for 10 minutes.", 20),
      msg(c2.id, "agent", "Thanks Bob, I'm looking into your build logs now.", 18),
      // c3 — resolved chat
      msg(c3.id, "contact", "How do I add a teammate?", 185),
      msg(c3.id, "agent", "Invite them from Settings → Team. Anything else?", 182),
      msg(c3.id, "contact", "That worked, thanks!", 180),
      // c4 — snoozed email
      msg(c4.id, "contact", "Why was I charged twice this month?", 62),
      msg(c4.id, "agent", "Let me check your billing history and get back to you.", 60),
    ]);

    return void res.json({
      ok: true,
      workspaceId: DEMO_WS,
      publicKey: DEMO_PUBLIC_KEY,
      demoUrl: "/demo",
    });
  } catch (err) {
    console.error("[seed]", err);
    return void res.status(500).json({ error: "seed failed" });
  }
});
