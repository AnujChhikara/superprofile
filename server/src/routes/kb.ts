import { Router } from "express";
import { z } from "zod";
import { db, newId } from "../db/client.js";
import { kbArticles, kbCategories } from "../db/schema.js";
import { and, eq, asc, desc } from "drizzle-orm";
import { requireAuth, requireWorkspace } from "../auth/middleware.js";
import { sanitizeArticleHtml, articleText } from "../lib/sanitize.js";

export const kbRouter = Router();
kbRouter.use(requireAuth, requireWorkspace());


function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "untitled"
  );
}

// Ensure a slug is unique within the workspace by appending -2, -3, …
async function uniqueSlug(
  workspaceId: string,
  base: string,
  table: typeof kbArticles | typeof kbCategories,
  ignoreId?: string
): Promise<string> {
  let candidate = base;
  let n = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const rows = await db
      .select({ id: table.id, slug: table.slug })
      .from(table)
      .where(and(eq(table.workspaceId, workspaceId), eq(table.slug, candidate)));
    const clash = rows.find((r) => r.id !== ignoreId);
    if (!clash) return candidate;
    n += 1;
    candidate = `${base}-${n}`;
  }
}

// ---------------- Articles ----------------
kbRouter.get("/articles", async (req, res) => {
  const wsId = req.workspaceId!;
  const rows = await db
    .select()
    .from(kbArticles)
    .where(eq(kbArticles.workspaceId, wsId))
    .orderBy(desc(kbArticles.updatedAt));
  return void res.json(rows);
});

kbRouter.get("/articles/:id", async (req, res) => {
  const wsId = req.workspaceId!;
  const row = (
    await db
      .select()
      .from(kbArticles)
      .where(
        and(eq(kbArticles.id, String(req.params.id)), eq(kbArticles.workspaceId, wsId))
      )
  )[0];
  if (!row) return void res.status(404).json({ error: "not found" });
  return void res.json(row);
});

const articleBody = z.object({
  title: z.string().min(1),
  bodyHtml: z.string().default(""),
  categoryId: z.string().nullable().optional(),
});

kbRouter.post("/articles", async (req, res) => {
  const wsId = req.workspaceId!;
  const parsed = articleBody.safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: "invalid body" });
  const bodyHtml = sanitizeArticleHtml(parsed.data.bodyHtml);
  const bodyText = articleText(parsed.data.bodyHtml);
  const slug = await uniqueSlug(wsId, slugify(parsed.data.title), kbArticles);
  const id = newId();
  await db.insert(kbArticles).values({
    id,
    workspaceId: wsId,
    categoryId: parsed.data.categoryId ?? null,
    title: parsed.data.title,
    slug,
    bodyHtml,
    bodyText,
    status: "draft",
  });
  const row = (
    await db.select().from(kbArticles).where(eq(kbArticles.id, id))
  )[0];
  return void res.status(201).json(row);
});

const articlePatch = z.object({
  title: z.string().min(1).optional(),
  bodyHtml: z.string().optional(),
  categoryId: z.string().nullable().optional(),
  status: z.enum(["draft", "published"]).optional(),
});

kbRouter.patch("/articles/:id", async (req, res) => {
  const wsId = req.workspaceId!;
  const id = String(req.params.id);
  const parsed = articlePatch.safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: "invalid body" });
  const existing = (
    await db
      .select()
      .from(kbArticles)
      .where(and(eq(kbArticles.id, id), eq(kbArticles.workspaceId, wsId)))
  )[0];
  if (!existing) return void res.status(404).json({ error: "not found" });

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (parsed.data.title !== undefined) {
    patch.title = parsed.data.title;
    // Keep the URL slug in sync with the title so a renamed article no longer
    // stays at its "untitled-article" slug. Regenerate whenever the current
    // slug doesn't already derive from this title (allowing the -2/-3 uniqueness
    // suffix), which also repairs articles saved before this behavior existed.
    const base = slugify(parsed.data.title);
    const derivesFromTitle = new RegExp(`^${base}(-\\d+)?$`).test(existing.slug);
    if (!derivesFromTitle) {
      patch.slug = await uniqueSlug(wsId, base, kbArticles, id);
    }
  }
  if (parsed.data.categoryId !== undefined)
    patch.categoryId = parsed.data.categoryId;
  if (parsed.data.status !== undefined) patch.status = parsed.data.status;
  if (parsed.data.bodyHtml !== undefined) {
    patch.bodyHtml = sanitizeArticleHtml(parsed.data.bodyHtml);
    patch.bodyText = articleText(parsed.data.bodyHtml);
  }
  await db.update(kbArticles).set(patch).where(eq(kbArticles.id, id));
  const row = (
    await db.select().from(kbArticles).where(eq(kbArticles.id, id))
  )[0];
  return void res.json(row);
});

