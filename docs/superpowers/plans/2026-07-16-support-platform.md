# Support Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a live, multi-tenant Intercom-style support platform (chat widget + email channel + unified inbox + KB + AI summaries + custom domains) per `docs/superpowers/specs/2026-07-16-support-platform-design.md`.

**Architecture:** Single Express+Socket.io process on Azure App Service (`api.anujchhikara.com`, also serves `kb.` and tenant custom domains + widget); React/Vite SPA on Vercel (`app.anujchhikara.com`); Azure Postgres + Drizzle; SendGrid in/out; OpenAI summaries; Azure ARM API for tenant SSL.

**Tech Stack:** Node 20, TypeScript, Express 4, Socket.io 4, Drizzle ORM + pg, zod, React 18 + Vite + TanStack Query, Preact (widget), TipTap, vitest + supertest, pnpm workspaces.

**Testing philosophy (deadline-driven, stated in spec):** TDD with vitest on pure/high-risk logic — email thread resolution, session/cookie auth, tenant scoping, summary prompt builder, custom-domain state machine. UI and third-party integrations get scripted manual verification steps. Every task ends deployable.

## Global Constraints

- All tenant queries take `workspaceId` as a required first argument, derived server-side from the session — never from client input.
- One session cookie: `sid`, `HttpOnly; Secure; SameSite=Lax; Domain=.anujchhikara.com; Path=/; Max-Age=604800`. Local dev omits `Domain` and `Secure`.
- Google OAuth is the ONLY login method. No password columns/flows.
- Chat/email bodies render as escaped text; KB HTML sanitized with `sanitize-html` allowlist.
- Env vars (App Service config / `.env` locally): `PORT`, `DATABASE_URL`, `NODE_ENV`, `APP_ORIGIN`, `API_ORIGIN`, `KB_HOST`, `PARSE_DOMAIN`, `COOKIE_DOMAIN`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `SENDGRID_API_KEY`, `INBOUND_WEBHOOK_SECRET`, `OPENAI_API_KEY`, `DEMO_MODE`, `AZURE_SUBSCRIPTION_ID`, `AZURE_RESOURCE_GROUP`, `AZURE_APP_NAME`.
- Commit after every task minimum; prefer per-step. Conventional commits (`feat:`, `fix:`, `chore:`).
- Socket.io event names and payloads are defined in Task 6 and are canonical for all later tasks.

---

### Task 0: Cloud provisioning (manual + az CLI checklist)

**Files:** none (cloud + DNS). Record outputs in `docs/provisioning-notes.md` (gitignored secrets NOT included).

**Produces:** live Azure app skeleton URL, Postgres connection string, DNS in place, Google/SendGrid/OpenAI/Vercel credentials as env vars.

- [ ] **Step 1: Azure resources**

```bash
az group create -n superprofile-rg -l centralindia
az appservice plan create -n superprofile-plan -g superprofile-rg --sku B1 --is-linux
az webapp create -n superprofile-api -g superprofile-rg -p superprofile-plan --runtime "NODE:20-lts"
az webapp config set -n superprofile-api -g superprofile-rg --web-sockets-enabled true --always-on true
az webapp identity assign -n superprofile-api -g superprofile-rg
# grant the managed identity rights to manage its own hostnames/certs:
az role assignment create --assignee <principalId from previous output> \
  --role "Website Contributor" --scope $(az webapp show -n superprofile-api -g superprofile-rg --query id -o tsv)
az postgres flexible-server create -n superprofile-pg -g superprofile-rg -l centralindia \
  --tier Burstable --sku-name Standard_B1ms --storage-size 32 --version 16 \
  --admin-user appadmin --admin-password '<generate strong>' --public-access 0.0.0.0
az postgres flexible-server db create -g superprofile-rg -s superprofile-pg -d support
```

- [ ] **Step 2: DNS records in Cloudflare (all DNS-only / grey cloud)**

| Name | Type | Value |
|---|---|---|
| `api` | CNAME | `superprofile-api.azurewebsites.net` |
| `asuid.api` | TXT | `az webapp show -n superprofile-api -g superprofile-rg --query customDomainVerificationId -o tsv` |
| `kb` | CNAME | `superprofile-api.azurewebsites.net` |
| `asuid.kb` | TXT | same verification ID |
| `parse` | MX 10 | `mx.sendgrid.net` |
| `app` | CNAME | `cname.vercel-dns.com` (after Vercel project exists, Task 1) |

```bash
az webapp config hostname add --webapp-name superprofile-api -g superprofile-rg --hostname api.anujchhikara.com
az webapp config hostname add --webapp-name superprofile-api -g superprofile-rg --hostname kb.anujchhikara.com
# free managed certs + SNI bind for both hostnames:
az webapp config ssl create -g superprofile-rg -n superprofile-api --hostname api.anujchhikara.com
az webapp config ssl create -g superprofile-rg -n superprofile-api --hostname kb.anujchhikara.com
```

- [ ] **Step 3: SendGrid** — create account; Settings → Sender Authentication → Authenticate Domain `anujchhikara.com` (add the 3 CNAMEs it gives to Cloudflare); Settings → Inbound Parse → add host `parse.anujchhikara.com` → URL `https://api.anujchhikara.com/webhooks/sendgrid-inbound/<INBOUND_WEBHOOK_SECRET>` (generate secret: `openssl rand -hex 24`), check "POST the raw, full MIME message" OFF (use default parsed fields). Create API key with Mail Send permission.
- [ ] **Step 4: Google OAuth** — Google Cloud Console → OAuth client (Web): authorized redirect URIs `https://api.anujchhikara.com/api/auth/google/callback` and `http://localhost:3000/api/auth/google/callback`. Record client ID/secret.
- [ ] **Step 5: Set App Service settings**

```bash
az webapp config appsettings set -n superprofile-api -g superprofile-rg --settings \
  NODE_ENV=production APP_ORIGIN=https://app.anujchhikara.com API_ORIGIN=https://api.anujchhikara.com \
  KB_HOST=kb.anujchhikara.com PARSE_DOMAIN=parse.anujchhikara.com COOKIE_DOMAIN=.anujchhikara.com \
  DATABASE_URL='postgres://appadmin:<pw>@superprofile-pg.postgres.database.azure.com/support?sslmode=require' \
  GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... GOOGLE_REDIRECT_URI=https://api.anujchhikara.com/api/auth/google/callback \
  SENDGRID_API_KEY=... INBOUND_WEBHOOK_SECRET=... OPENAI_API_KEY=... DEMO_MODE=true \
  AZURE_SUBSCRIPTION_ID=$(az account show --query id -o tsv) AZURE_RESOURCE_GROUP=superprofile-rg AZURE_APP_NAME=superprofile-api \
  SCM_DO_BUILD_DURING_DEPLOYMENT=false WEBSITE_RUN_FROM_PACKAGE=1
```

