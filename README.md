# SuperProfile Support — a multi-tenant Intercom-style support platform

Live chat widget + email channel + unified realtime inbox + knowledge base +
AI conversation summaries + tenant custom domains, in one deployable stack.

## Live URLs

| What | URL |
|---|---|
| Dashboard (agent app) | `https://app.anujchhikara.com` |
| API + realtime | `https://api.anujchhikara.com` |
| Demo product page with the widget installed | `https://api.anujchhikara.com/demo` |
| Public knowledge base | `https://kb.anujchhikara.com/acme` |
| Inbound support email | `acme@parse.anujchhikara.com` |

> Deployment targets are wired end-to-end (GitHub Actions → Azure App Service for the API,
> Vercel for the SPA). The cloud provisioning in `docs/superpowers/plans` (Azure, SendGrid
> domain auth, Google OAuth client, DNS) is credential-gated; everything below runs locally
> against Postgres with a one-command setup.

## Architecture

```
                 ┌────────────── Vercel ──────────────┐
   Agents ─────► │  React + Vite SPA (app.…)           │
                 └───────────────┬────────────────────┘
                                 │  cookie session (sid) + Socket.io
                 ┌───────────────▼──────── Azure App Service ────────────────┐
   Visitors ───► │  Express + Socket.io (api.…)                              │
   (widget)      │   • REST + one shared write path (repos/conversations)    │
   Email ──────► │   • Socket.io realtime (rooms: ws:{id}, conv:{id})        │
   (SendGrid)    │   • in-process EventEmitter → socket fan-out              │
                 │   • SSR KB site (kb.… + tenant custom domains)            │
                 │   • serves /widget.js + /widget/frame + /demo             │
                 └───────────────┬───────────────┬───────────────┬──────────┘
                          Postgres (Drizzle)   OpenAI          Azure ARM
                                              (summaries)   (custom-domain certs)
```

Single Express process holds REST, Socket.io, the SSR KB site, and the widget assets. All
tenant state lives in Postgres; every query is scoped by a `workspaceId` derived server-side
from the session/'key, never from client input.

## Tech choices & why

- **Express 4 + Socket.io in one process** — simplest thing that gives realtime + REST + SSR
  without extra infra; a single shared `createMessage` write path keeps REST and sockets
  consistent.
- **Drizzle ORM + pg** — typed schema, plain SQL when it matters (FTS `ts_headline`, DISTINCT ON).
- **Postgres full-text search** — `tsvector` generated column + GIN index; no separate search service.
- **React + Vite + TanStack Query** (dashboard); **Preact** (widget frame) — tiny embeddable bundle.
- **No-dependency widget loader** — a ~2 kB IIFE that injects a launcher + iframe.
- **zod** at every trust boundary; **sanitize-html** allowlist for KB, escaped text everywhere else.

## What's built vs. skipped

| Area | Status |
|---|---|
| Google OAuth + cookie sessions | ✅ |
| Workspaces, invites, roles (admin/agent), last-admin guard | ✅ |
| Conversations, unified inbox (filters, assign, snooze, resolve, read receipts) | ✅ |
| Socket.io realtime (message/typing/presence/read/summary, reconnect backfill) | ✅ |
| Embeddable chat widget + demo page | ✅ |
| Email channel (SendGrid inbound + threaded outbound) | ✅ |
| Knowledge base (editor, categories, SSR public site, FTS search, widget suggest) | ✅ |
| AI rolling summaries (OpenAI, graceful degradation) | ✅ |
| Tenant custom domains (Azure managed certs + demo simulate) | ✅ |
| Password auth | ❌ by design — **Google OAuth only** (no password columns/flows). Trade-off: no email/password signups, but zero credential storage and a faster, safer path for the deadline. |
| Rich-text KB editor library (TipTap) | Swapped for a no-dep `contentEditable` editor (server sanitizes on save). |
| Canned responses / AI reply drafts | Stretch (Tasks 13–14), not built. |

## Real-time design

- Rooms: agents join `ws:{workspaceId}` (+ `conv:{id}` on open); visitors join `conv:{id}`.
- REST and sockets share **one** write path (`createMessage`); writes emit through an in-process
  `EventEmitter`, which a subscriber fans out to the right rooms. This means an agent replying
  over REST and a visitor sending over socket produce identical, consistent broadcasts.
- Ordering: messages carry a monotonic `seq` (Postgres identity). Clients dedupe by message id.
- Reconnect: on socket reconnect the client invalidates its queries and refetches
  (`?after=lastSeq` available), so no gaps or duplicates.
- Presence: agent socket counts per workspace drive a `presence` event to visitors; visitor
  `join`/disconnect drives `visitor:presence` to agents.

## Email threading design

- Inbound (SendGrid Inbound Parse → `POST /webhooks/sendgrid-inbound/:secret`): resolve the
  workspace from the recipient slug (`acme@parse.…` → `acme`), find/create the contact by
  from-address, then `resolveThread` matches `In-Reply-To`/`References` against stored
  `emailMessageId`s to attach the message to an existing conversation (reopening it if
  resolved) — otherwise a new email conversation is created.
