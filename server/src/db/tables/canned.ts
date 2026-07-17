import { pgTable, text } from "drizzle-orm/pg-core";
import { id, ws } from "./_helpers.js";

export const cannedResponses = pgTable("canned_responses", {
  id: id(),
  workspaceId: ws(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  createdBy: text("created_by"),
});