- [ ] **Step 6: Verify** — `curl -s https://superprofile-api.azurewebsites.net` returns Azure default page; `dig +short api.anujchhikara.com CNAME` resolves.

---

### Task 1: Monorepo scaffold + hello-world deployed to both hosts

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `.gitignore`, `.nvmrc`
- Create: `server/package.json`, `server/tsconfig.json`, `server/src/index.ts`, `server/src/env.ts`, `server/vitest.config.ts`
- Create: `web/` (Vite react-ts scaffold), `web/src/App.tsx`
- Create: `.github/workflows/deploy-server.yml`

**Interfaces:**
- Produces: `server/src/env.ts` exporting `env` object (all Global Constraints vars, zod-validated, with dev defaults); Express `app` and `httpServer` exported from `server/src/index.ts` for supertest.

- [ ] **Step 1: Scaffold**

```bash
pnpm init && echo -e "packages:\n  - server\n  - web\n  - widget" > pnpm-workspace.yaml
mkdir -p server/src && cd server && pnpm init
pnpm add express cors cookie-parser zod pg drizzle-orm sanitize-html socket.io
pnpm add -D typescript tsx @types/express @types/cors @types/cookie-parser @types/node @types/sanitize-html vitest supertest @types/supertest drizzle-kit
cd .. && pnpm create vite web --template react-ts
cd web && pnpm add @tanstack/react-query react-router-dom socket.io-client
```

`server/src/env.ts`:

```ts
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
```

`server/src/index.ts`:

```ts
import express from "express";
import http from "http";
import cors from "cors";
import cookieParser from "cookie-parser";
import { env } from "./env";

export const app = express();
export const httpServer = http.createServer(app);
app.set("trust proxy", 1);
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "5mb" })); // sendgrid inbound is form-encoded
app.use(cookieParser());
app.use(cors({ origin: env.APP_ORIGIN, credentials: true }));
app.get("/healthz", (_req, res) => res.json({ ok: true, ts: Date.now() }));

if (process.env.VITEST === undefined) {
  httpServer.listen(env.PORT, () => console.log(`listening :${env.PORT}`));
}
```

- [ ] **Step 2: Deploy workflow** — `.github/workflows/deploy-server.yml`:

```yaml
name: deploy-server
on: { push: { branches: [main] } }
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter server build   # tsc + copies widget/public later
      - run: cd server && pnpm deploy --prod --legacy ../deploy-out && cd ../deploy-out && zip -r ../server.zip .
      - uses: azure/webapps-deploy@v3
        with:
          app-name: superprofile-api
          publish-profile: ${{ secrets.AZURE_PUBLISH_PROFILE }}
          package: server.zip
```

Server `package.json` scripts: `"build": "tsc"`, `"start": "node dist/index.js"`, `"dev": "tsx watch src/index.ts"`, `"test": "vitest run"`. App Service startup command: `az webapp config set -n superprofile-api -g superprofile-rg --startup-file "node dist/index.js"`. Get publish profile: `az webapp deployment list-publishing-profiles -n superprofile-api -g superprofile-rg --xml` → GitHub secret `AZURE_PUBLISH_PROFILE`.

- [ ] **Step 3: Vercel** — create Vercel project rooted at `web/`, framework Vite, add domain `app.anujchhikara.com`. `web/src/App.tsx` renders "Support dashboard — coming up".
- [ ] **Step 4: Verify live** — push to GitHub `main`; `curl https://api.anujchhikara.com/healthz` → `{"ok":true,...}`; open `https://app.anujchhikara.com` → placeholder renders.
- [ ] **Step 5: Commit** (`chore: scaffold monorepo + deploy pipelines`) — commits happen throughout; ensure `.gitignore` covers `node_modules`, `dist`, `.env`, `deploy-out`.

---

### Task 2: Database schema + client + migrations

**Files:**
- Create: `server/src/db/schema.ts`, `server/src/db/client.ts`, `server/drizzle.config.ts`
- Create: `server/drizzle/` (generated migrations)

**Interfaces:**
- Produces: `db` (drizzle instance), all tables below; `newId()` helper (`crypto.randomUUID`). Later tasks import tables from `db/schema`.

- [ ] **Step 1: Write schema** — `server/src/db/schema.ts`:

```ts
import { pgTable, text, timestamp, integer, boolean, uniqueIndex, index, customType } from "drizzle-orm/pg-core";
const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });
const id = () => text("id").primaryKey();
const ws = () => text("workspace_id").notNull();

export const users = pgTable("users", {
  id: id(), email: text("email").notNull().unique(), googleId: text("google_id").notNull().unique(),
  name: text("name").notNull(), avatarUrl: text("avatar_url"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export const sessions = pgTable("sessions", {
  id: id(), tokenHash: text("token_hash").notNull().unique(), userId: text("user_id").notNull(),
  expiresAt: timestamp("expires_at").notNull(), createdAt: timestamp("created_at").defaultNow().notNull(),
});
export const workspaces = pgTable("workspaces", {
  id: id(), name: text("name").notNull(), slug: text("slug").notNull().unique(),
  publicKey: text("public_key").notNull().unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export const memberships = pgTable("memberships", {
  id: id(), userId: text("user_id").notNull(), workspaceId: ws(),
  role: text("role", { enum: ["admin", "agent"] }).notNull(),
}, t => [uniqueIndex("mem_user_ws").on(t.userId, t.workspaceId)]);
export const invites = pgTable("invites", {
  id: id(), workspaceId: ws(), email: text("email").notNull(),
  role: text("role", { enum: ["admin", "agent"] }).notNull(), token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(), acceptedAt: timestamp("accepted_at"),
});
export const contacts = pgTable("contacts", {
  id: id(), workspaceId: ws(), email: text("email"), name: text("name"),
  visitorToken: text("visitor_token"), lastSeenAt: timestamp("last_seen_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, t => [uniqueIndex("contact_visitor").on(t.workspaceId, t.visitorToken),
         index("contact_email").on(t.workspaceId, t.email)]);
export const conversations = pgTable("conversations", {
  id: id(), workspaceId: ws(), contactId: text("contact_id").notNull(),
  channel: text("channel", { enum: ["chat", "email"] }).notNull(),
  status: text("status", { enum: ["open", "snoozed", "resolved"] }).notNull().default("open"),
  assigneeId: text("assignee_id"), subject: text("subject"),
  snoozedUntil: timestamp("snoozed_until"),
  lastMessageAt: timestamp("last_message_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, t => [index("conv_ws_last").on(t.workspaceId, t.lastMessageAt)]);
export const messages = pgTable("messages", {
  id: id(), conversationId: text("conversation_id").notNull(), workspaceId: ws(),
  senderType: text("sender_type", { enum: ["contact", "agent", "system"] }).notNull(),
  senderId: text("sender_id"), body: text("body").notNull(),
  emailMessageId: text("email_message_id"), inReplyTo: text("in_reply_to"), emailReferences: text("email_references"),
  seq: integer("seq").generatedAlwaysAsIdentity(),
  readAt: timestamp("read_at"), createdAt: timestamp("created_at").defaultNow().notNull(),
}, t => [index("msg_conv_seq").on(t.conversationId, t.seq), index("msg_emid").on(t.workspaceId, t.emailMessageId)]);
export const kbCategories = pgTable("kb_categories", {
  id: id(), workspaceId: ws(), name: text("name").notNull(), slug: text("slug").notNull(), position: integer("position").notNull().default(0),
}, t => [uniqueIndex("cat_ws_slug").on(t.workspaceId, t.slug)]);
export const kbArticles = pgTable("kb_articles", {
  id: id(), workspaceId: ws(), categoryId: text("category_id"), title: text("title").notNull(),
  slug: text("slug").notNull(), bodyHtml: text("body_html").notNull().default(""), bodyText: text("body_text").notNull().default(""),
  status: text("status", { enum: ["draft", "published"] }).notNull().default("draft"),
  searchVector: tsvector("search_vector"), updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, t => [uniqueIndex("art_ws_slug").on(t.workspaceId, t.slug)]);
export const summaries = pgTable("summaries", {
  conversationId: text("conversation_id").primaryKey(), workspaceId: ws(),
  body: text("body").notNull(), messageCount: integer("message_count").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export const customDomains = pgTable("custom_domains", {
  id: id(), workspaceId: ws(), hostname: text("hostname").notNull().unique(),
  status: text("status", { enum: ["pending_dns", "verifying", "active", "failed"] }).notNull().default("pending_dns"),
  error: text("error"), verifiedAt: timestamp("verified_at"), createdAt: timestamp("created_at").defaultNow().notNull(),
});
export const cannedResponses = pgTable("canned_responses", {
  id: id(), workspaceId: ws(), title: text("title").notNull(), body: text("body").notNull(), createdBy: text("created_by"),
});
```

