import express from "express";
import http from "http";
import cors from "cors";
import cookieParser from "cookie-parser";
import { env } from "./env.js";
import { checkOrigin } from "./auth/middleware.js";
import { authRouter, meRouter } from "./routes/auth.js";
import { workspacesRouter } from "./routes/workspaces.js";
import { teamRouter, invitesRouter } from "./routes/team.js";

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

if (process.env.VITEST === undefined) {
  httpServer.listen(env.PORT, () => console.log(`listening :${env.PORT}`));
}
