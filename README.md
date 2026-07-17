# SuperProfile Support

A production-ready, multi-tenant customer communication platform — live chat, email channel, unified realtime inbox, knowledge base, AI summaries + reply drafts, canned responses, and custom domains.

---

## Live URLs

| What | URL |
|---|---|
| **Agent Dashboard** | https://app.anujchhikara.com |
| **API + WebSocket server** | https://api.anujchhikara.com |
| **Demo page (widget installed)** | https://api.anujchhikara.com/demo |
| **Public Knowledge Base** | https://kb.anujchhikara.com/acme |
| **API health check** | https://api.anujchhikara.com/healthz |
| **Inbound support email** | `rapid_commerce@parse.anujchhikara.com` |

---

## Quick Demo Checklist

Everything you need to do before/during a live presentation.

### Step 1 — Seed demo data (30 seconds)
1. Open **https://app.anujchhikara.com** and sign in with Google
2. Open DevTools console (F12 → Console tab) and paste:
```js
fetch('https://api.anujchhikara.com/api/dev/seed', {
  method: 'POST', credentials: 'include'
}).then(r => r.json()).then(console.log)
```
3. You should see `{ ok: true, workspaceId: "demo-acme-ws", ... }` in the console
4. Switch to the **Rapid Commerce** workspace in the sidebar dropdown

> Re-seeding is safe and idempotent — run the same command again anytime to reset demo data to a clean state.

### Step 2 — Open these tabs before presenting
| Tab | URL | Purpose |
|---|---|---|
| 1 | https://app.anujchhikara.com/inbox | Agent inbox |
| 2 | https://api.anujchhikara.com/demo | Visitor widget |
| 3 | https://kb.anujchhikara.com/rapid_commerce | Public KB site |
| 4 | Gmail (any account) | Send a test email |

### Step 3 — Demo flow (5 minutes)

**Live chat (Tab 1 + 2)**
- Tab 2 → click chat bubble → type a message → Tab 1 shows it instantly
- Reply from Tab 1 → appears in Tab 2 instantly
- Type in Tab 1 compose → Tab 2 shows "typing…" indicator

**Email channel (Gmail → Tab 1)**
- Send email to `rapid_commerce@parse.anujchhikara.com` from Gmail
- Tab 1 → new Email conversation appears in seconds
- Reply from inbox → customer gets reply **from** `rapid_commerce@parse.anujchhikara.com`
- Reply to that email → threads back into the same conversation

**AI features (Tab 1, any conversation)**
- Click ⚡ **Draft** → AI reply grounded in KB articles
- Right panel → AI rolling summary (needs 6+ messages)
- Type `/` in compose → canned response picker

**Knowledge Base (Tab 3)**
- KB tab in sidebar → create article → publish → Tab 3 refreshes live
- Widget: type question related to article → suggestions appear below compose

**Inbox filters**
- All / Chat / Email tabs
- Open / Snoozed / Resolved status
- Assign conversation to team member → filter by Mine

**Custom domains**
- Settings → Domains → shows DNS verification + Azure cert flow
- Click **Simulate** to demo the full flow without real DNS changes

### Simulate inbound email (no real Gmail needed)
```js
fetch('https://api.anujchhikara.com/api/dev/simulate-inbound', {
  method: 'POST', credentials: 'include',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    to: 'rapid_commerce@parse.anujchhikara.com',
    from: 'customer@gmail.com',
    subject: 'Billing question',
    text: 'Hi, I was charged twice this month. Can you help?'
  })
}).then(r => r.json()).then(console.log)
```

---

## Evaluator Testing Guide

### 1 — Sign up & team management
1. Go to `https://app.anujchhikara.com` → **Continue with Google**
2. You'll land on Onboarding — create a workspace (e.g. "Rapid Commerce")
3. Go to **Settings → Team** → invite a second Google account via email
4. The invitee receives a real email from `support@anujchhikara.com` with an accept link
5. Accept the invite in the second account → both accounts now share the workspace
6. Change the second account's role between **Admin** and **Agent**

### 2 — Live chat widget
1. Open `https://api.anujchhikara.com/demo` in one browser tab — this is a fake product page with the widget installed
2. Keep `https://app.anujchhikara.com/inbox` open in another tab (switch workspace to **Rapid Commerce**)
3. Click the **indigo chat bubble** (bottom-right of the demo page) → type a message → send
4. The message appears in the agent inbox **in real-time** (no refresh)
5. Reply from the agent dashboard — the reply appears in the widget instantly
6. Type in the agent compose box → visitor sees **"typing…"** indicator in the widget
7. Close and reopen the widget → **chat history persists** (stored in Postgres, keyed by visitor token in localStorage)
8. The widget header shows **"We're online"** (green dot) when an agent is logged in, **"We'll reply by email"** when not

