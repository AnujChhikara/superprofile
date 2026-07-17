import { Router } from "express";
import crypto from "crypto";
import multer from "multer";
import { z } from "zod";
import { env } from "../env.js";
import { logger } from "../lib/log.js";
import { handleInbound } from "../email/inbound.js";

export const webhooksRouter = Router();

const upload = multer();

// SendGrid Inbound Parse fields we consume. `to`/`from` are required to route
// the message; the rest are optional. Unknown fields are ignored.
const inboundSchema = z.object({
  to: z.string().min(1),
  from: z.string().min(1),
  subject: z.string().optional(),
  text: z.string().optional(),
  html: z.string().optional(),
  headers: z.string().optional(),
});

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

// SendGrid Inbound Parse posts multipart/form-data. The secret is in the path
// so we can reject before parsing. Always 200 on handled errors so SendGrid
// doesn't retry a message we've already accepted (or can't process).
webhooksRouter.post(
  "/sendgrid-inbound/:secret",
  upload.none(),
  async (req, res) => {
    if (!safeEqual(String(req.params.secret), env.INBOUND_WEBHOOK_SECRET)) {
      return void res.status(403).json({ error: "forbidden" });
    }
    // Validate the parsed form. Malformed payloads are logged and acked with
    // 200 so SendGrid doesn't retry something we can never process.
    const parsed = inboundSchema.safeParse(req.body);
    if (!parsed.success) {
      req.log.warn(
        { issues: parsed.error.flatten() },
        "inbound webhook: invalid payload"
      );
      return void res.json({ ok: true, ignored: true });
    }
    try {
      await handleInbound(parsed.data);
    } catch (err) {
      logger.error({ err }, "inbound webhook: handling failed");
    }
    return void res.json({ ok: true });
  }
);
