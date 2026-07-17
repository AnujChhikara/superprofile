import { defineConfig } from "drizzle-kit";

// Pick up DATABASE_URL from a local .env when running migrations by hand.
try {
  process.loadEnvFile();
} catch {
  /* no .env present — falls back to the default/inline DATABASE_URL */
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/support",
  },
});