### 3 — Email channel
Send a real email to **`rapid_commerce@parse.anujchhikara.com`** from any Gmail account.

- It appears in the Rapid Commerce inbox within seconds as an **Email** conversation
- Reply from the agent dashboard → the customer receives the reply **from** `acme_corp@parse.anujchhikara.com` (the workspace address, not a platform address)
- Reply to that email again → it threads back into the **same conversation** (Message-ID / In-Reply-To / References headers are preserved)

To seed demo email conversations without sending real email, open browser DevTools on the dashboard and run:
```js
fetch('https://api.anujchhikara.com/api/dev/simulate-inbound', {
  method: 'POST', credentials: 'include',
  headers: {'Content-Type':'application/json'},
  body: JSON.stringify({
    to: 'rapid_commerce@parse.anujchhikara.com',
    from: 'tester@gmail.com',
    subject: 'Billing question',
    text: 'Hi, I was charged twice this month. Can you help?'
  })
}).then(r=>r.json()).then(console.log)
```

### 4 — Unified inbox
- **Channel tabs**: All / Chat / Email
- **Status filter**: Open / Snoozed / Resolved
- **Assignee filter**: All Agents / Mine / Unassigned
- Click a conversation → assign it to any team member via the **Assignee** dropdown (right panel)
- **Snooze**: choose 1 hour or Tomorrow 9am — conversation disappears until then
- **Resolve**: marks it resolved; reopen it from the Resolved filter

### 5 — Knowledge Base
1. Go to **Knowledge Base** in the sidebar
2. Create a category and write an article → **Publish**
3. Visit the public KB: `https://kb.anujchhikara.com/acme` — the article is live and searchable
4. In the chat widget, type a question related to an article title → **suggested articles appear** below the compose box after 600ms

### 6 — AI features
- **Conversation summary**: open any conversation with 6+ messages → the right panel shows a rolling AI summary ("What the customer wants / What's been tried / Current status")
- **AI reply draft**: click the ⚡ **Draft** button in the compose area → GPT-4o-mini generates a reply grounded **only** in KB articles. If no relevant KB article exists, it responds with a polite "I'll look into this" — it never answers from general knowledge
- **Canned responses**: type `/` in the compose box → a picker appears with saved responses; select one to insert it

### 7 — Custom domains
1. Go to **Settings → Domains** → add a domain like `help.yourdomain.com`
2. The UI shows the exact **CNAME** and **TXT** records to add to your DNS
3. Click **Verify** — real DNS-over-HTTPS check runs
4. On success, an **Azure managed certificate** is provisioned via ARM (MSI token)
5. **Demo mode**: click **Simulate** to skip real DNS and jump straight to `active` state

### Seed demo data (one command)
Open DevTools on the dashboard (`https://app.anujchhikara.com`) and run:
```js
fetch('https://api.anujchhikara.com/api/dev/seed', {method:'POST',credentials:'include'})
  .then(r=>r.json()).then(console.log)
```
This creates the **Rapid Commerce** workspace with demo conversations, KB articles, and seeded team members. Then switch to the Rapid Commerce workspace in the sidebar.

---

## Architecture

```
                 ┌────────────── Vercel ──────────────┐
   Agents ──────►│  React + Vite SPA (app.…)           │
                 └───────────────┬────────────────────┘
                                 │  cookie session + Socket.io
                 ┌───────────────▼──────── Azure App Service ─────────────────┐
   Visitors ────►│  Express + Socket.io (api.…)                                │
   (widget)      │  ├─ REST API  (/api/*)                                      │
   Email ───────►│  ├─ Socket.io realtime (rooms: ws:{id}, conv:{id})          │
   (SendGrid)    │  ├─ SSR KB site  (kb.… + tenant custom domains)             │
                 │  └─ Static widget assets (/widget.js, /widget/frame, /demo) │
                 └──────┬──────────────┬──────────────┬───────────────────────┘
                   Postgres        OpenAI           Azure ARM
                   (Drizzle)    (summaries +      (custom-domain
                   + FTS GIN     drafts, gpt-4o   managed certs
                    indexes)       -mini)          via MSI)
```

Single Express process holds REST, Socket.io, SSR KB, and widget assets. All tenant state lives in Postgres; every query is scoped by `workspaceId` derived server-side from the session/key.

