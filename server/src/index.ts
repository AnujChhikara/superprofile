import express from "express";
import http from "http";
import cors from "cors";
import cookieParser from "cookie-parser";
import { env } from "./env.js";
import { checkOrigin } from "./auth/middleware.js";
import { authRouter, meRouter } from "./routes/auth.js";
import { workspacesRouter } from "./routes/workspaces.js";
import { teamRouter, invitesRouter } from "./routes/team.js";
import { conversationsRouter } from "./routes/conversations.js";
import { db, newId } from "./db/client.js";
import { contacts, conversations, messages } from "./db/schema.js";
import { eq, lt, and } from "drizzle-orm";
import {
  onMessageCreated,
  onConversationUpdated,
  emitConversationUpdated,
} from "./events.js";
import {
  initSocket,
  emitToWorkspace,
  emitToConversation,
} from "./realtime/socket.js";

export const app = express();
export const httpServer = http.createServer(app);
app.set("trust proxy", 1);
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "5mb" })); // sendgrid inbound is form-encoded
app.use(cookieParser());
// Allow both the configured APP_ORIGIN and the local dev origin (5173).
// For disallowed origins we pass null (CORS header omitted) but do NOT throw —
// the checkOrigin CSRF middleware below will reject mutating requests with 403.
const allowedOrigins = new Set([env.APP_ORIGIN, "http://localhost:5173"]);
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin || allowedOrigins.has(origin)) return cb(null, true);
      // Return false so the Access-Control-Allow-Origin header is omitted for
      // unknown origins (browsers block the response), but we don't crash.
      cb(null, false);
    },
    credentials: true,
  })
);

// In-memory rate limiter: 30 req/min/IP on /api/auth/*
const authRateMap = new Map<string, number[]>();
app.use("/api/auth", (req, res, next) => {
  const ip = (req.ip ?? req.socket.remoteAddress ?? "unknown");
  const now = Date.now();
  const window = 60_000; // 1 minute
  const limit = 30;
  const timestamps = (authRateMap.get(ip) ?? []).filter(
    (t) => now - t < window
  );
  timestamps.push(now);
  authRateMap.set(ip, timestamps);
  // Evict stale IP entries so the map doesn't grow unbounded.
  for (const [k, ts] of authRateMap) {
    if (now - (ts[ts.length - 1] ?? 0) >= window) authRateMap.delete(k);
  }
  if (timestamps.length > limit) {
    return void res.status(429).json({ error: "rate limit exceeded" });
  }
  next();
});

app.get("/healthz", (_req, res) => res.json({ ok: true, ts: Date.now() }));

// CSRF guard for all /api mutating requests
app.use("/api", checkOrigin);

// Auth routes
app.use("/api/auth", authRouter);
app.use("/api", meRouter); // GET /api/me

// Workspace + team routes
app.use("/api/workspaces", workspacesRouter);
app.use("/api/team", teamRouter);
app.use("/api/invites", invitesRouter);

// Conversations routes
app.use("/api/conversations", conversationsRouter);

// ---- Realtime fan-out: turn in-process events into socket broadcasts ----
// Registered at module load; the emit helpers no-op until initSocket runs
// (so tests, which never init the socket server, are unaffected).
onMessageCreated(({ workspaceId, message }) => {
  const payload = { conversationId: message.conversationId, message };
  emitToConversation(message.conversationId, "message:new", payload);
  emitToWorkspace(workspaceId, "message:new", payload);
});
onConversationUpdated(({ workspaceId, conversation }) => {
  emitToWorkspace(workspaceId, "conversation:updated", { conversation });
});