`server/src/db/client.ts`:

```ts
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "../env";
import * as schema from "./schema";
export const pool = new Pool({ connectionString: env.DATABASE_URL, max: 10 });
export const db = drizzle(pool, { schema });
export const newId = () => crypto.randomUUID();
```

- [ ] **Step 2: Generate + run migration**

```bash
cd server && pnpm drizzle-kit generate && pnpm drizzle-kit migrate
```

Then add a hand-written migration `server/drizzle/000X_fts.sql` (append via `drizzle-kit generate --custom`):

```sql
ALTER TABLE kb_articles DROP COLUMN IF EXISTS search_vector;
ALTER TABLE kb_articles ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (to_tsvector('english', title || ' ' || body_text)) STORED;
CREATE INDEX art_fts ON kb_articles USING GIN (search_vector);
```

Run migrations on prod DB too (from local, `DATABASE_URL=<azure url> pnpm drizzle-kit migrate`). Add `"migrate": "drizzle-kit migrate"` script; run it as part of App Service startup command: `node dist/index.js` → change startup to `npx drizzle-kit migrate && node dist/index.js` OR simpler: run migrations manually before each deploy that changes schema (choose manual — record in README).

- [ ] **Step 3: Verify** — `psql $DATABASE_URL -c '\dt'` lists all 12 tables locally and on Azure.
- [ ] **Step 4: Commit** — `feat: database schema and migrations`.

---

### Task 3: Google OAuth + cookie sessions + auth middleware

**Files:**
- Create: `server/src/auth/session.ts`, `server/src/auth/google.ts`, `server/src/auth/middleware.ts`, `server/src/routes/auth.ts`
- Create: `server/test/session.test.ts`
- Modify: `server/src/index.ts` (mount router)

**Interfaces:**
- Produces: `createSession(userId): Promise<string /* raw token */>`, `getSessionUser(rawToken): Promise<User|null>`, `hashToken(raw): string`;
  middleware `requireAuth` (sets `req.user`), `requireWorkspace(role?: "admin")` (sets `req.workspaceId`, `req.role` from `X-Workspace-Id` header validated against memberships);
  routes `GET /api/auth/google`, `GET /api/auth/google/callback`, `POST /api/auth/logout`, `GET /api/me` → `{ user, workspaces: [{id,name,slug,role}] }`.
- Express `Request` augmented via `server/src/types.d.ts`: `user?: User; workspaceId?: string; role?: "admin"|"agent"`.

- [ ] **Step 1: Failing tests** — `server/test/session.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { hashToken, sessionCookieOptions } from "../src/auth/session";

describe("sessions", () => {
  it("hashes tokens deterministically and never stores raw", () => {
    expect(hashToken("abc")).toBe(hashToken("abc"));
    expect(hashToken("abc")).not.toContain("abc");
    expect(hashToken("abc")).toHaveLength(64); // sha256 hex
  });
  it("cookie options are HttpOnly + SameSite=Lax", () => {
    const o = sessionCookieOptions();
    expect(o.httpOnly).toBe(true);
    expect(o.sameSite).toBe("lax");
    expect(o.maxAge).toBe(7 * 24 * 3600 * 1000);
  });
});
```

- [ ] **Step 2: Run** `pnpm --filter server test` → FAIL (module not found).
- [ ] **Step 3: Implement** — `server/src/auth/session.ts`:

```ts
import crypto from "crypto";
import { db, newId } from "../db/client";
import { sessions, users } from "../db/schema";
import { eq, and, gt } from "drizzle-orm";
import { env, isProd } from "../env";

export const hashToken = (raw: string) => crypto.createHash("sha256").update(raw).digest("hex");
export const sessionCookieOptions = () => ({
  httpOnly: true, sameSite: "lax" as const, secure: isProd, path: "/",
  domain: env.COOKIE_DOMAIN, maxAge: 7 * 24 * 3600 * 1000,
});
export async function createSession(userId: string): Promise<string> {
  const raw = crypto.randomBytes(32).toString("hex");
  await db.insert(sessions).values({ id: newId(), tokenHash: hashToken(raw), userId,
    expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000) });
  return raw;
}
export async function getSessionUser(raw: string) {
  const rows = await db.select({ u: users }).from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, hashToken(raw)), gt(sessions.expiresAt, new Date())));
  return rows[0]?.u ?? null;
}
export async function destroySession(raw: string) {
  await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(raw)));
}
```

`server/src/auth/google.ts` (no library — two fetches):

```ts
import { env } from "../env";
export function googleAuthUrl(state: string) {
  const p = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, redirect_uri: env.GOOGLE_REDIRECT_URI,
    response_type: "code", scope: "openid email profile", state, prompt: "select_account" });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}
export async function exchangeCode(code: string): Promise<{ sub: string; email: string; name: string; picture?: string }> {
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: env.GOOGLE_REDIRECT_URI, grant_type: "authorization_code" }) });
  if (!r.ok) throw new Error(`google token exchange failed: ${r.status}`);
  const { access_token } = await r.json() as { access_token: string };
  const ui = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", { headers: { authorization: `Bearer ${access_token}` } });
  if (!ui.ok) throw new Error(`google userinfo failed: ${ui.status}`);
  return ui.json() as any;
}
```

