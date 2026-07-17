# shadcn/ui Migration Plan (handoff)

**Goal:** Replace the dashboard's (and widget's) hand-written inline `style={}` objects
with a consistent shadcn/ui design system. Brand = **indigo, light theme**. Scope =
**dashboard (`web/`) + chat widget (`widget/`)** per the product owner.

**REQUIRED:** Use the `shadcn` skill (`.agents/skills/shadcn/SKILL.md`). Before creating/fixing
any component, run `pnpm dlx shadcn@latest docs <component>` and read the URLs. Do not guess APIs.

---

## ✅ Already done (foundation — committed? NO, still in working tree)

- Tailwind v4 installed in `web/` (`@tailwindcss/vite`), wired in `web/vite.config.ts`
  (plugin + `@` → `./src` alias). `@/*` path added to `web/tsconfig.json` + `tsconfig.app.json`
  (note: `baseUrl` removed — TS 6 deprecates it; `paths` resolve relative to the config dir).
- `pnpm dlx shadcn@latest init -b radix --preset nova` → `web/components.json`
  (`style: radix-nova`, `rsc: false`, `iconLibrary: lucide`, aliases `@/components`, `@/lib/utils`).
- `web/src/index.css` rewritten by the CLI with the nova theme, **then customized to indigo**:
  `--primary`, `--ring`, `--sidebar-primary`, `--sidebar-ring` = `oklch(0.511 0.229 277)` (≈ #4f46e5).
  Geist font is imported by the preset.
- Components installed into `web/src/components/ui/`:
  `alert, avatar, badge, button, card, dialog, dropdown-menu, empty, field, input, label,
  scroll-area, select, separator, sheet, sidebar, skeleton, sonner, tabs, textarea, tooltip`.
- `web/src/lib/utils.ts` provides `cn()`.
- **`pnpm --filter web build` passes** on the foundation (pages still use old inline styles and
  compile fine because they don't import shadcn yet).

Also uncommitted from prior work (keep, unrelated to this migration):
- `server/src/realtime/socket.ts` — socket IDOR fix (verified).
- `server/src/env.ts`, `server/drizzle.config.ts`, `.gitignore`, `server/.env.example`,
  `web/.env.example` — local `.env` loading setup.

---

## Conventions (enforced by the shadcn skill — read `rules/*.md`)

1. **`rsc: false`** → this is a Vite SPA. **No `"use client"` directives.**
2. **Icons: `lucide-react`.** In a `Button`, put `data-icon="inline-start"` / `"inline-end"` on the
   icon and **no size classes** on it. Pass icons as components, not strings.
3. **`className` = layout only** (flex, gap, grid, padding). **Never** override component colors or
   typography. Use **semantic tokens**: `bg-background`, `text-muted-foreground`, `bg-primary`,
   `border`, `text-foreground` — never `bg-blue-500`, never raw hex.
4. **Spacing:** `flex flex-col gap-*`, never `space-y-*`. Equal w/h → `size-*` not `w-* h-*`.
   Truncation → `truncate`. Conditional classes → `cn(...)`, not template-literal ternaries.
5. **No manual `z-index`** on overlays (Dialog/Sheet/Popover/DropdownMenu handle it).
6. **Forms:** `FieldGroup` + `Field` + `FieldLabel` + `FieldDescription` (from `@/components/ui/field`),
   never raw `div` + `Label`. Validation: `data-invalid` on `Field`, `aria-invalid` on the control.
7. **Composition:** full `Card` parts (`CardHeader/CardTitle/CardDescription/CardContent/CardFooter`).
   `SelectItem` inside `SelectGroup`. `TabsTrigger` inside `TabsList`. `Avatar` always has
   `AvatarFallback`. Radix base → custom triggers use `asChild`.
8. **Use components, not custom markup:** `Alert` for callouts, `Empty` for empty states,
   `Badge` for status pills, `Separator` for dividers, `Skeleton` for loading, `toast()` from
   `sonner` for toasts, `Tooltip` for hints.

**Button variants:** `default` (indigo), `outline`, `secondary`, `ghost`, `destructive`, `link`.
Sizes: `default`, `sm`, `lg`, `icon`. **Badge variants:** `default`, `secondary`, `destructive`, `outline`.

---

## Migration checklist (dashboard `web/src`)

Work top-down; commit after each file or logical group. After each: `pnpm --filter web build`.

- [ ] **`App.tsx`** — mount global providers: add `<Toaster />` (from `@/components/ui/sonner`)
  once near the root, and `TooltipProvider` if any tooltips are used app-wide. Keep the existing
  auth-gated route tree. Replace the inline "Loading…" splash with a centered `Spinner`/`Skeleton`.
- [ ] **`Layout.tsx`** — rebuild the sidebar with the shadcn **Sidebar** primitives
  (`SidebarProvider > Sidebar > SidebarHeader/SidebarContent(SidebarMenu > SidebarMenuItem >
  SidebarMenuButton asChild + NavLink)/SidebarFooter`, `SidebarInset` for the page area,
  `SidebarTrigger` in a top bar). Workspace switcher → `DropdownMenu`. User block in
  `SidebarFooter` with `Avatar`+`AvatarFallback`. Icons from lucide (Inbox, BookOpen, Settings,
  Globe, MessageSquare). Nav items: Inbox `/inbox`, Knowledge Base `/knowledge`, Team
  `/settings/team`, Domains `/settings/domains`, Canned `/settings/canned`.
- [ ] **`pages/Login.tsx`** — center a `Card` (CardHeader/CardTitle/CardDescription + CardContent
  with a full-width `Button` "Continue with Google" using a Google `svg` as `data-icon`). The
  button navigates to `${VITE_API_ORIGIN}/api/auth/google`.
- [ ] **`pages/Onboarding.tsx`** — `Card` + `FieldGroup`/`Field` for the workspace-name form;
  submit `Button` with a loading `Spinner`. Keep the POST `/api/workspaces` + set active workspace.
- [ ] **`pages/InviteAccept.tsx`** — center a `Card`; use `Alert` (destructive) for errors,
  `Spinner` while accepting. Keep the two-effect accept→refetch→navigate logic intact.
- [ ] **`pages/Settings/Team.tsx`** — members in a `Table` or `Card` list with `Avatar`+`Badge`
  (role) + role `Select` (admin-only) + remove `Button variant="ghost" size="icon"` with a
  confirm `AlertDialog`. Invite form via `FieldGroup` (email `Input` + role `Select` +
  Send `Button`); on success show the invite link in an `InputGroup`/`Alert` with a copy button.
  Preserve last-admin 409 handling → surface via `toast.error`.
- [ ] **`pages/Settings/Domains.tsx`** — one `Card` per domain: `Badge` for status
  (pending_dns/verifying/active/failed → map to secondary/default/…), DNS records in a small
  `Table` with copy buttons (`Button size="icon"` + `Copy` icon + `toast`), Verify/Simulate/Remove
  `Button`s. Add form via `FieldGroup`. Keep all endpoints (`/api/domains…`).
- [ ] **`pages/Settings/Canned.tsx`** — `FieldGroup` add form (title `Input` + body `Textarea` +
  `Button`); list as `Card`s with delete. Keep `/api/canned` CRUD.
- [ ] **`pages/KnowledgeBase.tsx`** — two-pane: left list of articles as `SidebarMenu`-style
  buttons or a `Card` list with status `Badge`; right editor = `Input` (title) + a toolbar of
  `Button variant="outline" size="sm"` (Bold/Italic/H2/List/Link) + the `contentEditable` body
  (keep as-is; wrap in a bordered `div` styled with tokens) + Save/Publish/Delete `Button`s +
  `toast` on save. Categories panel with `FieldGroup` add + `Card` list. Keep all `/api/kb` calls.
- [ ] **`pages/Inbox.tsx`** (BIGGEST — 3 panes) — migrate in sub-parts, keep ALL logic
  (`useInboxRealtime`, queries, mutations, socket) unchanged; only swap presentation:
  - Left pane: channel filter → `Tabs` (All/Chat/Email); status + assignee → `Select`;
    conversation list inside `ScrollArea`, each row a `button` with `Avatar`+`AvatarFallback`,
    name, unread `Badge`, preview (`truncate`), status `Badge`, relative time. Selected state via
    `cn(... 'bg-muted')`.
  - Middle: message thread in a `ScrollArea`; bubbles — **prefer the chat primitives**
    (`Message`/`Bubble` from the shadcn chat registry — `add` them; see `rules/chat.md`) or, if
    keeping custom, use tokens (`bg-primary text-primary-foreground` for agent, `bg-muted` for
    contact, centered `Badge`/muted text for system). Typing indicator + ✓/✓✓ read receipts stay.
    Composer: `Textarea` + Send `Button` + "✨ Draft" `Button variant="outline"`; canned "/" picker
    → `Command` inside a `Popover` (add `command` + `popover`).
  - Right pane: `Card`s — contact (`Avatar`+name+email), **AI summary** (`Card` + stale `Badge` +
    Regenerate `Button` + `Skeleton` while pending), status actions (Resolve/Reopen `Button`s +
    Snooze `DropdownMenu`), assignee `Select`, details list.

## Widget (`widget/`) — separate sub-project

The widget frame is **Preact**, not React, and is a tiny embeddable iframe. Two options — pick one
and note it:
- **(A) Recommended:** don't pull full shadcn/Radix into the widget (bundle bloat + Radix/Preact
  friction). Instead add Tailwind v4 to `widget/` with the **same `index.css` theme tokens** (copy
  the `:root` indigo vars) and rebuild `frame/App.tsx` with Tailwind utility classes + a few local
  shadcn-styled primitives (Button/Input copied in). Keeps it ~small and visually consistent.
- **(B) Full parity:** convert the frame from Preact to React, run `shadcn init` in `widget/`, and
  reuse components. Larger bundle; only if the owner insists on literal component reuse.

Either way: keep the loader (`widget/src/loader.ts`) as-is, and keep the API/socket logic in
`frame/App.tsx` unchanged — only swap presentation.

---

## Verification (per page and at the end)

1. `pnpm --filter web build` — must stay green (tsc + vite).
2. Run the app: server on :3000 (`pnpm --filter server dev`), dashboard on :5173
   (`pnpm --filter web dev`). Log in with Google, seed demo data
   (`POST /api/dev/seed`), and click through every migrated page.
3. Widget: `pnpm --filter widget build` then open `http://localhost:3000/demo`.
4. Sanity: no raw hex colors left (`grep -rE '#[0-9a-fA-F]{6}' web/src/pages web/src/Layout.tsx`
   should be empty except intentional brand SVGs), no `style={{` left in migrated files,
   no `space-y-`/`space-x-`, no manual `z-index`.

## Gotchas

- **`rsc:false`** → never add `"use client"`.
- Icons are **lucide** (`components.json.iconLibrary`), not tabler. Import from `lucide-react`.
- Theme is **already indigo** — don't re-run a preset that resets it; if you must, re-apply the
  four `oklch(0.511 0.229 277)` overrides in `index.css`.
- Delete the now-unused `web/src/App.css` and the old inline `styles` objects as you convert each
  file (don't leave dead code).
- Keep all data/query/socket/mutation logic **byte-for-byte** — this is a presentation-only swap.
- After adding any community/registry component, re-read it and fix imports to `@/components/ui/…`
  and icons to lucide (skill workflow step 6–7).

## Suggested commit sequence

1. `chore(web): tailwind v4 + shadcn foundation (indigo theme)` — the foundation already in the tree.
2. `refactor(web): migrate layout + auth pages to shadcn`
3. `refactor(web): migrate settings pages (team/domains/canned) to shadcn`
4. `refactor(web): migrate knowledge base to shadcn`
5. `refactor(web): migrate inbox to shadcn`
6. `refactor(widget): consistent theme with dashboard`
