import { Router } from "express";
import crypto from "crypto";
import { googleAuthUrl, exchangeCode } from "../auth/google.js";
import {
  createSession,
  destroySession,
  sessionCookieOptions,
} from "../auth/session.js";
import { requireAuth } from "../auth/middleware.js";
import { db, newId } from "../db/client.js";
import { users, sessions, memberships, workspaces } from "../db/schema.js";
import { eq, and } from "drizzle-orm";
import { env } from "../env.js";

export const authRouter = Router();

// GET /api/auth/google — start OAuth flow
authRouter.get("/google", (req, res) => {
  const stateToken = crypto.randomBytes(16).toString("hex");
  const inviteToken = req.query.invite as string | undefined;

  // Encode state as JSON carrying both the random state token and optional invite token
  const statePayload = JSON.stringify({
    s: stateToken,
    ...(inviteToken ? { invite: inviteToken } : {}),
  });
  const stateEncoded = Buffer.from(statePayload).toString("base64url");

  // Store the raw state token in a short-lived httpOnly cookie for CSRF validation
  res.cookie("oauth_state", stateToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.NODE_ENV === "production",
    maxAge: 10 * 60 * 1000, // 10 minutes
    path: "/",
  });

  res.redirect(googleAuthUrl(stateEncoded));
});

// GET /api/auth/google/callback — OAuth callback
authRouter.get("/google/callback", async (req, res) => {
  const { code, state, error } = req.query as {
    code?: string;
    state?: string;
    error?: string;
  };

  if (error) {
    return void res
      .status(400)
      .json({ error: `google oauth error: ${error}` });
  }

  if (!code || !state) {
    return void res.status(400).json({ error: "missing code or state" });
  }

  // Decode state payload
  let statePayload: { s: string; invite?: string };
  try {
    statePayload = JSON.parse(Buffer.from(state, "base64url").toString("utf8"));
  } catch {
    return void res.status(400).json({ error: "invalid state" });
  }

  // Validate state against cookie
  const cookieState = req.cookies?.oauth_state;
  if (!cookieState || cookieState !== statePayload.s) {
    return void res.status(400).json({ error: "state mismatch" });
  }

  // Clear the state cookie
  res.clearCookie("oauth_state", { path: "/" });

  let googleProfile: { sub: string; email: string; name: string; picture?: string };
  try {
    googleProfile = await exchangeCode(code);
  } catch (err) {
    return void res.status(502).json({ error: "google exchange failed" });
  }

  const { sub: googleId, email, name, picture } = googleProfile;

  // Find or create user
  let user = await db.query.users.findFirst({
    where: eq(users.googleId, googleId),
  });

  if (!user) {
    // Try to find by email (backfill googleId)
    const byEmail = await db.query.users.findFirst({
      where: eq(users.email, email),
    });
    if (byEmail) {
      await db.update(users).set({ googleId }).where(eq(users.id, byEmail.id));
      user = { ...byEmail, googleId };
    } else {
      // Insert new user
      const [created] = await db
        .insert(users)
        .values({
          id: newId(),
          email,
          googleId,
          name,
          avatarUrl: picture ?? null,
        })
        .returning();
      user = created;
    }
  }

  // Create session
  const rawToken = await createSession(user.id);
  res.cookie("sid", rawToken, sessionCookieOptions());

  // Redirect
  const inviteToken = statePayload.invite;
  const redirectPath = inviteToken ? `/invite/${inviteToken}` : "/";
  // Guard against open redirect: only allow redirecting to our app origin
  const redirectTo = `${env.APP_ORIGIN}${redirectPath}`;
  res.redirect(redirectTo);
});

// POST /api/auth/logout
authRouter.post("/logout", async (req, res) => {
  const raw = req.cookies?.sid;
  if (raw) {
    await destroySession(raw);
  }
  res.clearCookie("sid", { ...sessionCookieOptions(), maxAge: 0 });
  res.json({ ok: true });
});

// GET /api/me
authRouter.get("/me", requireAuth, async (req, res) => {
  const user = req.user!;

  const membershipRows = await db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      slug: workspaces.slug,
      role: memberships.role,
    })
    .from(memberships)
    .innerJoin(workspaces, eq(workspaces.id, memberships.workspaceId))
    .where(eq(memberships.userId, user.id));

  res.json({ user, workspaces: membershipRows });
});