`server/src/routes/auth.ts` — flow: `/api/auth/google` sets random `oauth_state` cookie (httpOnly, 10 min) + redirects; callback checks `state` matches cookie, `exchangeCode`, find user by `googleId` else by `email` (backfill googleId) else insert; `createSession`; `res.cookie("sid", raw, sessionCookieOptions())`; redirect to `env.APP_ORIGIN + (inviteToken ? "/invite/"+inviteToken : "/")`. `POST /api/auth/logout` destroys + clears cookie. `GET /api/me` uses `requireAuth`, returns user + memberships join workspaces.

`server/src/auth/middleware.ts`:

```ts
import type { RequestHandler } from "express";
import { getSessionUser } from "./session";
import { db } from "../db/client";
import { memberships } from "../db/schema";
import { and, eq } from "drizzle-orm";
import { env } from "../env";

export const requireAuth: RequestHandler = async (req, res, next) => {
  const raw = req.cookies?.sid;
  const user = raw ? await getSessionUser(raw) : null;
  if (!user) return res.status(401).json({ error: "unauthenticated" });
  req.user = user; next();
};
// CSRF guard: mutating requests must come from our app origin
export const checkOrigin: RequestHandler = (req, res, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const origin = req.headers.origin ?? "";
  if (origin && origin !== env.APP_ORIGIN) return res.status(403).json({ error: "bad origin" });
  next();
};
export const requireWorkspace = (role?: "admin"): RequestHandler => async (req, res, next) => {
  const wsId = req.header("X-Workspace-Id");
  if (!wsId || !req.user) return res.status(400).json({ error: "workspace required" });
  const m = (await db.select().from(memberships)
    .where(and(eq(memberships.userId, req.user.id), eq(memberships.workspaceId, wsId))))[0];
  if (!m) return res.status(403).json({ error: "not a member" });
  if (role === "admin" && m.role !== "admin") return res.status(403).json({ error: "admin only" });
  req.workspaceId = wsId; req.role = m.role as "admin" | "agent"; next();
};
```

Mount in `index.ts`: `app.use("/api", checkOrigin); app.use("/api/auth", authRouter);` plus simple in-memory rate limiter on `/api/auth/*` (30 req/min/IP — small map with timestamps, code it inline ~15 lines).

- [ ] **Step 4: Run tests** → PASS. Manual: `pnpm --filter server dev`, visit `http://localhost:3000/api/auth/google` → Google consent → lands on `localhost:5173/` with `sid` cookie set; `curl -b "sid=..." localhost:3000/api/me` returns user JSON.
- [ ] **Step 5: Commit** — `feat: google oauth login with cookie sessions`.

---

### Task 4: Workspaces, invites, team management (API + dashboard shell)

**Files:**
- Create: `server/src/routes/workspaces.ts`, `server/src/routes/team.ts`, `server/src/lib/sendEmail.ts`
- Create: `web/src/api.ts`, `web/src/auth.tsx`, `web/src/pages/Login.tsx`, `web/src/pages/Onboarding.tsx`, `web/src/pages/Settings/Team.tsx`, `web/src/Layout.tsx`, router in `web/src/main.tsx`

**Interfaces:**
- Produces (API):
  - `POST /api/workspaces {name}` → creates workspace (slug from name + random suffix, publicKey `pk_`+hex), membership admin.
  - `GET /api/team` / `POST /api/team/invites {email, role}` → `{inviteUrl}` (also emailed) / `POST /api/invites/:token/accept` (auth’d) / `PATCH /api/team/members/:userId {role}` / `DELETE /api/team/members/:userId` (admin only).
- Produces (web): `api<T>(path, opts)` fetch wrapper that sends `credentials:"include"` + `X-Workspace-Id` from localStorage `activeWorkspaceId`; `useAuth()` context with `{user, workspaces, activeWorkspace, setActiveWorkspace}`; `<Layout>` with sidebar nav (Inbox / Knowledge Base / Settings).
- `sendEmail({to, subject, text, html?, headers?, from?})` via SendGrid `POST https://api.sendgrid.com/v3/mail/send`; used by invites now, conversations in Task 8. Default from: `no-reply@parse.anujchhikara.com`. On missing `SENDGRID_API_KEY`, logs instead of sending (dev).

- [ ] **Step 1:** Implement `sendEmail` + workspace/team routes (zod bodies; invites: token `crypto.randomBytes(24).toString("hex")`, 7-day expiry; accept: creates membership if invite email == user email or just accept anyway with logged mismatch — choose strict match, return 403 `{error:"invite is for a different email"}` otherwise).
- [ ] **Step 2:** Web: Login page ("Continue with Google" → `location.href = API/api/auth/google`), Onboarding (create first workspace form), Team settings (list members with role dropdown; invite form; copyable invite link), invite accept page `/invite/:token` (calls accept, redirects to inbox). React Query for all fetches.
- [ ] **Step 3: Verify manually** — two Google accounts in two browsers: A signs up, creates workspace, invites B as agent; B opens link, signs in, lands in workspace; A promotes B to admin; role changes reflected in `/api/me`.
- [ ] **Step 4: Commit** — `feat: workspaces, team invites, roles, dashboard shell`.

---

### Task 5: Conversations model + REST + unified inbox UI (pre-realtime)

**Files:**
- Create: `server/src/repos/conversations.ts`, `server/src/routes/conversations.ts`, `server/test/scoping.test.ts`
- Create: `web/src/pages/Inbox/index.tsx`, `web/src/pages/Inbox/ConversationList.tsx`, `web/src/pages/Inbox/Thread.tsx`, `web/src/pages/Inbox/Sidebar.tsx`

**Interfaces:**
- Produces (repo — all functions take `workspaceId` first):
  - `listConversations(workspaceId, {channel?, status?, assigneeId?|"unassigned", limit?})` → conv + contact + lastMessage preview + unreadCount
  - `getConversation(workspaceId, id)`, `listMessages(workspaceId, conversationId, {afterSeq?})`
  - `createMessage(workspaceId, {conversationId, senderType, senderId?, body, emailMessageId?, inReplyTo?, emailReferences?})` → message row (bumps `lastMessageAt`, reopens resolved conversation when senderType="contact")
  - `updateConversation(workspaceId, id, {status?, assigneeId?, snoozedUntil?})`
  - `findOrCreateContact(workspaceId, {email?, visitorToken?, name?})`
- Produces (API): `GET /api/conversations?channel=&status=&assignee=`, `GET /api/conversations/:id`, `GET /api/conversations/:id/messages?after=`, `POST /api/conversations/:id/messages {body}` (agent reply), `PATCH /api/conversations/:id {status?, assigneeId?, snoozedUntil?}`, `POST /api/conversations/:id/read`.
- Emits hook: `onMessageCreated(cb)` / `onConversationUpdated(cb)` — a tiny in-process `EventEmitter` in `server/src/events.ts` so Task 6 (sockets) and Task 10 (summaries) subscribe without circular imports. Payloads: `{workspaceId, conversation, message}` / `{workspaceId, conversation}`.

