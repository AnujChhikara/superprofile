import "express-async-errors"; // route async throws → error middleware (Express 4)
import express, { type Request, type Response } from "express";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { readFileSync } from "fs";
import { randomUUID } from "crypto";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { pinoHttp } from "pino-http";
import { env } from "./env.js";
import { logger } from "./lib/log.js";
import { errorHandler, notFoundHandler } from "./lib/http.js";
import { closeSocket } from "./realtime/socket.js";
import { pool } from "./db/client.js";
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
import { analyticsRouter } from "./routes/analytics.js";
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
// Structured request logging + a per-request id (echoed back as x-request-id).
// Handlers can use req.log; the error handler ties 5xx logs to the same id.
app.use(
  pinoHttp({
    logger,
    genReqId: (req, res) => {
      const existing = req.headers["x-request-id"];
      const id = (Array.isArray(existing) ? existing[0] : existing) || randomUUID();
      res.setHeader("x-request-id", id);
      return id;
    },
    autoLogging: { ignore: (req) => req.url === "/healthz" },
    customLogLevel: (_req, res, err) => {
      if (err || res.statusCode >= 500) return "error";
      if (res.statusCode >= 400) return "warn";
      return "info";
    },
  })
);
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

// Rate limiting (express-rate-limit). Keyed on client IP (trust proxy is set so
// req.ip is the real client behind Azure/Vercel). Same 429 shape the app and
// web client already expect. Skipped under tests to keep them deterministic.
// NOTE: in-memory store — correct at a single instance; the at-scale plan is a
// shared Redis store (rate-limit-redis), documented in the README.
const limiterBase = {
  windowMs: 60_000,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => !!process.env.VITEST,
  handler: (_req: Request, res: Response) =>
    void res.status(429).json({ error: "rate limit exceeded" }),
};
// Strict limiter for auth (login/callback) — brute-force / abuse guard.
const authLimiter = rateLimit({ ...limiterBase, limit: 30 });
// General limiter for the authenticated dashboard API. Mounted just before the
// CSRF check below, so the earlier-mounted widget/public routes (cross-origin,
// high-fanout) are unaffected and keep their own limiter.
const apiLimiter = rateLimit({ ...limiterBase, limit: 300 });

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

// General rate limit for the authenticated dashboard API (widget/public routes
// mounted earlier are unaffected and keep their own limiter).
app.use("/api", apiLimiter);

// CSRF guard for all /api mutating requests
app.use("/api", checkOrigin);

// Auth routes (stricter limiter on top of the general one).
app.use("/api/auth", authLimiter, authRouter);
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

// Admin-only analytics dashboard.
app.use("/api/analytics", analyticsRouter);

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
  // Also fan out to the conversation room so visitors viewing the thread learn
  // about status changes (e.g. resolved) live. Handlers are idempotent, so a
  // possible double-delivery to agents in that room is harmless.
  emitToConversation(conversation.id, "conversation:updated", { conversation });
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
      req.log.error({ err }, "simulate-inbound failed");
      return void res.status(500).json({ error: "simulate failed" });
    }
  });
}

// Dev routes (seed) — DEMO_MODE only.
if (env.DEMO_MODE) {
  app.use("/api/dev", devRouter);
}

// ---- Terminal middleware (must come after every route) ----
// Unmatched /api paths → JSON 404 (same shape the web client parses). Other
// unmatched paths (KB/widget/static) already 404 via their own handlers.
app.use("/api", notFoundHandler);
// Central error handler — the single place errors become responses.
app.use(errorHandler);

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
      logger.error({ err }, "snooze-sweeper failed");
    }
  }, 60_000);
  sweeper.unref();

  initSocket(httpServer);
  httpServer.listen(env.PORT, () => logger.info({ port: env.PORT }, "listening"));

  // ---- Graceful shutdown ----
  // On SIGTERM/SIGINT: stop the sweeper, drain sockets, close the HTTP server,
  // then the DB pool — so in-flight work finishes before the process exits.
  let shuttingDown = false;
  async function shutdown(signal: string) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "graceful shutdown started");
    clearInterval(sweeper);
    // Hard cap: exit anyway if draining hangs.
    const force = setTimeout(() => {
      logger.error("graceful shutdown timed out — forcing exit");
      process.exit(1);
    }, 10_000);
    force.unref();
    try {
      await closeSocket();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
      await pool.end();
      logger.info("graceful shutdown complete");
      process.exit(0);
    } catch (err) {
      logger.error({ err }, "error during shutdown");
      process.exit(1);
    }
  }
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("unhandledRejection", (reason) =>
    logger.error({ reason }, "unhandledRejection")
  );
  process.on("uncaughtException", (err) =>
    logger.error({ err }, "uncaughtException")
  );
}
