# Design: Intercom-style Customer Communication Platform

**Date:** 2026-07-16
**Context:** SuperProfile Staff Engineer hiring assignment. 7 non-negotiable features, must be live and deployed, under 24 hours remaining.
**Author decisions:** Node/Express + React (TS), Azure App Service backend, Vercel frontend, Azure Postgres, SendGrid email, OpenAI LLM, personal domain `anujchhikara.com`.

## 1. Goals and non-goals

### Must ship (the 7 core features)
1. Auth + team management (email/password + Google OAuth, invites, Admin/Agent roles, assignment)
2. Embeddable chat widget (single script tag, real-time, typing/presence/read receipts, history persistence)
3. Email channel (inbound parse → conversations, reply from dashboard → real email, threading via Message-ID/In-Reply-To)
4. Unified inbox (chat + email, filter by channel/assignee/status, assign/snooze/resolve)
5. Knowledge base (rich text editor, categories, public page with search, auto-suggest in widget)
6. AI issue summarization (LLM summary on open, updates as conversation grows)
7. Custom domains for KB (tenant connects `help.theirdomain.com`, SSL provisioning; verification stub allowed but ours is mostly real)

### Stretch (strictly after core is deployed, in this order)
1. Canned responses (CRUD + `/` picker in reply box)
2. AI auto-reply drafts (reuse summary pipeline + KB context)
3. Contact timeline (light version)

### Explicit non-goals (documented as trade-offs in README)
- Queue-based background processing (in-process async via fire-and-forget with error logging; single instance makes this acceptable at demo scale — README documents the Azure Service Bus / BullMQ path)
- File attachments in chat or email
- Rich email HTML rendering (sanitized text-first rendering)
- Analytics dashboard, SLA tracking
- Webhooks/REST public API (README section describing the design only)
- Horizontal scaling (single App Service instance; README documents Socket.io Redis adapter path)

## 2. Architecture overview

```
                    anujchhikara.com (DNS on Cloudflare, records only)
                                        |
   +----------------+     +---------------------------+     +----------------------+
   | app.anuj...com |     | api.anuj...com            |     | parse.anuj...com     |
   | Vercel         |     | kb.anuj...com             |     | MX -> SendGrid       |
   | React SPA      |---->| + tenant custom domains   |<----| Inbound Parse POSTs  |
   | (Vite build)   | XHR | Azure App Service (Linux, |     | to /webhooks/...     |
   +----------------+ +WS | Node 20, B1, always-on)   |     +----------------------+
                          |  - Express REST /api/*    |
                          |  - Socket.io (same proc)  |----> SendGrid API (outbound
                          |  - /widget.js + iframe UI |      email w/ threading headers)
                          |  - Public KB pages        |----> OpenAI API (gpt-4o-mini)
                          |  - SendGrid webhook       |----> Azure ARM API (managed
                          +---------------------------+      identity: custom domains)
                                        |
                          Azure Database for PostgreSQL
                          Flexible Server (Drizzle ORM)
```

- **Backend**: one Express (TypeScript) process on Azure App Service. REST API, Socket.io, widget loader + iframe page, public KB pages (server-rendered), SendGrid inbound webhook, custom-domain provisioning.
- **Frontend**: React + Vite SPA on Vercel at `app.anujchhikara.com`. Same registrable domain as the API, so the session cookie (`Domain=.anujchhikara.com`, `SameSite=Lax`) is same-site; CORS on the API allows the app origin with credentials.
- **Database**: Azure Database for PostgreSQL Flexible Server (free-trial B1ms), Drizzle ORM + migrations.
- **Real-time**: Socket.io in-process. Single instance = one event loop = per-conversation message ordering guarantee. Documented scale path: Redis adapter + sticky sessions.
- **Email**: SendGrid Inbound Parse (in) + SendGrid API (out).
- **AI**: OpenAI `gpt-4o-mini`.
- **Deploys**: GitHub Actions → `az webapp deploy` for backend; Vercel Git integration for frontend. Hello-world live in hour 1.

### DNS records on anujchhikara.com
| Record | Type | Target | Purpose |
|---|---|---|---|
| `app` | CNAME | `cname.vercel-dns.com` | Dashboard |
| `api` | CNAME | `{app}.azurewebsites.net` | API/WS/widget (DNS-only in CF) |
| `asuid.api` | TXT | App Service verification ID | Domain validation |
| `kb` | CNAME | `{app}.azurewebsites.net` | Public KB (DNS-only in CF) |
| `asuid.kb` | TXT | App Service verification ID | Domain validation |
| `parse` | MX 10 | `mx.sendgrid.net` | Inbound email |
| SendGrid auth | 3× CNAME | per SendGrid | DKIM/SPF |