- [ ] **Step 1: Failing test** — `server/test/scoping.test.ts`: import every exported repo function, assert `fn.length >= 1` and (via a mocked `db` using `vi.mock`) that `listConversations("ws1", {})` includes `eq(conversations.workspaceId, "ws1")` in the where clause (assert the generated SQL string from drizzle's `.toSQL()` on the query builder contains `"workspace_id" =`). Plus reopen logic test: `createMessage` on a resolved conversation with senderType `contact` sets status `open` (use a real local test DB: `DATABASE_URL_TEST` with `beforeEach` truncate — pragmatic, Postgres runs locally).
- [ ] **Step 2:** Run → FAIL. Implement repos + routes (zod-validate query/body; `snooze` requires future date; `read` sets `readAt=now()` on contact messages). Emit events after each write.
- [ ] **Step 3:** Run tests → PASS.
- [ ] **Step 4:** Inbox UI: three panes. Left: filter bar (channel tabs All/Chat/Email; status select; assignee select with "Mine"/"Unassigned"), list sorted by `lastMessageAt` with unread dot + channel icon + preview. Middle: thread bubbles (contact left, agent right, system centered gray), composer (textarea, Enter to send). Right: contact card, status buttons (Resolve / Reopen), snooze menu (1h / tomorrow 9am / custom), assignee dropdown of team members. Polling refetch every 10s for now (removed in Task 6).
- [ ] **Step 5:** Snooze sweeper in `server/src/index.ts`: `setInterval` 60s — `UPDATE conversations SET status='open', snoozed_until=NULL WHERE status='snoozed' AND snoozed_until < now()` then emit `conversation:updated` per row.
- [ ] **Step 6: Verify** — seed via `psql` or a temp `/api/dev/seed` route (DEMO_MODE only): create 3 conversations; filters/assign/snooze/resolve all work; snoozed conv reopens after timer.
- [ ] **Step 7: Commit** — `feat: conversations, messages, unified inbox with filters and actions`.

---

### Task 6: Socket.io real-time layer (canonical protocol)

**Files:**
- Create: `server/src/realtime/socket.ts`, `server/src/realtime/protocol.ts`
- Modify: `server/src/index.ts`, `web/src/lib/socket.ts`, Inbox components (live updates)

**Interfaces (CANONICAL — Tasks 7–10 use these exact names/payloads):**

```ts
// server/src/realtime/protocol.ts
export type ServerEvents = {
  "message:new": { conversationId: string; message: MessageDTO };
  "typing": { conversationId: string; senderType: "contact" | "agent"; isTyping: boolean };
  "presence": { agentOnline: boolean };            // to visitors
  "visitor:presence": { conversationId: string; online: boolean }; // to agents
  "read": { conversationId: string; senderType: "contact" | "agent"; upToSeq: number };
  "conversation:updated": { conversation: ConversationDTO };
  "summary:updated": { conversationId: string; body: string; updatedAt: string };
};
export type ClientEvents = {
  "message:send": { conversationId: string; body: string; clientRef: string };
  "typing": { conversationId: string; isTyping: boolean };
  "read": { conversationId: string; upToSeq: number };
};
```

- Rooms: agents join `ws:{workspaceId}` + are auto-joined to `conv:{id}` on demand; visitors join `conv:{conversationId}` only.
- Auth: default namespace, middleware reads handshake — agents: parse `sid` cookie from `socket.handshake.headers.cookie` → session → memberships (workspace from `socket.handshake.auth.workspaceId`); visitors: `socket.handshake.auth = {visitorToken, workspaceKey}` → contact lookup. Reject otherwise.
- Produces: `initSocket(httpServer)` and `emitToWorkspace(workspaceId, event, payload)` / `emitToConversation(conversationId, event, payload)` used by REST routes via `events.ts` subscriptions.

- [ ] **Step 1:** Implement `socket.ts`: `new Server(httpServer, { cors: { origin: [env.APP_ORIGIN, true], credentials: true } })` (widget iframe is same-origin as API so `true` is fine); auth middleware as above; handlers validate with zod then reuse Task 5 repos (`createMessage`, read updates) — sockets and REST share one write path; ack callback returns saved message (id, seq, createdAt) so sender reconciles `clientRef`. Presence: on agent connect/disconnect recount sockets in `ws:{id}` → broadcast `presence` to that workspace's conversation rooms (simplification: emit to all `conv:*` rooms of workspace via tracking set); visitor connect/disconnect → `visitor:presence` + update `contacts.lastSeenAt`.
- [ ] **Step 2:** Wire `events.ts` subscribers: `onMessageCreated` → `emitToConversation` + `emitToWorkspace("message:new")`; `onConversationUpdated` → `emitToWorkspace`.
- [ ] **Step 3:** Web: `lib/socket.ts` singleton `io(API_ORIGIN, { withCredentials: true, auth: { workspaceId } })`; Inbox subscribes: `message:new` updates thread + list order, `conversation:updated` updates list, `typing` shows "typing…" in thread, `read` renders ✓✓. Composer emits `typing` (debounced 2s off). Remove the 10s polling from Task 5.
- [ ] **Step 4: Verify** — two dashboard tabs, same workspace: message sent from tab A (POST) appears instantly in tab B; assign in A updates B's list; kill server, restart → client auto-reconnects and `GET .../messages?after=lastSeq` backfill (implement in the socket reconnect handler) shows no gaps or dupes.
- [ ] **Step 5: Commit** — `feat: socket.io realtime layer with shared write path`.

---

### Task 7: Embeddable chat widget + demo page

**Files:**
- Create: `widget/package.json`, `widget/vite.config.ts` (two builds: `loader` lib-mode IIFE → `widget.js`; `frame` app), `widget/src/loader.ts`, `widget/src/frame/main.tsx`, `widget/src/frame/App.tsx`, `widget/src/frame/api.ts`
- Create: `server/src/routes/widget.ts`, `server/public/demo.html`
- Modify: `server/src/index.ts` (serve `server/public` statics; `/widget.js`; `/widget/frame`), server build script copies widget dist → `server/public`.

**Interfaces:**
- Produces (public API, no session — rate-limited 60/min per IP+token):
  - `POST /api/widget/init {workspaceKey, visitorToken?}` → `{visitorToken, workspaceName, agentOnline, conversations: [{id, subject?, lastMessageAt, lastPreview, status}]}` (creates contact on first call)
  - `POST /api/widget/conversations {workspaceKey, visitorToken, body}` → creates chat conversation + first message → `{conversation, message}`
  - `POST /api/widget/conversations/:id/messages {workspaceKey, visitorToken, body}` → message (404 unless conversation belongs to that visitor's contact — the tenant-isolation check for visitors)
  - `GET /api/widget/conversations/:id/messages?after=&workspaceKey=&visitorToken=`
  - `POST /api/widget/identify {workspaceKey, visitorToken, email, name?}` → sets contact email (merges: if a contact with that email exists, repoint conversations to it)
  - Socket handshake for visitors per Task 6.

- [ ] **Step 1: Loader** — `widget/src/loader.ts` (~70 lines, no deps): reads `document.currentScript.dataset.workspace`; injects fixed-position launcher button (inline styles, 56px circle, brand color `#4f46e5`, chat glyph, `z-index:2147483000`) + hidden iframe `${API}/widget/frame?ws={key}` (360×600 rounded panel, bottom-right, mobile: full-screen). Toggles on click; listens for `postMessage` `{type:"widget:unread", count}` → badge; `{type:"widget:close"}` → hide.
- [ ] **Step 2: Frame app (Preact)** — screens: **Home** (workspace name header + agent online dot; conversation list; "New conversation" button), **Thread** (messages, composer, typing indicator, ✓/✓✓ on own messages, KB suggestions slot — filled in Task 9, optional email prompt banner if contact has no email), reconnecting banner when socket disconnected. `visitorToken` from `localStorage("sp_visitor")` else `crypto.randomUUID()` persisted. Socket per Task 6 protocol; on `message:new` while panel closed → postMessage unread to loader.
- [ ] **Step 3: Demo page** — `server/public/demo.html`: fake product landing ("Acme Cloud — deploy anything") with hero + pricing cards, plus the real snippet:

```html
<script src="https://api.anujchhikara.com/widget.js" data-workspace="pk_DEMO_KEY" async></script>
```

Served at `GET /demo` with `pk_DEMO_KEY` template-replaced from the seeded demo workspace at request time.

- [ ] **Step 4: Verify** — open `/demo` in incognito: send message → appears live in dashboard inbox; agent reply → appears in widget instantly with typing indicator first; agent presence dot correct; close browser fully, reopen `/demo` → history intact; second workspace's key cannot read first's conversations (manually swap key → init returns different contact).
- [ ] **Step 5: Commit** — `feat: embeddable chat widget with realtime + demo page`.

---

### Task 8: Email channel (SendGrid inbound + outbound with threading)

**Files:**
- Create: `server/src/email/threading.ts`, `server/src/email/inbound.ts`, `server/src/email/outbound.ts`, `server/src/routes/webhooks.ts`
- Create: `server/test/threading.test.ts`
- Modify: `server/src/routes/conversations.ts` (agent reply on email conversations triggers outbound), Thread UI (subject line, delivery-failed retry chip)

**Interfaces:**
- Produces: `resolveThread(workspaceId, {inReplyTo, references}): Promise<string|null>` (conversationId);
  `handleInbound(fields: SendGridInbound): Promise<void>`; `sendReply({workspaceId, conversationId, agent, body}): Promise<{emailMessageId}>`;
  `newMessageId(messageRowId): string` → `` `<msg-${messageRowId}@${PARSE_DOMAIN}>` ``.
- Route: `POST /webhooks/sendgrid-inbound/:secret` (multer/urlencoded — SendGrid posts `multipart/form-data`; add `multer` with `.none()`).

- [ ] **Step 1: Failing tests** — `server/test/threading.test.ts` (mock repo lookup with an injected `findByEmailMessageId(workspaceId, ids: string[])`):

```ts
import { describe, it, expect } from "vitest";
import { pickThreadCandidates, parseAddress, workspaceSlugFromRecipient } from "../src/email/threading";

describe("email threading", () => {
  it("orders candidates: In-Reply-To first, then References newest-first", () => {
    expect(pickThreadCandidates({
      inReplyTo: "<c@x>", references: "<a@x> <b@x> <c@x>",
    })).toEqual(["<c@x>", "<b@x>", "<a@x>"]);
  });
  it("handles missing headers", () => {
    expect(pickThreadCandidates({ inReplyTo: undefined, references: undefined })).toEqual([]);
  });
  it("parses display-name addresses", () => {
    expect(parseAddress('Jane Doe <jane@ex.com>')).toEqual({ name: "Jane Doe", email: "jane@ex.com" });
    expect(parseAddress("jane@ex.com")).toEqual({ name: null, email: "jane@ex.com" });
  });
  it("extracts workspace slug from recipient", () => {
    expect(workspaceSlugFromRecipient("acme@parse.anujchhikara.com", "parse.anujchhikara.com")).toBe("acme");
    expect(workspaceSlugFromRecipient("bob@gmail.com", "parse.anujchhikara.com")).toBeNull();
  });
});
```

- [ ] **Step 2:** Run → FAIL. Implement `threading.ts` pure functions exactly as tested; `resolveThread` = query `messages` where `emailMessageId IN candidates` scoped to workspace, first hit wins.
- [ ] **Step 3:** `inbound.ts`: `handleInbound` — resolve workspace by slug (unknown → log + 200 to stop retries); `findOrCreateContact` by parsed from-email; `resolveThread` → existing conversation (reopen if resolved) else create (`channel:"email"`, subject); `createMessage` with `senderType:"contact"`, body = `fields.text ?? htmlToText(fields.html)` (use `sanitize-html` with `allowedTags: []` for the conversion), store `emailMessageId` (from `fields.headers` `Message-ID`), `inReplyTo`, `emailReferences`. Events from Task 5 make it live in the inbox automatically.
- [ ] **Step 4:** `outbound.ts`: `sendReply` — insert message row first (get id) → `newMessageId(id)` → SendGrid send with `from: {email: slug+"@"+PARSE_DOMAIN, name: workspace.name+" Support"}`, `subject: "Re: "+conversation.subject`, custom `headers: {"Message-ID": mid, "In-Reply-To": lastInbound.emailMessageId, "References": chain}` where chain = lastInbound.emailReferences + " " + lastInbound.emailMessageId; update row with `emailMessageId=mid`; on SendGrid non-2xx set a `system` message "⚠ email delivery failed" and rethrow-safe log. Hook into `POST /api/conversations/:id/messages`: if conversation channel is `email`, call `sendReply` (fire-and-forget with `.catch(log)`).
- [ ] **Step 5:** Webhook route with `multer().none()`, constant-time secret compare, always 200 on handled errors. Dev simulator `POST /api/dev/simulate-inbound` (DEMO_MODE only) accepting `{to, from, subject, text, headers?}` calling `handleInbound`.
- [ ] **Step 6: Verify** — tests PASS; then real: email `demo@parse.anujchhikara.com` from Gmail → appears in inbox <30s; reply from dashboard → arrives in Gmail **in the same thread**; reply again from Gmail → same conversation, no duplicate conversation created.
- [ ] **Step 7: Commit** — `feat: email channel via sendgrid with proper threading`.

---

### Task 9: Knowledge base (editor, categories, public site, search, widget suggest)

**Files:**
- Create: `server/src/routes/kb.ts`, `server/src/routes/kbPublic.ts`, `server/src/lib/sanitize.ts`, `server/src/lib/kbHtml.ts` (template-literal SSR)
- Create: `web/src/pages/KB/ArticleList.tsx`, `web/src/pages/KB/Editor.tsx` (TipTap: `@tiptap/react @tiptap/starter-kit @tiptap/extension-link`), `web/src/pages/KB/Categories.tsx`
- Modify: `widget/src/frame/App.tsx` (suggest panel), `server/src/index.ts` (host-based routing)

**Interfaces:**
- Authed API: `GET/POST/PATCH/DELETE /api/kb/articles`, `POST /api/kb/articles/:id/publish`, `GET/POST/PATCH/DELETE /api/kb/categories`. On save: `bodyHtml = sanitizeHtml(input, allowlist)`; `bodyText = sanitizeHtml(input, {allowedTags: []})`.
- Public: `GET /api/public/kb/:workspaceKeyOrSlug/search?q=` → top 5 `{id,title,slug,snippet}` via `search_vector @@ websearch_to_tsquery('english', $q)` + `ts_headline` snippet, published only. Used by both the public site search and the widget.
- Public site (SSR, no React): Express router mounted by host check — `req.hostname === env.KB_HOST` → paths `/:wsSlug`, `/:wsSlug/:articleSlug`, `/:wsSlug/search?q=`; custom domains (Task 11) map hostname → workspace and serve `/` and `/:articleSlug` at root. Simple clean CSS (single inline stylesheet, max-width 720px, workspace name header, category sections, search box).
- Widget suggest: in Thread composer, debounce 600ms after ≥4 chars → `GET /api/public/kb/{key}/search?q=` → render up to 3 title cards above composer linking to the public article URL (new tab).

- [ ] **Step 1:** Server routes + sanitize allowlist (`h1..h4,p,br,strong,em,u,s,a[href],ul,ol,li,code,pre,blockquote`; `a` gets `rel="noopener nofollow"`, https/mailto only).
- [ ] **Step 2:** Dashboard KB pages (list with status chips, editor with title + TipTap body + category select + Publish button, categories CRUD with position).
- [ ] **Step 3:** SSR public site + search; host-routing middleware in `index.ts` BEFORE the API routers:

```ts
app.use((req, res, next) => {
  const host = req.hostname;
  if (host === env.KB_HOST) return kbPublicRouter(req, res, next);
  return customDomainRouter(req, res, next); // Task 11; falls through to next() when host is API host
});
```

- [ ] **Step 4: Verify** — create 2 categories + 4 articles (1 draft); publish; `kb.anujchhikara.com/{slug}` shows categories, article renders sanitized, search finds by body words, draft absent; typing "how do I reset…" in widget shows suggestions.
- [ ] **Step 5: Commit** — `feat: knowledge base with public site, FTS search, widget suggestions`.

---

### Task 10: AI summaries (OpenAI, rolling context)

**Files:**
- Create: `server/src/ai/openai.ts`, `server/src/ai/summarize.ts`, `server/test/summarize.test.ts`
- Create: `server/src/routes/summaries.ts` (`GET /api/conversations/:id/summary`, `POST /api/conversations/:id/summary/regenerate`)
- Modify: `web/src/pages/Inbox/Sidebar.tsx` (summary card)

**Interfaces:**
- Produces: `buildSummaryPrompt({previousSummary, newMessages}): {system: string, user: string}` (pure, tested); `maybeSummarize(workspaceId, conversationId): Promise<void>` — no-op unless `messageCount >= 6` and `count > summaries.messageCount` and last run >60s ago (in-memory throttle map); calls OpenAI `gpt-4o-mini`, `temperature 0.2`, `max_tokens 220`, 10s `AbortSignal.timeout`; saves to `summaries`; emits `summary:updated`.
- Trigger: `GET /api/conversations/:id` handler calls `void maybeSummarize(...).catch(log)` (fire-and-forget).

- [ ] **Step 1: Failing test** — `server/test/summarize.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildSummaryPrompt } from "../src/ai/summarize";

describe("summary prompt", () => {
  const msgs = Array.from({ length: 40 }, (_, i) => ({ senderType: i % 2 ? "agent" : "contact", body: `m${i}`, createdAt: new Date() }));
  it("caps included messages at 30", () => {
    const { user } = buildSummaryPrompt({ previousSummary: null, newMessages: msgs as any });
    expect(user.match(/^m\d+/gm)?.length ?? (user.match(/m\d+/g)!.length)).toBeLessThanOrEqual(30);
  });
  it("includes previous summary for rolling updates", () => {
    const { user } = buildSummaryPrompt({ previousSummary: "OLD SUMMARY", newMessages: msgs.slice(0, 3) as any });
    expect(user).toContain("OLD SUMMARY");
  });
  it("system prompt demands the three sections", () => {
    const { system } = buildSummaryPrompt({ previousSummary: null, newMessages: msgs.slice(0, 3) as any });
    for (const s of ["What the customer wants", "What's been tried", "Current status"]) expect(system).toContain(s);
  });
});
```

- [ ] **Step 2:** Run → FAIL. Implement:

```ts
export function buildSummaryPrompt({ previousSummary, newMessages }: { previousSummary: string | null; newMessages: Msg[] }) {
  const recent = newMessages.slice(-30);
  const system = `You summarize customer support conversations for an agent who has not read them.
Output EXACTLY three sections with these labels, <=120 words total, plain text:
What the customer wants: ...
What's been tried: ...
Current status: ...
Never invent details. If unknown, write "unclear".`;
  const transcript = recent.map(m => `${m.senderType === "contact" ? "CUSTOMER" : "AGENT"}: ${m.body.slice(0, 500)}`).join("\n");
  const user = (previousSummary ? `Previous summary (update it with the new messages):\n${previousSummary}\n\nNew messages:\n` : `Conversation:\n`) + transcript;
  return { system, user };
}
```

`openai.ts`: single `chat(messages, opts)` fetch to `https://api.openai.com/v1/chat/completions` with timeout + one retry on 429/5xx, returns string or throws typed `AiUnavailableError`.

- [ ] **Step 3:** Summary card UI: shows cached summary with relative "updated Xm ago"; "updating…" shimmer when a `summary:updated` is pending after open; "may be out of date" badge if `summaries.messageCount < conversation count`; regenerate button. AI failure → card keeps old content + subtle error note.
- [ ] **Step 4: Verify** — tests PASS; open a 10+ message conversation → summary appears within seconds and matches the three-section shape; send 3 more messages, reopen → summary updates; set bad `OPENAI_API_KEY` locally → card degrades gracefully, conversation still usable.
- [ ] **Step 5: Commit** — `feat: rolling AI summaries with graceful degradation`.

---

### Task 11: Custom domains (Azure ARM + demo mode)

**Files:**
- Create: `server/src/domains/azure.ts`, `server/src/domains/dnsCheck.ts`, `server/src/domains/service.ts`, `server/src/routes/domains.ts`, `server/test/domains.test.ts`
- Create: `web/src/pages/Settings/Domains.tsx`
- Modify: `server/src/index.ts` (`customDomainRouter`: hostname lookup in `custom_domains` where status=active → serve KB for that workspace at root paths)

**Interfaces:**
- Produces: `checkDns(hostname, expectedCname, verificationId): Promise<{cnameOk: boolean, txtOk: boolean}>` via `https://dns.google/resolve?name=...&type=CNAME|TXT` (pure-ish, fetch injected for tests);
  `provisionDomain(hostname): Promise<void>` — MSI token (`GET ${IDENTITY_ENDPOINT}?resource=https://management.azure.com/&api-version=2019-08-01`, header `X-IDENTITY-HEADER`) → ARM: 1) `PUT .../sites/{app}/hostNameBindings/{hostname}` 2) `PUT .../certificates/cert-{hostname}` with `{properties:{canonicalName: hostname, serverFarmId}}` (poll GET until thumbprint, 20×15s) 3) `PUT hostNameBindings/{hostname}` with `{sslState:"SniEnabled", thumbprint}`;
  `advanceDomain(domainRow): Promise<CustomDomain>` — state machine: `pending_dns` + DNS ok → `verifying` (+ kick provisioning async) → `active` on cert bound / `failed` with error. DEMO_MODE: route `POST /api/domains/:id/simulate` (admin) jumps straight to `active`.
