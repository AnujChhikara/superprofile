import { pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { id, ws } from "./_helpers.js";

export const workspaces = pgTable("workspaces", {
  id: id(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  publicKey: text("public_key").notNull().unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const memberships = pgTable(
  "memberships",
  {
    id: id(),
    userId: text("user_id").notNull(),
    workspaceId: ws(),
    role: text("role", { enum: ["admin", "agent"] }).notNull(),
  },
  (t) => [uniqueIndex("mem_user_ws").on(t.userId, t.workspaceId)],
);

export const invites = pgTable("invites", {
  id: id(),
  workspaceId: ws(),
  email: text("email").notNull(),
  role: text("role", { enum: ["admin", "agent"] }).notNull(),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  acceptedAt: timestamp("accepted_at"),
});
