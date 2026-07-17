// Server-rendered KB public site — plain template literals, no React.
import type { InferSelectModel } from "drizzle-orm";
import type { workspaces, kbArticles, kbCategories } from "../db/schema.js";

type Workspace = InferSelectModel<typeof workspaces>;
type Article = InferSelectModel<typeof kbArticles>;
type Category = InferSelectModel<typeof kbCategories>;

// Reserved URL slug for uncategorized articles (mirrors kbPublic.UNCATEGORIZED_SLUG;
// kept local to avoid a circular import, since kbPublic imports from this module).
const UNCATEGORIZED_SLUG = "general";

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const CSS = `
  * { box-sizing: border-box; }
  body { font-family: system-ui, -apple-system, sans-serif; color: #0f172a; margin: 0; background: #f8fafc; }
  .wrap { max-width: 720px; margin: 0 auto; padding: 40px 20px 80px; }
  header.site { border-bottom: 1px solid #e2e8f0; background: #fff; }
  header.site .inner { max-width: 720px; margin: 0 auto; padding: 20px; display: flex; align-items: center; justify-content: space-between; }
  header.site h1 { font-size: 20px; margin: 0; }
  a { color: #4f46e5; text-decoration: none; }
  a:hover { text-decoration: underline; }
  .search { margin: 24px 0; }
  .search input { width: 100%; padding: 12px 14px; border: 1px solid #cbd5e1; border-radius: 10px; font-size: 15px; }
  .cat { margin: 28px 0; }
  .cat h2 { font-size: 15px; text-transform: uppercase; letter-spacing: .04em; color: #64748b; margin: 0 0 10px; }
  .cat ul { list-style: none; padding: 0; margin: 0; }
  .cat li { padding: 10px 0; border-bottom: 1px solid #eef2f7; }
  article.doc h1 { font-size: 30px; margin: 8px 0 20px; }
  article.doc { background: #fff; padding: 32px; border-radius: 14px; border: 1px solid #e2e8f0; line-height: 1.7; }
  article.doc pre { background: #0f172a; color: #e2e8f0; padding: 14px; border-radius: 8px; overflow-x: auto; }
  article.doc code { background: #f1f5f9; padding: 2px 5px; border-radius: 4px; }
  .muted { color: #94a3b8; }
  .back { display: inline-block; margin-bottom: 16px; font-size: 14px; }
  mark { background: #fef08a; }
`;

function layout(workspaceName: string, title: string, inner: string): string {
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title><style>${CSS}</style></head>
<body><header class="site"><div class="inner"><h1>${escapeHtml(workspaceName)} Help Center</h1></div></header>
<div class="wrap">${inner}</div></body></html>`;
}

function searchBox(basePath: string, q = ""): string {
  return `<form class="search" method="get" action="${escapeHtml(basePath)}/search">
    <input name="q" value="${escapeHtml(q)}" placeholder="Search the help center…" />
  </form>`;
}

export function renderHome(
  ws: Workspace,
  categories: Category[],
  articles: Article[],
  basePath: string
): string {
  const uncategorized = articles.filter((a) => !a.categoryId);
  const sections = categories
    .map((c) => {
      const items = articles.filter((a) => a.categoryId === c.id);
      if (items.length === 0) return "";
      return `<div class="cat"><h2>${escapeHtml(c.name)}</h2><ul>${items
        .map(
          (a) =>
            `<li><a href="${escapeHtml(basePath)}/${escapeHtml(
              c.slug
            )}/${escapeHtml(a.slug)}">${escapeHtml(a.title)}</a></li>`
        )
        .join("")}</ul></div>`;
    })
    .join("");
  const extra =
    uncategorized.length > 0
      ? `<div class="cat"><h2>All</h2><ul>${uncategorized
          .map(
            (a) =>
              `<li><a href="${escapeHtml(
                basePath
              )}/${UNCATEGORIZED_SLUG}/${escapeHtml(a.slug)}">${escapeHtml(
                a.title
              )}</a></li>`
          )
          .join("")}</ul></div>`
      : "";
  const body =
    searchBox(basePath) +
    (sections + extra || `<p class="muted">No articles published yet.</p>`);
  return layout(ws.name, `${ws.name} Help Center`, body);
}

export function renderArticle(
  ws: Workspace,
  article: Article,
  basePath: string
): string {
  // article.bodyHtml is already sanitized at write time.
  const body = `<a class="back" href="${escapeHtml(basePath)}">‹ All articles</a>
    <article class="doc"><h1>${escapeHtml(article.title)}</h1>${article.bodyHtml}</article>`;
  return layout(ws.name, article.title, body);
}

export function renderSearch(
  ws: Workspace,
  q: string,
  results: Array<{ title: string; slug: string; categorySlug: string; snippet: string }>,
  basePath: string
): string {
  const list =
    results.length === 0
      ? `<p class="muted">No results for “${escapeHtml(q)}”.</p>`
      : `<ul style="list-style:none;padding:0">${results
          .map(
            (r) =>
              `<li style="padding:14px 0;border-bottom:1px solid #eef2f7">
              <a href="${escapeHtml(basePath)}/${escapeHtml(
                r.categorySlug
              )}/${escapeHtml(r.slug)}"><strong>${escapeHtml(
                r.title
              )}</strong></a>
              <div class="muted" style="margin-top:4px">${r.snippet}</div></li>`
          )
          .join("")}</ul>`;
  // r.snippet comes from ts_headline; it may contain <mark> only (see kbPublic).
  const body = searchBox(basePath, q) + list;
  return layout(ws.name, `Search: ${q}`, body);
}