- API (admin): `GET/POST /api/domains {hostname}` (validated: lowercase FQDN, not ours), `POST /api/domains/:id/verify` (runs `advanceDomain`), `DELETE /api/domains/:id`, plus simulate above. Response includes the exact records to add: `CNAME {sub} → superprofile-api.azurewebsites.net`, `TXT asuid.{sub} → {verificationId}` (verificationId fetched once via ARM GET site, cached).

- [ ] **Step 1: Failing tests** — `server/test/domains.test.ts`: state machine with mocked `checkDns`/`provisionDomain`: pending+bad DNS stays pending with helpful `error`; pending+good DNS → verifying and provision called once; hostname validation rejects `API host`, uppercase gets lowered, `not-a-domain` rejected.
- [ ] **Step 2:** Run → FAIL. Implement `dnsCheck`, `azure.ts`, `service.ts` per interfaces.
- [ ] **Step 3:** Settings → Domains UI: add form; per-domain card showing status pill, the two DNS records with copy buttons, Verify button (poll while `verifying`), simulate button when DEMO_MODE (labeled "Simulate verification (demo)"), delete.
- [ ] **Step 4:** `customDomainRouter`: cached (60s TTL map) hostname→workspace lookup; serves same SSR pages as Task 9 at `/` and `/:articleSlug`; unknown host on the app falls through 404 page.
- [ ] **Step 5: Verify** — tests PASS; demo-simulate a domain → `curl -H "Host: help.faketenant.com" https://api.anujchhikara.com/` returns that workspace's KB HTML. If you control a spare subdomain, run the REAL flow once (e.g. `help.anujchhikara.com` CNAME → azurewebsites.net) and confirm cert issues + HTTPS serves.
- [ ] **Step 6: Commit** — `feat: tenant custom domains via Azure managed certs, demo mode fallback`.

