import crypto from "crypto";
import { db, newId } from "../db/client.js";
import { sessions, users } from "../db/schema.js";
import { eq, and, gt } from "drizzle-orm";
import { env, isProd } from "../env.js";

export const hashToken = (raw: string) =>
  crypto.createHash("sha256").update(raw).digest("hex");

export const sessionCookieOptions = () => ({
  httpOnly: true,
  sameSite: "lax" as const,
  secure: isProd,
  path: "/",
  domain: env.COOKIE_DOMAIN,
  maxAge: 7 * 24 * 3600 * 1000,
});

export async function createSession(userId: string): Promise<string> {
  const raw = crypto.randomBytes(32).toString("hex");
  await db.insert(sessions).values({
    id: newId(),
    tokenHash: hashToken(raw),
    userId,
    expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
  });
  return raw;
}

export async function getSessionUser(raw: string) {
  const rows = await db
    .select({ u: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.tokenHash, hashToken(raw)),
        gt(sessions.expiresAt, new Date())
      )
    );
  return rows[0]?.u ?? null;
}

export async function destroySession(raw: string) {
  await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(raw)));
}
