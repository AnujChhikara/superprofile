import express from "express";
import http from "http";
import cors from "cors";
import cookieParser from "cookie-parser";
import { env } from "./env.js";
import { checkOrigin } from "./auth/middleware.js";
import { authRouter, meRouter } from "./routes/auth.js";

export const app = express();
export const httpServer = http.createServer(app);
app.set("trust proxy", 1);
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "5mb" })); // sendgrid inbound is form-encoded
app.use(cookieParser());
app.use(cors({ origin: env.APP_ORIGIN, credentials: true }));

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

if (process.env.VITEST === undefined) {
  httpServer.listen(env.PORT, () => console.log(`listening :${env.PORT}`));
}