---

### Task 12: Seed, polish, README, submission pass

**Files:**
- Create: `server/src/routes/dev.ts` (seed), `README.md`
- Modify: anything failing the checklist below.

- [ ] **Step 1: Seed route** (DEMO_MODE only) — creates "Acme" demo workspace (fixed `pk_` key used by `/demo`), 2 KB categories + 5 published articles, 4 conversations (2 chat / 2 email, one long for AI summary), canned contact data. Idempotent (upsert by slug).
- [ ] **Step 2: Polish pass** — empty states (inbox, KB, team), loading skeletons, error toasts on failed mutations, favicon/title, widget mobile check, helmet on server (`app.use(helmet({contentSecurityPolicy:false}))` except widget frame route gets `frame-ancestors *`... implement as: helmet default `X-Frame-Options DENY`, override `/widget/frame` with `res.removeHeader` + CSP `frame-ancestors *`).
- [ ] **Step 3: README** — sections: Live URLs (app / demo page / KB / email address `acme@parse.anujchhikara.com`), Architecture (diagram from spec §2), Tech choices & why, What's built vs skipped (honest table incl. Google-only auth trade-off note), Real-time design (ordering/reconnect), Email threading design, AI design (prompting, cost, fallbacks), Custom domains (real flow + demo mode), Security notes, Local setup, Known limitations & at-scale plan (Redis adapter, queues, read replicas).
- [ ] **Step 4: Full submission dry-run (the evaluator script)** — fresh incognito: sign up with Google → create workspace → invite second account → install widget snippet on a local test HTML file (not just /demo) → chat both ways with typing/read/presence → send email from Gmail, see it, reply, check Gmail threading → KB article → public KB + search → widget suggestions → long conversation summary → custom domain simulate → filters/assign/snooze/resolve. Fix everything that stumbles.
- [ ] **Step 5: Commit + push** — verify GitHub history shows progression; send links to Aditya.

