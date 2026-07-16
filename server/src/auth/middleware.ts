import type { RequestHandler } from "express";
import { getSessionUser } from "./session.js";
import { db } from "../db/client.js";
import { memberships } from "../db/schema.js";
import { and, eq } from "drizzle-orm";
import { env } from "../env.js";

export const requireAuth: RequestHandler = async (req, res, next) => {
  const raw = req.cookies?.sid;
  const user = raw ? await getSessionUser(raw) : null;
  if (!user) return void res.status(401).json({ error: "unauthenticated" });
  req.user = user;
  next();
};

// CSRF guard: mutating requests must come from our app origin
export const checkOrigin: RequestHandler = (req, res, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const origin = req.headers.origin ?? "";
  if (origin && origin !== env.APP_ORIGIN)
    return void res.status(403).json({ error: "bad origin" });
  next();
};

export const requireWorkspace =
  (role?: "admin"): RequestHandler =>
  async (req, res, next) => {
    const wsId = req.header("X-Workspace-Id");
    if (!wsId || !req.user)
      return void res.status(400).json({ error: "workspace required" });
    const m = (
      await db
        .select()
        .from(memberships)
        .where(
          and(
            eq(memberships.userId, req.user.id),
            eq(memberships.workspaceId, wsId)
          )
        )
    )[0];
    if (!m) return void res.status(403).json({ error: "not a member" });
    if (role === "admin" && m.role !== "admin")
      return void res.status(403).json({ error: "admin only" });
    req.workspaceId = wsId;
    req.role = m.role as "admin" | "agent";
    next();
  };
