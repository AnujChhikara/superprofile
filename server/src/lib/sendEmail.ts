import { env } from "../env.js";

export interface EmailOptions {
  to: string;
  subject: string;
  text: string;
  html?: string;
  headers?: Record<string, string>;
  from?: string;
}

const DEFAULT_FROM = "no-reply@parse.anujchhikara.com";

export async function sendEmail(opts: EmailOptions): Promise<void> {
  const { to, subject, text, html, headers, from = DEFAULT_FROM } = opts;

  if (!env.SENDGRID_API_KEY) {
    // Dev mode: log instead of sending
    console.log(
      `[sendEmail] SENDGRID_API_KEY not set — would send:\n` +
        `  From: ${from}\n` +
        `  To: ${to}\n` +
        `  Subject: ${subject}\n` +
        `  Text: ${text}`
    );
    return;
  }

  const body: Record<string, unknown> = {
    personalizations: [{ to: [{ email: to }] }],
    from: { email: from },
    subject,
    content: [{ type: "text/plain", value: text }],
  };

  if (html) {
    (body.content as unknown[]).push({ type: "text/html", value: html });
  }

  if (headers && Object.keys(headers).length > 0) {
    body.headers = headers;
  }

  const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.SENDGRID_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "(no body)");
    throw new Error(`SendGrid error ${res.status}: ${errText}`);
  }
}
