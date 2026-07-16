import sanitizeHtml from "sanitize-html";

// KB article HTML allowlist — safe formatting only; links forced to safe
// schemes with rel hardening.
const ARTICLE_OPTS: sanitizeHtml.IOptions = {
  allowedTags: [
    "h1", "h2", "h3", "h4", "p", "br",
    "strong", "em", "u", "s",
    "a", "ul", "ol", "li",
    "code", "pre", "blockquote",
  ],
  allowedAttributes: { a: ["href"] },
  allowedSchemes: ["https", "mailto"],
  transformTags: {
    a: sanitizeHtml.simpleTransform("a", { rel: "noopener nofollow" }),
  },
};

export function sanitizeArticleHtml(input: string): string {
  return sanitizeHtml(input, ARTICLE_OPTS);
}

// Plain-text projection for FTS + search snippets.
export function articleText(input: string): string {
  return sanitizeHtml(input, { allowedTags: [], allowedAttributes: {} })
    .replace(/\s+/g, " ")
    .trim();
}
