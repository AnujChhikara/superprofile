import { Router } from "express";
import crypto from "crypto";
import { z } from "zod";
import { db, newId } from "../db/client.js";
import { workspaces, memberships } from "../db/schema.js";
import { requireAuth } from "../auth/middleware.js";
import { and, eq } from "drizzle-orm";

export const workspacesRouter = Router();

// Slug = workspace name lowercased, spaces → underscores, no random suffix.
// This becomes the inbound email local-part: slug@parse.domain
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .replace(/__+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

const createWorkspaceBody = z.object({
  name: z
    .string()
    .min(1)
    .max(40)
    .regex(
      /^[a-zA-Z0-9 _]+$/,
      "Only letters, numbers, spaces, and underscores allowed"
    ),
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
  if (!slug) {
    return void res.status(400).json({ error: "Workspace name must contain at least one letter or number." });
  }

  const publicKey = "pk_" + crypto.randomBytes(16).toString("hex");
  const id = newId();

  let workspace;
  try {
    [workspace] = await db
      .insert(workspaces)
      .values({ id, name, slug, publicKey })
      .returning();
  } catch (err: any) {
    if (err?.code === "23505") {
      return void res.status(409).json({
        error: `The name "${name}" is already taken. Try a more specific name (e.g. "Acme_Support" or "Acme_2024").`,
      });
    }
    throw err;
  }

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