Public KB default URL is path-based: `kb.anujchhikara.com/{workspace-slug}` (avoids wildcard-cert complexity). Tenant custom domains map hostname → workspace.

## 3. Data model (Postgres, Drizzle)

All tenant data carries `workspace_id`. Every query is scoped server-side from the session; client-supplied workspace IDs are never trusted.

- `users` — id, email (unique), password_hash (nullable), google_id (nullable, unique), name, created_at
- `workspaces` — id, name, slug (unique), created_at
- `memberships` — user_id, workspace_id, role (`admin`|`agent`)
- `invites` — id, workspace_id, email, role, token_hash, expires_at, accepted_at
- `sessions` — id, token_hash, user_id, expires_at, created_at
- `contacts` — id, workspace_id, email (nullable), name, visitor_token (nullable, for widget identity), last_seen_at
- `conversations` — id, workspace_id, contact_id, channel (`chat`|`email`), status (`open`|`snoozed`|`resolved`), assignee_id (nullable), subject (nullable), snoozed_until (nullable), last_message_at
- `messages` — id, conversation_id, workspace_id, sender_type (`contact`|`agent`|`system`), sender_id, body (text), email_message_id (nullable), in_reply_to (nullable), created_at, read_at (nullable)
- `kb_categories` — id, workspace_id, name, slug, position
- `kb_articles` — id, workspace_id, category_id, title, slug, body_html (sanitized), status (`draft`|`published`), search_vector (tsvector, GIN index), updated_at
- `summaries` — conversation_id (PK), body, message_count, updated_at
- `custom_domains` — id, workspace_id, hostname (unique), status (`pending_dns`|`verifying`|`active`|`failed`), azure_binding_done, verified_at
- `canned_responses` — id, workspace_id, title, body, created_by *(stretch)*

Widget identity: random `visitor_token` in widget-iframe `localStorage` maps to a `contacts` row → chat history persists across visits. If the visitor provides an email (pre-chat prompt, optional), the contact is merged/matched with email-channel contacts by email.

## 4. Auth and security

- **Login methods** (both end in the same session cookie — no JWTs):
  1. **Email + password** (assignment explicitly requires it): scrypt via Node `crypto.scrypt` with per-user salt.
  2. **Google OAuth** ("Continue with Google"): standard authorization-code flow with `state` cookie for CSRF; on callback, verify the ID token, find-or-create the user by verified email (`google_id` column on `users`, `password_hash` nullable), set the session cookie, redirect to the app. Client ID/secret provided via env vars.
- **Sessions**: opaque 256-bit random tokens, stored **hashed** in `sessions`, delivered as `HttpOnly; Secure; SameSite=Lax; Domain=.anujchhikara.com` cookie, 7-day expiry, sliding renewal.
- **CSRF**: SameSite=Lax + Origin/Referer check middleware on all mutating routes (JSON API, no form posts).
- **CORS**: API allows exactly `https://app.anujchhikara.com` with credentials; widget/public endpoints are open but unauthenticated-by-design.
- **RBAC**: middleware `requireRole('admin')` for team management, custom domains, KB category admin; agents can handle conversations and author articles.
- **Tenant isolation**: `workspace_id` always derived from membership of the session user; repository helpers take `workspaceId` as a required first argument.
- **XSS**: chat messages stored and rendered as plain text (escaped). KB article HTML sanitized server-side with `sanitize-html` allowlist. Email bodies: text part preferred; HTML part sanitized aggressively before display.
- **Rate limiting**: in-memory token buckets (valid on a single instance) — tight on `/api/auth/*`, looser on widget message endpoints keyed by visitor token + IP.
- **Headers**: helmet on dashboard/API responses; widget iframe page gets a permissive-enough frame policy to be embeddable, everything else `X-Frame-Options: DENY`.
- **Webhook auth**: SendGrid inbound URL contains a long random secret path segment; requests without it are 404.
- **Secrets**: App Service configuration (env vars); never in the repo.

## 5. Real-time design (Socket.io)

