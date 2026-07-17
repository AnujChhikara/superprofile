import { pgTable, text, timestamp, integer, uniqueIndex } from "drizzle-orm/pg-core";
import { id, ws, tsvector } from "./_helpers.js";

export const kbCategories = pgTable(
  "kb_categories",
  {
    id: id(),
    workspaceId: ws(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    position: integer("position").notNull().default(0),
  },
  (t) => [uniqueIndex("cat_ws_slug").on(t.workspaceId, t.slug)],
);

export const kbArticles = pgTable(
  "kb_articles",
  {
    id: id(),
    workspaceId: ws(),
    categoryId: text("category_id"),
    title: text("title").notNull(),
    slug: text("slug").notNull(),
    bodyHtml: text("body_html").notNull().default(""),
    bodyText: text("body_text").notNull().default(""),
    status: text("status", { enum: ["draft", "published"] })
      .notNull()
      .default("draft"),
    searchVector: tsvector("search_vector"),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("art_ws_slug").on(t.workspaceId, t.slug)],
);