---

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| API | Express 4 + Socket.io | Realtime + REST + SSR in one process; no extra infra |
| ORM | Drizzle + pg | Typed schema, plain SQL when it matters (FTS, DISTINCT ON) |
| Search | Postgres FTS (`tsvector` + GIN) | No separate search service for this scale |
| Dashboard | React + Vite + TanStack Query | Fast SPA with stale-while-revalidate caching |
| Widget | Preact (frame) + vanilla IIFE (loader) | ~2 kB loader, no deps |
| Auth | Google OAuth + HttpOnly cookie sessions | No credential storage; sha-256 hashed session token in DB |
| Email | SendGrid (inbound parse + outbound) | Threading via Message-ID / In-Reply-To / References |
| AI | OpenAI gpt-4o-mini | Cost-efficient; 10s timeout, retry on 429/5xx, graceful degradation |
| Infra | Azure App Service + Vercel | App Service for custom domain cert provisioning via ARM/MSI |
| Validation | zod + sanitize-html | zod at every trust boundary; HTML allowlist for KB content |

---

## Features built

| Feature | Status | Notes |
|---|---|---|
| Google OAuth + cookie sessions | ✅ | HttpOnly, Secure, SameSite=Lax; sha-256 hashed token |
| Workspaces, invites, roles | ✅ | Admin/Agent RBAC; email invites via SendGrid; pending invite list; last-admin guard |
| Agent assignment to conversations | ✅ | Assignee dropdown in inbox; filter by Mine / Unassigned |
| Unified inbox (filter, assign, snooze, resolve) | ✅ | Read receipts, real-time updates |
| Embeddable chat widget | ✅ | Single `<script>` tag; iframe sandbox; unread badge |
| Typing indicators | ✅ | Both directions (visitor ↔ agent) |
| Online/offline presence | ✅ | Green dot in widget header; socket count-based |
| Read receipts | ✅ | ✓✓ on agent messages when visitor reads |
| Chat history persistence | ✅ | Visitor token in localStorage; full history on return |
| Email inbound (SendGrid Inbound Parse) | ✅ | Workspace resolved from recipient slug |
| Email outbound with threading | ✅ | Message-ID, In-Reply-To, References; reply-to parse address |
| Knowledge base (editor + categories) | ✅ | contentEditable editor; server-side sanitize-html |
| Public KB site + search | ✅ | SSR; FTS with ts_headline snippets |
| KB article suggestions in widget | ✅ | Debounced FTS on visitor's typed message |
| AI conversation summaries | ✅ | Rolling updates; throttled; graceful degradation |
| AI reply drafts (KB-grounded) | ✅ | Strict prompt: only answers from KB; fallback if no match |
| Canned responses | ✅ | `/` picker in compose; title + body search |
| Custom domains | ✅ | DNS verification + Azure managed cert via ARM; Simulate mode |
| Password auth | ❌ | Google OAuth only — no credential storage by design |
| Rich-text editor (TipTap) | ❌ | contentEditable + sanitize-html; avoids a large dep for the deadline |
| SLA tracking | ❌ | Deferred — would add `firstResponseAt` + breach indicators |
| Analytics dashboard | ❌ | Deferred |
| Webhooks / REST API | ❌ | Deferred |

---

## Real-time design

- **Rooms**: agents join `ws:{workspaceId}` on login; `conv:{id}` on open. Visitors join `conv:{id}` via socket auth (workspace key + visitor token).
- **Single write path**: `createMessage` in `repos/conversations` is the only place messages are written. An in-process `EventEmitter` fans writes out to the correct socket rooms. REST replies and socket sends are identical from the DB perspective — no dual-write bugs.
- **Ordering**: messages carry a monotonic `seq` (Postgres `generated always as identity`). Clients dedupe by message id.
- **Reconnect**: on socket reconnect the client invalidates TanStack Query cache → refetch. A `?after=lastSeq` param on the messages endpoint lets clients backfill gaps without full reload.
- **Presence**: socket connect/disconnect counts per workspace drive `presence` events to visitors; visitor join/disconnect drives `visitor:presence` to agents.

---

## Email threading design

**Inbound** (SendGrid → `POST /webhooks/sendgrid-inbound/:secret`):
1. Resolve workspace from recipient slug (`rapid_commerce@parse.anujchhikara.com` → `"acme"`)
2. Find or create contact by from-address
3. `resolveThread` checks `In-Reply-To` / `References` against stored `emailMessageId`s to attach to an existing conversation (and reopen it if resolved) — otherwise creates a new one