---

### Task 13 (stretch): Canned responses

**Files:** `server/src/routes/canned.ts`, `web/src/pages/Settings/Canned.tsx`, composer picker in `web/src/pages/Inbox/Thread.tsx`.

- [ ] CRUD API (`GET/POST/PATCH/DELETE /api/canned`), settings page, composer: typing `/` at position 0 opens filterable dropdown of titles; select inserts body. Commit `feat: canned responses`.

### Task 14 (stretch): AI reply drafts

**Files:** `server/src/ai/draft.ts`, `server/src/routes/summaries.ts` (add `POST /api/conversations/:id/draft`), Thread UI button.

- [ ] `buildDraftPrompt({summary, lastMessages, kbArticles})` (reuse Task 10 patterns; KB context = top-3 FTS hits for the last customer message, each capped 800 chars; system prompt: "draft a reply in a friendly support tone; only claim facts present in context; sign off as {agentName}"). UI: "✨ Draft reply" button fills composer (editable, labeled AI-generated). Commit `feat: ai reply drafts grounded in KB`.

---

## Self-Review Results

- **Spec coverage:** auth/teams (T3-4), widget (T7), email (T8), inbox (T5-6), KB (T9), AI (T10), custom domains (T11), submission items (T12), stretch (T13-14), provisioning/DNS (T0-1). Rate limiting: auth (T3), widget (T7). Read receipts: protocol T6 + UI T6/T7. Snooze sweep: T5. ✓
- **Placeholder scan:** loader/frame UI and dashboard pages are specified by behavior + exact endpoints rather than full JSX (deliberate under deadline; interfaces are exact). No TBDs. ✓
- **Type consistency:** event names/payloads centralized in T6 protocol; repo signatures defined once in T5 and consumed by T6/T7/T8/T10; `newMessageId` defined T8 only used T8. ✓
