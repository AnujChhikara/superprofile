import { pino, destination } from "pino";
import { env } from "../env.js";

// Structured JSON logger. Silent under tests (keeps vitest output clean),
// debug in dev, info in production. Cookies/tokens are redacted so credentials
// never land in logs.
export const logger = pino(
  {
    level: process.env.VITEST
      ? "silent"
      : process.env.LOG_LEVEL ??
        (env.NODE_ENV === "production" ? "info" : "debug"),
    redact: {
      paths: [
        "req.headers.cookie",
        "req.headers.authorization",
        "*.password",
        "*.token",
        "*.visitorToken",
        "*.workspaceKey",
      ],
      remove: true,
    },
  },
  // Synchronous destination so logs flush before process.exit() during
  // graceful shutdown (buffered writes would otherwise be dropped). At this
  // single-instance scale the throughput cost is negligible.
  destination({ sync: true })
);
