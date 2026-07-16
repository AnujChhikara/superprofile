import { Router } from "express";
import { db } from "../db/client.js";
import { env } from "../env.js";
import { workspaces, kbArticles, kbCategories } from "../db/schema.js";
import { and, eq, or, sql } from "drizzle-orm";
import { escapeHtml, renderHome, renderArticle, renderSearch } from "../lib/kbHtml.js";

const KB_SCHEME = env.API_ORIGIN.startsWith("https") ? "https" : "http";
export const publicArticleUrl = (slug: string, articleSlug: string) =>
  `${KB_SCHEME}://${env.KB_HOST}/${slug}/${articleSlug}`;

// Resolve a workspace by public key OR slug (widget passes key, site passes slug).
async function resolveWorkspace(keyOrSlug: string) {
  return (
    await db
      .select()
      .from(workspaces)
      .where(
        or(eq(workspaces.publicKey, keyOrSlug), eq(workspaces.slug, keyOrSlug))
      )
  )[0];
}

// Full-text search over published articles. Snippet is XSS-safe: ts_headline
// wraps matches in sentinel markers, we escape the whole string, then restore
// <mark> — so raw <, >, & from article text can't inject markup.
export async function searchArticles(
  workspaceId: string,
  q: string
): Promise<Array<{ id: string; title: string; slug: string; snippet: string }>> {
  if (!q.trim()) return [];
  const rows = await db.execute(sql`
    SELECT id, title, slug,
      ts_headline('english', body_text,
        websearch_to_tsquery('english', ${q}),
        'StartSel=«m»,StopSel=«/m»,MaxWords=30,MinWords=10,ShortWord=2') AS snippet
    FROM kb_articles
    WHERE workspace_id = ${workspaceId}
      AND status = 'published'
      AND search_vector @@ websearch_to_tsquery('english', ${q})
    ORDER BY ts_rank(search_vector, websearch_to_tsquery('english', ${q})) DESC
    LIMIT 5
  `);
  return (rows.rows as Array<{ id: string; title: string; slug: string; snippet: string }>).map(
    (r) => ({
      id: r.id,
      title: r.title,
      slug: r.slug,
      snippet: escapeHtml(r.snippet ?? "")
        .replace(/«m»/g, "<mark>")
        .replace(/«\/m»/g, "</mark>"),
    })
  );
}

// ---- JSON search API (widget + public site search box) ----
export const kbPublicApiRouter = Router();
kbPublicApiRouter.get("/:keyOrSlug/search", async (req, res) => {
  const ws = await resolveWorkspace(String(req.params.keyOrSlug));
  if (!ws) return void res.status(404).json({ error: "unknown workspace" });
  const q = String(req.query.q ?? "");
  const results = await searchArticles(ws.id, q);
  return void res.json(
    results.map((r) => ({ ...r, url: publicArticleUrl(ws.slug, r.slug) }))
  );
});

// ---- SSR public site (mounted for the KB host) ----
export const kbPublicRouter = Router();

async function publishedArticleBySlug(wsId: string, slug: string) {
  return (
    await db
      .select()
      .from(kbArticles)
      .where(
        and(
          eq(kbArticles.workspaceId, wsId),
          eq(kbArticles.slug, slug),
          eq(kbArticles.status, "published")
        )
      )
  )[0];
}

async function renderWorkspaceHome(wsId: string, ws: any, basePath: string) {
  const [categories, articles] = await Promise.all([
    db.select().from(kbCategories).where(eq(kbCategories.workspaceId, wsId)),
    db
      .select()
      .from(kbArticles)
      .where(
        and(eq(kbArticles.workspaceId, wsId), eq(kbArticles.status, "published"))
      ),
  ]);
  return renderHome(ws, categories, articles, basePath);
}

// On the KB host, the first path segment is the workspace slug.
kbPublicRouter.get("/:wsSlug", async (req, res) => {
  const ws = await resolveWorkspace(String(req.params.wsSlug));
  if (!ws) return void res.status(404).send("Not found");
  const basePath = `/${ws.slug}`;
  res.type("html").send(await renderWorkspaceHome(ws.id, ws, basePath));
});

kbPublicRouter.get("/:wsSlug/search", async (req, res) => {
  const ws = await resolveWorkspace(String(req.params.wsSlug));
  if (!ws) return void res.status(404).send("Not found");
  const q = String(req.query.q ?? "");
  const results = await searchArticles(ws.id, q);
  res.type("html").send(renderSearch(ws, q, results, `/${ws.slug}`));
});

kbPublicRouter.get("/:wsSlug/:articleSlug", async (req, res) => {
  const ws = await resolveWorkspace(String(req.params.wsSlug));
  if (!ws) return void res.status(404).send("Not found");
  const article = await publishedArticleBySlug(ws.id, String(req.params.articleSlug));
  if (!article) return void res.status(404).send("Article not found");
  res.type("html").send(renderArticle(ws, article, `/${ws.slug}`));
});

// Used by Task 11 custom domains to serve a workspace's KB at root paths.
export async function renderCustomDomainKb(
  ws: any,
  articleSlug?: string
): Promise<{ status: number; html: string }> {
  if (!articleSlug) {
    return { status: 200, html: await renderWorkspaceHome(ws.id, ws, "") };
  }
  const article = await publishedArticleBySlug(ws.id, articleSlug);
  if (!article) return { status: 404, html: "Article not found" };
  return { status: 200, html: renderArticle(ws, article, "") };
}