- Outbound (agent reply): we set a stable `Message-ID` (`<msg-{rowId}@parse.…>`) plus
  `In-Reply-To`/`References` from the latest inbound message, so replies thread correctly in
  the customer's mail client. Delivery failures surface as a system message in the thread.

## AI design

- `buildSummaryPrompt` (pure, unit-tested) produces a strict three-section summary
  ("What the customer wants / What's been tried / Current status", ≤120 words, "never invent"),
  folding in the previous summary for rolling updates and capping context at the last 30 messages.
- `gpt-4o-mini`, `temperature 0.2`, `max_tokens 220`, 10s timeout, one retry on 429/5xx.
- Cost/throughput control: only summarize at ≥6 messages, when there's new content, and at most
  once/60s per conversation (in-memory throttle); refreshes push live via `summary:updated`.
- Graceful degradation: any AI failure is swallowed (fire-and-forget on open; 503 on explicit
  regenerate) — the conversation stays fully usable, the card keeps its last content.

## Custom domains

- Add a hostname → show the exact `CNAME` + `asuid` `TXT` records → **Verify** runs a
  DNS-over-HTTPS check → on success we provision an Azure **managed certificate** via ARM (MSI
  token → hostname binding → cert issuance → SNI bind) and flip the domain to `active`.
- `DEMO_MODE` exposes **Simulate verification** to jump straight to `active` without real
  DNS/cert, so the flow is demoable without owning a spare domain. Active domains serve that
  workspace's KB at their root.

## Security notes

- All tenant queries are scoped by a server-derived `workspaceId`; visitor endpoints are
  additionally scoped to the visitor's own contact (cross-visitor access returns 404).
- Session cookie: `HttpOnly; Secure; SameSite=Lax`, sha-256 **hashed** in the DB (raw token
  never stored). CSRF: mutating `/api` requests are origin-checked; the widget API is exempted
  (it's cross-origin by design and authenticated by workspace key + visitor token, not cookies).
- Output safety: chat/email bodies render as escaped text (React/Preact defaults, no
  `dangerouslySetInnerHTML`); KB HTML is sanitized with a `sanitize-html` allowlist on save; the
  FTS `ts_headline` snippet is escaped then re-marked so article text can't inject markup.
- `helmet` security headers; CORP/COEP/CSP relaxed only where the widget must embed/load
  cross-origin, and `/widget/frame` explicitly allows `frame-ancestors *`.
- The widget `identify` endpoint deliberately does **not** adopt a pre-existing contact by
  unverified email (that would allow identity takeover) — real identity linking would use a
  verification step (emailed code / HMAC).
- The SendGrid inbound webhook secret lives in the URL path because Inbound Parse cannot send
  custom headers; it's protected by HTTPS and a constant-time compare, and the path/secret is
  never logged.

## Local setup

```bash
# prerequisites: Node 20, pnpm, Postgres 16
createdb support   # or: psql -c 'create database support'
pnpm install
DATABASE_URL=postgres://postgres:postgres@localhost:5432/support pnpm --filter server exec drizzle-kit migrate

# run
pnpm --filter server dev            # API + sockets on :3000
pnpm --filter web dev               # dashboard on :5173
pnpm --filter widget build          # builds loader + frame into server/public

# seed demo data (sign in first, then):
curl -X POST http://localhost:3000/api/dev/seed -H 'Origin: http://localhost:5173' -b "sid=<your session>"
```

Env vars (all have dev defaults in `server/src/env.ts`): `DATABASE_URL`, `APP_ORIGIN`,
`API_ORIGIN`, `KB_HOST`, `PARSE_DOMAIN`, `COOKIE_DOMAIN`, `GOOGLE_CLIENT_ID/SECRET`,
`SENDGRID_API_KEY`, `INBOUND_WEBHOOK_SECRET`, `OPENAI_API_KEY`, `DEMO_MODE`, and the
`AZURE_*` set for custom-domain provisioning.

Tests: `DATABASE_URL=… pnpm --filter server test` (needs a local Postgres; unit tests for
sessions, tenant scoping, email threading, summary prompt, and the domain state machine).

## Known limitations & at-scale plan

- **Single process, in-memory state** (socket presence, AI throttle, rate limiters) — fine for
  one node; horizontal scale needs the **Socket.io Redis adapter** and a shared store for those maps.
- **Email send/AI are inline fire-and-forget** — at volume, move to a **queue** (BullMQ/SQS)
  with retries and a dead-letter queue.
- **Reads hit the primary** — add **read replicas** for the KB public site + inbox lists.
- **FTS is Postgres** — good to a point; a dedicated search service (OpenSearch) if the KB grows large.
- Custom-domain cert issuance is synchronous polling; production would move it to a background job.