kbRouter.post("/articles/:id/publish", async (req, res) => {
  const wsId = req.workspaceId!;
  const id = String(req.params.id);
  const existing = (
    await db
      .select()
      .from(kbArticles)
      .where(and(eq(kbArticles.id, id), eq(kbArticles.workspaceId, wsId)))
  )[0];
  if (!existing) return void res.status(404).json({ error: "not found" });
  await db
    .update(kbArticles)
    .set({ status: "published", updatedAt: new Date() })
    .where(eq(kbArticles.id, id));
  return void res.json({ ok: true });
});

kbRouter.delete("/articles/:id", async (req, res) => {
  const wsId = req.workspaceId!;
  await db
    .delete(kbArticles)
    .where(
      and(eq(kbArticles.id, String(req.params.id)), eq(kbArticles.workspaceId, wsId))
    );
  return void res.json({ ok: true });
});

// ---------------- Categories ----------------
kbRouter.get("/categories", async (req, res) => {
  const wsId = req.workspaceId!;
  const rows = await db
    .select()
    .from(kbCategories)
    .where(eq(kbCategories.workspaceId, wsId))
    .orderBy(asc(kbCategories.position));
  return void res.json(rows);
});

const categoryBody = z.object({
  name: z.string().min(1),
  position: z.number().int().optional(),
});

kbRouter.post("/categories", async (req, res) => {
  const wsId = req.workspaceId!;
  const parsed = categoryBody.safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: "invalid body" });
  const slug = await uniqueSlug(wsId, slugify(parsed.data.name), kbCategories);
  const id = newId();
  await db.insert(kbCategories).values({
    id,
    workspaceId: wsId,
    name: parsed.data.name,
    slug,
    position: parsed.data.position ?? 0,
  });
  const row = (
    await db.select().from(kbCategories).where(eq(kbCategories.id, id))
  )[0];
  return void res.status(201).json(row);
});

kbRouter.patch("/categories/:id", async (req, res) => {
  const wsId = req.workspaceId!;
  const id = String(req.params.id);
  const parsed = z
    .object({ name: z.string().min(1).optional(), position: z.number().int().optional() })
    .safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: "invalid body" });
  const existing = (
    await db
      .select()
      .from(kbCategories)
      .where(and(eq(kbCategories.id, id), eq(kbCategories.workspaceId, wsId)))
  )[0];
  if (!existing) return void res.status(404).json({ error: "not found" });
  const patch: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) patch.name = parsed.data.name;
  if (parsed.data.position !== undefined) patch.position = parsed.data.position;
  if (Object.keys(patch).length)
    await db.update(kbCategories).set(patch).where(eq(kbCategories.id, id));
  const row = (
    await db.select().from(kbCategories).where(eq(kbCategories.id, id))
  )[0];
  return void res.json(row);
});

kbRouter.delete("/categories/:id", async (req, res) => {
  const wsId = req.workspaceId!;
  await db
    .delete(kbCategories)
    .where(
      and(eq(kbCategories.id, String(req.params.id)), eq(kbCategories.workspaceId, wsId))
    );
  return void res.json({ ok: true });
});