**Outbound** (agent reply from dashboard):
1. Mint a stable `Message-ID` (`<msg-{rowId}@parse.anujchhikara.com>`)
2. Set `In-Reply-To` + `References` from the latest inbound message
3. Send via SendGrid FROM `<slug>@parse.anujchhikara.com` (authenticated via `em6165.parse.anujchhikara.com` SendGrid domain)
4. Delivery failures surface as a system message in the thread — conversation stays usable

---

## AI design

- `buildDraftPrompt` and `buildSummaryPrompt` are pure functions (unit-testable) that construct strict prompts.
- **Summaries**: three-section format ("What the customer wants / What's been tried / Current status"), ≤120 words, explicit "never invent" rule. Rolling — folds the previous summary into the next prompt. Throttled to once per 60s per conversation; only triggers at ≥6 messages.
- **Drafts**: grounded only in KB articles matched by FTS against the last customer message. If no articles match, the model is instructed to respond with a polite "I'll look into this" — never answers from general knowledge. Workspace name in the system prompt scopes the persona.
- **Model**: `gpt-4o-mini`, `temperature 0.2` (summaries) / `0.4` (drafts), `max_tokens 220/320`. 10s timeout, one retry on 429/5xx.
- **Graceful degradation**: all AI calls are fire-and-forget or return 503 on failure. Conversations remain fully usable without AI.

---

## Security

- All tenant queries scoped by server-derived `workspaceId`; visitor endpoints additionally scoped to the visitor's own contact.
- Session cookie: `HttpOnly; Secure; SameSite=Lax`. Raw session token is sha-256 hashed before storage — a leaked DB row can't be replayed.
- CSRF: all mutating `/api` requests are origin-checked server-side. Widget API is exempted (cross-origin by design; authenticated by workspace key + visitor token, not cookies).
- Output: chat/email bodies are escaped text (React/Preact default); KB HTML sanitized with `sanitize-html` allowlist on save; FTS `ts_headline` snippets are escaped and re-marked.
- `helmet` security headers throughout; CORP/COEP/CSP relaxed only where the widget iframe must embed cross-origin.
- SendGrid inbound webhook secret is in the URL path (Inbound Parse can't send custom headers); protected by HTTPS + constant-time compare; never logged.
- Widget `identify` endpoint does **not** adopt an existing contact by unverified email — prevents identity takeover. Production would add an HMAC or emailed code step.

---

## Local setup

**Prerequisites**: Node 20+, pnpm 9+, Postgres 16

```bash
git clone <repo>
cd superprofile
pnpm install

# Create DB and run migrations
createdb support
DATABASE_URL=postgres://postgres:postgres@localhost:5432/support \
  pnpm --filter server exec drizzle-kit migrate

# Copy env files and fill in secrets
cp server/.env.example server/.env
cp web/.env.example web/.env

# Build the widget (outputs to server/public/)
pnpm --filter widget build

# Run everything
pnpm --filter server dev     # API + sockets on :3000
pnpm --filter web dev        # Dashboard on :5173
```

**Minimum env vars for local dev** (others have defaults in `env.ts`):
```
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=http://localhost:3000/api/auth/google/callback
SENDGRID_API_KEY=...          # omit to log emails to console instead of sending
OPENAI_API_KEY=...            # omit for graceful AI degradation
```

**Seed demo data** — sign in, then in browser DevTools:
```js
fetch('http://localhost:3000/api/dev/seed', {method:'POST',credentials:'include'})
  .then(r=>r.json()).then(console.log)
// → switch to "Rapid Commerce" workspace in the sidebar
// → open http://localhost:3000/demo to test the widget
```

**Tests**:
```bash
DATABASE_URL=postgres://postgres:postgres@localhost:5432/support \
  pnpm --filter server test
```

---

## Known limitations & at-scale plan

| Limitation | At-scale fix |
|---|---|
| Single process, in-memory socket presence + AI throttle | Socket.io Redis adapter + shared Redis for maps |
| Email send + AI are inline (fire-and-forget) | BullMQ / SQS queue with retries + dead-letter queue |
| All reads hit the primary | Read replicas for KB public site + inbox lists |
| Postgres FTS | OpenSearch / Typesense if KB grows large or semantic search needed |
| Custom-domain cert polling is synchronous | Background job with webhook callback |
| No horizontal scaling of Socket.io | Redis adapter (one config line with socket.io-redis) |
