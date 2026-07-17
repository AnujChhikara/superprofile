import { pgTable, text, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { id, ws } from "./_helpers.js";

export const contacts = pgTable(
  "contacts",
  {
    id: id(),
    workspaceId: ws(),
    email: text("email"),
    name: text("name"),
    visitorToken: text("visitor_token"),
    lastSeenAt: timestamp("last_seen_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("contact_visitor").on(t.workspaceId, t.visitorToken),
    index("contact_email").on(t.workspaceId, t.email),
  ],
);
