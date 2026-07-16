import { Router } from "express";
import crypto from "crypto";
import multer from "multer";
import { env } from "../env.js";
import { handleInbound, type SendGridInbound } from "../email/inbound.js";

export const webhooksRouter = Router();

const upload = multer();

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
    try {
      const b = req.body as Record<string, string>;
      const fields: SendGridInbound = {
        to: b.to ?? "",
        from: b.from ?? "",
        subject: b.subject,
        text: b.text,
        html: b.html,
        headers: b.headers,
      };
      await handleInbound(fields);
    } catch (err) {
      console.error("[webhook] inbound handling failed:", err);
    }
    return void res.json({ ok: true });
  }
);
