import { Router } from "express";
import { z } from "zod";
import { db, newId } from "../db/client.js";
import { cannedResponses } from "../db/schema.js";
import { and, eq, asc } from "drizzle-orm";
import { requireAuth, requireWorkspace } from "../auth/middleware.js";

export const cannedRouter = Router();
cannedRouter.use(requireAuth, requireWorkspace());

cannedRouter.get("/", async (req, res) => {
  const wsId = req.workspaceId!;
  const rows = await db
    .select()
    .from(cannedResponses)
    .where(eq(cannedResponses.workspaceId, wsId))
    .orderBy(asc(cannedResponses.title));
  return void res.json(rows);
});

const body = z.object({
  title: z.string().min(1),
  body: z.string().min(1),
});

cannedRouter.post("/", async (req, res) => {
  const wsId = req.workspaceId!;
  const parsed = body.safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: "invalid body" });
  const id = newId();
  await db.insert(cannedResponses).values({
    id,
    workspaceId: wsId,
    title: parsed.data.title,
    body: parsed.data.body,
    createdBy: req.user!.id,
  });
  const row = (
    await db.select().from(cannedResponses).where(eq(cannedResponses.id, id))
  )[0];
  return void res.status(201).json(row);
});

cannedRouter.patch("/:id", async (req, res) => {
  const wsId = req.workspaceId!;
  const id = String(req.params.id);
  const parsed = z
    .object({ title: z.string().min(1).optional(), body: z.string().min(1).optional() })
    .safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: "invalid body" });
  const existing = (
    await db
      .select()
      .from(cannedResponses)
      .where(and(eq(cannedResponses.id, id), eq(cannedResponses.workspaceId, wsId)))
  )[0];
  if (!existing) return void res.status(404).json({ error: "not found" });
  const patch: Record<string, unknown> = {};
  if (parsed.data.title !== undefined) patch.title = parsed.data.title;
  if (parsed.data.body !== undefined) patch.body = parsed.data.body;
  if (Object.keys(patch).length)
    await db.update(cannedResponses).set(patch).where(eq(cannedResponses.id, id));
  const row = (
    await db.select().from(cannedResponses).where(eq(cannedResponses.id, id))
  )[0];
  return void res.json(row);
});

cannedRouter.delete("/:id", async (req, res) => {
  const wsId = req.workspaceId!;
  await db
    .delete(cannedResponses)
    .where(
      and(
        eq(cannedResponses.id, String(req.params.id)),
        eq(cannedResponses.workspaceId, wsId)
      )
    );
  return void res.json({ ok: true });
});