**Namespaces/rooms:**
- Agents (authenticated via session cookie during WS handshake): join `ws:{workspaceId}` and dynamically `conv:{conversationId}` rooms.
- Visitors (widget, authenticated by visitor token + workspace public key): join only their `conv:{conversationId}`.

**Events (server → client):** `message:new`, `typing`, `presence` (agent online/offline for widget; visitor online for dashboard), `read` (receipts), `conversation:updated` (status/assignee changes → live inbox refresh), `summary:updated`.
**Events (client → server):** `message:send`, `typing`, `read`.

**Flow:** client emits → server validates (zod) + authorizes → insert into Postgres → broadcast to rooms → ack to sender with server id + timestamp. DB write happens before broadcast: no phantom messages.

**Ordering:** single Node process serializes handling; messages get DB sequence ids; clients order by id.

**Reconnection:** Socket.io built-in exponential backoff. On reconnect, client requests `GET /api/conversations/:id/messages?after={lastSeenId}` to backfill, then resumes live events. Widget shows offline banner when disconnected.

**Presence:** agent considered online if ≥1 agent socket in `ws:{workspaceId}`; widget header reflects it. Visitor presence via socket connect/disconnect + `last_seen_at`.

## 6. Chat widget

**Embed:** `<script src="https://api.anujchhikara.com/widget.js" data-workspace="{publicKey}" async></script>`

- `widget.js` is a small vanilla-TS loader (no framework): injects a launcher button + an `iframe` pointing at `https://api.anujchhikara.com/widget/frame?ws={publicKey}`.
- The iframe hosts the actual chat UI (Preact + Vite — React-like DX at ~4KB, keeps the widget bundle small). Iframe isolation prevents host-page CSS/JS conflicts and keeps our storage on our origin.
- Loader ↔ iframe via `postMessage` (open/close/unread badge only).
- Visitor token generated on first load, kept in iframe `localStorage` (partitioned per top-level site by modern browsers — history persists per-site, which is correct behavior and documented).
- Features: message list with history, composer, typing indicators both ways, agent online/offline dot, read receipts (sent/seen), optional email capture, KB auto-suggest panel (see §8).
- Demo page: a standalone static page (`/demo` on the API host, styled like a fake product site) with the snippet installed — this is the "Live Chat Bubble Demo Page" submission item.

## 7. Email channel (SendGrid)

**Inbound:** Customer emails `{workspace-slug}@parse.anujchhikara.com` → SendGrid Inbound Parse POSTs multipart form to `/webhooks/sendgrid-inbound/{secret}` →
1. Parse fields (`from`, `to`, `subject`, `text`, `html`, `headers`).
2. Resolve workspace from the recipient local part.
3. Thread resolution: extract `In-Reply-To`/`References`; match against `messages.email_message_id` → existing conversation, else create new (channel `email`, subject preserved).
4. Find-or-create contact by sender email.
5. Insert message, broadcast over Socket.io, bump `last_message_at`, reopen conversation if it was resolved.

**Outbound:** Agent reply → SendGrid send API:
- `From: "{Workspace} Support" <{slug}@parse.anujchhikara.com>` (SendGrid-authenticated domain)
- Generated `Message-ID` (stored on our message row), `In-Reply-To` = last inbound message-id, `References` = accumulated chain, `Subject: Re: {subject}`.
- Failures surface in the UI on the message (retry button); message stays stored locally regardless.

**Local testing:** `POST /api/dev/simulate-inbound` (dev-only, disabled in prod unless `DEMO_MODE`) accepts the same shape as the SendGrid webhook.

## 8. Knowledge base

- **Authoring:** dashboard editor using TipTap (rich text: headings, bold/italic, lists, links, code). Output HTML sanitized server-side. Draft/published states, categories with ordering.
- **Public site:** server-rendered via typed template-literal helpers (no template engine dependency) at `kb.anujchhikara.com/{workspace-slug}` and on tenant custom domains (hostname → workspace). Category list → article pages. Search box backed by Postgres FTS (`websearch_to_tsquery` over title+body, GIN index).
- **Widget auto-suggest:** as the visitor types (debounced ~600ms, ≥4 chars), query the same FTS endpoint; show top 3 published articles above the composer, opening in a new tab. No LLM involved — fast and free.

## 9. AI summarization (OpenAI gpt-4o-mini)

