import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { id, ws } from "./_helpers.js";

export const customDomains = pgTable("custom_domains", {
  id: id(),
  workspaceId: ws(),
  hostname: text("hostname").notNull().unique(),
  status: text("status", {
    enum: ["pending_dns", "verifying", "active", "failed"],
  })
    .notNull()
    .default("pending_dns"),
  error: text("error"),
  verifiedAt: timestamp("verified_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
