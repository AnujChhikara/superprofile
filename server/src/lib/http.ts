import type { Request, Response, NextFunction, RequestHandler } from "express";
import { ZodError } from "zod";
import { logger } from "./log.js";

// Throw this from any route/service to return a specific status + message.
// The central errorHandler turns it into the app's standard JSON error shape.
export class HttpError extends Error {
  status: number;
  details?: unknown;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.details = details;
  }
}

// Common shortcuts for readable throw sites.
export const badRequest = (msg = "invalid body", details?: unknown) =>
  new HttpError(400, msg, details);
export const unauthorized = (msg = "unauthenticated") => new HttpError(401, msg);
export const forbidden = (msg = "forbidden") => new HttpError(403, msg);
export const notFound = (msg = "not found") => new HttpError(404, msg);
export const conflict = (msg = "conflict") => new HttpError(409, msg);

// Wrap async handlers so rejected promises reach the error middleware even on
// Express 4. (express-async-errors patches this globally too; asyncHandler is
// here for explicit use in new code and remains correct either way.)
export function asyncHandler(fn: RequestHandler): RequestHandler {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

// 404 for anything that fell through all routes. Same shape as every other
// error so the web client's `body.error` parsing keeps working.
export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: "not found" });
}

// Central error handler — the single place errors become responses.
// Emits { error: string, details?: unknown } (the shape the app already used
// everywhere and web/src/api.ts parses). Never leaks internals on 500.
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // If the response already started streaming, defer to Express' default.
  if (res.headersSent) return next(err);

  // Validation errors → 400 with field details.
  if (err instanceof ZodError) {
    res.status(400).json({ error: "invalid body", details: err.flatten() });
    return;
  }

  // Explicit HttpError (or any error carrying a numeric status/statusCode).
  const status =
    err instanceof HttpError
      ? err.status
      : typeof (err as { status?: unknown })?.status === "number"
        ? (err as { status: number }).status
        : typeof (err as { statusCode?: unknown })?.statusCode === "number"
          ? (err as { statusCode: number }).statusCode
          : 500;

  if (status < 500) {
    const message = err instanceof Error ? err.message : "request failed";
    const details = err instanceof HttpError ? err.details : undefined;
    res.status(status).json(details ? { error: message, details } : { error: message });
    return;
  }

  // 5xx: log the real error (with the request id from pino-http) but return an
  // opaque message so we never leak stack traces or internals to clients.
  const log = (req as { log?: typeof logger }).log ?? logger;
  log.error({ err, path: req.originalUrl, method: req.method }, "unhandled error");
  res.status(500).json({ error: "internal server error" });
}
