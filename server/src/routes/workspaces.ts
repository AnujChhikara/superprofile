import { Router } from "express";
import crypto from "crypto";
import { z } from "zod";
import { db, newId } from "../db/client.js";
import { workspaces, memberships } from "../db/schema.js";
import { requireAuth } from "../auth/middleware.js";
import { and, eq } from "drizzle-orm";

export const workspacesRouter = Router();

// Slugify: lowercase alphanumeric + hyphens, max 40 chars, plus 6-char random suffix
function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  const suffix = crypto.randomBytes(3).toString("hex"); // 6 hex chars
  return `${base}-${suffix}`;
}

const createWorkspaceBody = z.object({
  name: z.string().min(1).max(80),
});

// POST /api/workspaces — create a workspace (authenticated)
workspacesRouter.post("/", requireAuth, async (req, res) => {
  const parsed = createWorkspaceBody.safeParse(req.body);
  if (!parsed.success) {
    return void res.status(400).json({ error: "invalid body", details: parsed.error.flatten() });
  }

  const { name } = parsed.data;
  const user = req.user!;

  const slug = slugify(name);
  const publicKey = "pk_" + crypto.randomBytes(16).toString("hex");
  const id = newId();

  const [workspace] = await db
    .insert(workspaces)
    .values({ id, name, slug, publicKey })
    .returning();

  await db.insert(memberships).values({
    id: newId(),
    userId: user.id,
    workspaceId: workspace.id,
    role: "admin",
  });

  return void res.status(201).json(workspace);
});

// GET /api/workspaces/:id — get a single workspace (member only)
workspacesRouter.get("/:id", requireAuth, async (req, res) => {
  const user = req.user!;
  const wsId = String(req.params.id);

  // Verify user is a member
  const memberRows = await db
    .select()
    .from(memberships)
    .where(
      and(
        eq(memberships.workspaceId, wsId),
        eq(memberships.userId, user.id)
      )
    );

  if (!memberRows[0]) {
    return void res.status(403).json({ error: "not a member" });
  }

  const wsRows = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, wsId));
  const ws = wsRows[0];

  if (!ws) return void res.status(404).json({ error: "not found" });

  return void res.json(ws);
});
