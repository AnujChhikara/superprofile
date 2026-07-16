import { z } from "zod";
const schema = z.object({
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.string().default("development"),
  DATABASE_URL: z.string().default("postgres://postgres:postgres@localhost:5432/support"),
  APP_ORIGIN: z.string().default("http://localhost:5173"),
  API_ORIGIN: z.string().default("http://localhost:3000"),
  KB_HOST: z.string().default("localhost:3000"),
  PARSE_DOMAIN: z.string().default("parse.anujchhikara.com"),
  COOKIE_DOMAIN: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().default(""),
  GOOGLE_CLIENT_SECRET: z.string().default(""),
  GOOGLE_REDIRECT_URI: z.string().default("http://localhost:3000/api/auth/google/callback"),
  SENDGRID_API_KEY: z.string().default(""),
  INBOUND_WEBHOOK_SECRET: z.string().default("dev-secret"),
  OPENAI_API_KEY: z.string().default(""),
  DEMO_MODE: z.coerce.boolean().default(true),
  AZURE_SUBSCRIPTION_ID: z.string().default(""),
  AZURE_RESOURCE_GROUP: z.string().default(""),
  AZURE_APP_NAME: z.string().default(""),
});
export const env = schema.parse(process.env);
export const isProd = env.NODE_ENV === "production";