// Dev seed route — only mounted when DEMO_MODE is true
if (env.DEMO_MODE) {
  app.post("/api/dev/seed", async (req, res) => {
    try {
      const wsId = req.header("X-Workspace-Id");
      if (!wsId) {
        return void res.status(400).json({ error: "X-Workspace-Id header required" });
      }

      // Create a demo contact
      const contactId = newId();
      await db.insert(contacts).values({
        id: contactId,
        workspaceId: wsId,
        email: `demo-contact-${Date.now()}@example.com`,
        name: "Demo Contact",
        lastSeenAt: new Date(),
      });

      // Conversation 1: open chat conversation with a few messages
      const conv1Id = newId();
      await db.insert(conversations).values({
        id: conv1Id,
        workspaceId: wsId,
        contactId,
        channel: "chat",
        status: "open",
        lastMessageAt: new Date(),
      });
      await db.insert(messages).values([
        {
          id: newId(),
          conversationId: conv1Id,
          workspaceId: wsId,
          senderType: "contact",
          body: "Hello! I need help with my account.",
          createdAt: new Date(Date.now() - 10 * 60 * 1000),
        },
        {
          id: newId(),
          conversationId: conv1Id,
          workspaceId: wsId,
          senderType: "agent",
          body: "Hi there! I'd be happy to help. What seems to be the issue?",
          createdAt: new Date(Date.now() - 9 * 60 * 1000),
        },
        {
          id: newId(),
          conversationId: conv1Id,
          workspaceId: wsId,
          senderType: "contact",
          body: "I can't log in to my account.",
          createdAt: new Date(Date.now() - 8 * 60 * 1000),
        },
      ]);

      // Conversation 2: snoozed email conversation
      const snoozeUntil = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now
      const conv2Id = newId();
      await db.insert(conversations).values({
        id: conv2Id,
        workspaceId: wsId,
        contactId,
        channel: "email",
        status: "snoozed",
        subject: "Billing question",
        snoozedUntil: snoozeUntil,
        lastMessageAt: new Date(Date.now() - 30 * 60 * 1000),
      });
      await db.insert(messages).values([
        {
          id: newId(),
          conversationId: conv2Id,
          workspaceId: wsId,
          senderType: "contact",
          body: "I have a question about my latest invoice.",
          emailMessageId: `msg-${Date.now()}@example.com`,
          createdAt: new Date(Date.now() - 35 * 60 * 1000),
        },
        {
          id: newId(),
          conversationId: conv2Id,
          workspaceId: wsId,
          senderType: "agent",
          body: "Thanks for reaching out! I'll look into this and get back to you shortly.",
          createdAt: new Date(Date.now() - 30 * 60 * 1000),
        },
      ]);

      // Conversation 3: resolved chat conversation
      const conv3Id = newId();
      await db.insert(conversations).values({
        id: conv3Id,
        workspaceId: wsId,
        contactId,
        channel: "chat",
        status: "resolved",
        lastMessageAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
      });
      await db.insert(messages).values([
        {
          id: newId(),
          conversationId: conv3Id,
          workspaceId: wsId,
          senderType: "contact",
          body: "My issue has been resolved, thank you!",
          createdAt: new Date(Date.now() - 2.5 * 60 * 60 * 1000),
        },
        {
          id: newId(),
          conversationId: conv3Id,
          workspaceId: wsId,
          senderType: "agent",
          body: "Great! Glad we could help. Have a nice day!",
          createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
        },
      ]);

      return void res.status(201).json({
        ok: true,
        contactId,
        conversations: [
          { id: conv1Id, status: "open", channel: "chat" },
          { id: conv2Id, status: "snoozed", channel: "email", snoozedUntil: snoozeUntil },
          { id: conv3Id, status: "resolved", channel: "chat" },
        ],
      });
    } catch (err) {
      console.error("[seed]", err);
      return void res.status(500).json({ error: "seed failed" });
    }
  });
}

// Snooze sweeper: reopen snoozed conversations whose snoozedUntil has passed,
// then emit conversation:updated per reopened row so open inboxes update live.
if (process.env.VITEST === undefined) {
  const sweeper = setInterval(async () => {
    try {
      const now = new Date();
      const due = await db
        .select()
        .from(conversations)
        .where(
          and(
            eq(conversations.status, "snoozed"),
            lt(conversations.snoozedUntil, now)
          )
        );
      if (due.length === 0) return;
      await db
        .update(conversations)
        .set({ status: "open", snoozedUntil: null })
        .where(
          and(
            eq(conversations.status, "snoozed"),
            lt(conversations.snoozedUntil, now)
          )
        );
      for (const row of due) {
        emitConversationUpdated({
          workspaceId: row.workspaceId,
          conversation: { ...row, status: "open", snoozedUntil: null },
        });
      }
    } catch (err) {
      console.error("[snooze-sweeper]", err);
    }
  }, 60_000);
  sweeper.unref();

  initSocket(httpServer);
  httpServer.listen(env.PORT, () => console.log(`listening :${env.PORT}`));
}
