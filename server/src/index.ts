import express from "express";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { readFileSync } from "fs";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { env } from "./env.js";
import { checkOrigin } from "./auth/middleware.js";
import { authRouter, meRouter } from "./routes/auth.js";
import { workspacesRouter } from "./routes/workspaces.js";
import { teamRouter, invitesRouter } from "./routes/team.js";
import { conversationsRouter } from "./routes/conversations.js";
import { widgetRouter } from "./routes/widget.js";
import { webhooksRouter } from "./routes/webhooks.js";
import { kbRouter } from "./routes/kb.js";
import { kbPublicApiRouter, kbPublicRouter } from "./routes/kbPublic.js";
import { summariesRouter } from "./routes/summaries.js";
import { domainsRouter, customDomainMiddleware } from "./routes/domains.js";
import { devRouter } from "./routes/dev.js";
import { cannedRouter } from "./routes/canned.js";
import { handleInbound } from "./email/inbound.js";
import { db } from "./db/client.js";
import { conversations, workspaces } from "./db/schema.js";
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
// Security headers. CSP/CORP/COEP disabled so the widget can be embedded on,
// and its script loaded by, arbitrary third-party origins. The widget frame
// route below further relaxes X-Frame-Options.
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: false,
    crossOriginEmbedderPolicy: false,
  })
);
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

// ---- Widget: public, embeddable on ANY third-party origin ----
// Mounted BEFORE the /api CSRF origin check (which would reject cross-origin
// POSTs). Auth is by workspaceKey + visitorToken in the body, not cookies, so
// permissive CORS without credentials is safe here.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "..", "public");

app.use("/api/widget", cors({ origin: true, credentials: false }), widgetRouter);

// SendGrid Inbound Parse webhook (not under /api → skips the CSRF origin check).
app.use("/webhooks", webhooksRouter);

// Public KB search API (read-only; widget + public site). Permissive CORS.
app.use("/api/public/kb", cors({ origin: true }), kbPublicApiRouter);

// Host-based routing: the KB host serves the public SSR help center. Guarded so
// it never hijacks the API host (locally both may be "localhost").
const kbHostName = env.KB_HOST.split(":")[0];
const apiHostName = new URL(env.API_ORIGIN).hostname;
app.use((req, res, next) => {
  if (kbHostName !== apiHostName && req.hostname === kbHostName) {
    return kbPublicRouter(req, res, next);
  }
  // Active tenant custom domains serve their KB at root paths.
  if (req.hostname !== apiHostName && req.hostname !== kbHostName) {
    return customDomainMiddleware(req, res, next);
  }
  return next();
});

// Loader script + built frame assets.
app.use(express.static(publicDir));
// SPA entry for the widget iframe (any ?ws=... query). Must be embeddable on
// any origin, so drop X-Frame-Options and allow all frame ancestors.
app.get("/widget/frame", (_req, res) => {
  res.removeHeader("X-Frame-Options");
  res.setHeader("Content-Security-Policy", "frame-ancestors *");
  res.sendFile(path.join(publicDir, "widget", "index.html"), (err) => {
    if (err) res.status(404).send("widget frame not built");
  });
});
// Demo landing page with the seeded demo workspace key injected.
app.get("/demo", async (_req, res) => {
  try {
    let html = readFileSync(path.join(publicDir, "demo.html"), "utf8");
    const demo = (
      await db.select().from(workspaces).where(eq(workspaces.slug, "acme"))
    )[0];
    if (demo) html = html.replaceAll("pk_DEMO_KEY", demo.publicKey);
    res.type("html").send(html);
  } catch {
    res.status(404).send("demo not built");
  }
});

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

// Knowledge base (authed CRUD).
app.use("/api/kb", kbRouter);

// AI summaries (mounted on the conversations base; distinct sub-paths).
app.use("/api/conversations", summariesRouter);

// Custom domains (admin).
app.use("/api/domains", domainsRouter);

// Canned responses (stretch).
app.use("/api/canned", cannedRouter);

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

// Dev inbound-email simulator — DEMO_MODE only. Lets us exercise the email
// threading path without a real SendGrid round-trip.
if (env.DEMO_MODE) {
  app.post("/api/dev/simulate-inbound", async (req, res) => {
    try {
      await handleInbound({
        to: String(req.body.to ?? ""),
        from: String(req.body.from ?? ""),
        subject: req.body.subject,
        text: req.body.text,
        html: req.body.html,
        headers: req.body.headers,
      });
      return void res.json({ ok: true });
    } catch (err) {
      console.error("[simulate-inbound]", err);
      return void res.status(500).json({ error: "simulate failed" });
    }
  });
}

// Dev routes (seed) — DEMO_MODE only.
if (env.DEMO_MODE) {
  app.use("/api/dev", devRouter);
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
