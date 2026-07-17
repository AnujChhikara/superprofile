import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { id } from "./_helpers.js";

export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  googleId: text("google_id").notNull().unique(),
  name: text("name").notNull(),
  avatarUrl: text("avatar_url"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const sessions = pgTable("sessions", {
  id: id(),
  tokenHash: text("token_hash").notNull().unique(),
  userId: text("user_id").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