- **Trigger:** agent opens a conversation with ≥6 messages. If no summary exists or `messages.count > summaries.message_count`, regenerate asynchronously; UI shows the cached summary immediately (with "updating…" then swap via `summary:updated` event).
- **Context windowing:** prompt = previous summary (if any) + messages since it was generated (capped at last ~30 messages / ~6k tokens). Rolling summarization keeps cost O(new messages), not O(conversation).
- **Prompt design:** system prompt demands exactly three labeled sections — *What the customer wants*, *What's been tried*, *Current status* — ≤120 words total, no speculation. Deterministic-ish (`temperature: 0.2`).
- **Cost:** gpt-4o-mini at demo volume = cents. Per-conversation regeneration throttle (≥60s between runs).
- **Failure handling:** 10s timeout; on error/timeout serve cached summary flagged "may be out of date", log, expose manual "regenerate" button. AI failures never block the conversation view.
- **Stretch — reply drafts:** same context + top-3 FTS KB articles for the latest customer message → "suggested reply" the agent can insert/edit. Clearly labeled AI-generated.

## 10. Custom domains (feature 07) — real implementation

**Tenant flow:** workspace admin enters `help.theirdomain.com` →
1. We display required DNS records: `CNAME help → {app}.azurewebsites.net` and `TXT asuid.help → {app's custom domain verification ID}`.
2. "Verify" triggers server-side DNS-over-HTTPS lookups; when records resolve, we call Azure ARM (App Service **system-assigned managed identity** with Website Contributor on the app):
   a. create hostname binding, b. create free **App Service managed certificate**, c. bind cert (SNI).
3. Status transitions `pending_dns → verifying → active` shown live in the UI; on `active`, the KB serves on the tenant hostname (Express `Host`-header → `custom_domains` → workspace).

**Demo mode:** `DEMO_MODE=true` exposes an admin-only "simulate verification" button that skips the ARM calls and marks the domain active (host-header routing still demonstrably works via a header-override test route). README explains the full production flow plus the at-scale alternative (Cloudflare for SaaS / Front Door).

## 11. Unified inbox UX (dashboard)

Three-pane layout: conversation list (filters: channel, status, assignee incl. "mine"/"unassigned"; sorted by `last_message_at`) → message thread (chat-style bubbles; email messages show subject/from meta) → context sidebar (contact info, AI summary card, assignment dropdown, status actions: resolve / snooze with duration picker / reopen). Snoozed conversations auto-reopen via a 60s interval sweep (`snoozed_until < now`). All list updates arrive live over Socket.io.

## 12. Repo layout and delivery

```
/server          Express + Socket.io + Drizzle (deploys to Azure)
/web             React + Vite dashboard (deploys to Vercel)
/widget          loader + iframe app (built into /server/public at build time)
/docs            this spec, README assets
```

- pnpm workspaces; each package owns its zod schemas (no shared package — duplication is cheaper than workspace-linking overhead at this timescale).
- GitHub Actions: build server (+widget) → `az webapp deploy`. Vercel auto-deploys `/web` on push.
- Commit style: small, frequent, feature-scoped (assignment requires visible progression).
- README: architecture diagram, tech choices with reasoning, built vs skipped, trade-offs, setup instructions, known limitations, submission links.

## 13. Milestones (~20h remaining, deploy-first)

| # | Milestone | Est |
|---|---|---|
| 0 | Azure + SendGrid + Vercel accounts, DNS records, scaffold, hello-world live on real domains | 1.5h |
| 1 | Auth (signup/login/sessions + Google OAuth), workspace create, invites, roles | 2.5h |
| 2 | Conversations/messages/contacts model + REST + inbox UI with filters/assign/snooze/resolve | 3h |
| 3 | Socket.io layer + agent-side live chat in dashboard | 2.5h |
| 4 | Widget (loader, iframe UI, history, typing/presence/read) + demo page | 3h |
| 5 | Email channel (inbound webhook, outbound replies, threading) | 2.5h |
| 6 | KB (editor, categories, public site, FTS search) + widget auto-suggest | 2h |
| 7 | AI summaries | 1h |
| 8 | Custom domains (ARM integration + demo mode) | 1.5h |
| 9 | Seed data, polish pass, README, final deploy checks, submission | 1.5h |
| — | Buffer → canned responses → AI drafts → contact timeline | rest |

**Risk register:** SendGrid signup/verification delay (mitigate: do it in milestone 0; fallback = simulate-inbound endpoint + honest README note), Azure free-trial quota surprises (mitigate: provision everything in milestone 0), Socket.io behind App Service (mitigate: enable WebSockets flag day 1, test immediately).
