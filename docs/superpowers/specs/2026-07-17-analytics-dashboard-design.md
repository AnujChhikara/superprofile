# Analytics Dashboard — short spec

**Goal:** Admin-only analytics for a workspace: first response time, resolution
rate, busiest hours, agent performance. Selectable range (7d / 30d / 90d / all).
Additive only — no breaking changes.

## Data model
Add nullable `resolvedAt timestamp` to `conversations`.
- Set to `now()` when status → `resolved`; clear to `null` on reopen.
- Touch points: `repos/conversations.ts` `updateConversation` (status transitions)
  and the existing "contact message reopens resolved" path (~line 308).
- New Drizzle migration (`drizzle-kit generate`), applied with `pnpm migrate`.
- Pre-migration resolves have `null resolvedAt`; time-to-resolution counts only
  conversations resolved after this ships (labeled in the UI).

## Backend
`GET /api/analytics?range=7d|30d|90d|all`, gated `requireAuth, requireWorkspace("admin")`.
On-the-fly SQL aggregation (no rollup tables). Medians via `percentile_cont`.

### Response contract (pinned — frontend depends on this exact shape)
```jsonc
{
  "range": "30d",
  "summary": {
    "conversationsCreated": 0,
    "resolved": 0,
    "resolutionRate": 0.0,          // 0..1
    "medianFirstResponseSec": 0,     // number | null
    "medianResolutionSec": 0,        // number | null
    "openNow": 0
  },
  "firstResponseTrend": [ { "date": "2026-07-01", "medianSec": 0, "count": 0 } ], // medianSec: number|null
  "resolutionTrend":    [ { "date": "2026-07-01", "created": 0, "resolved": 0 } ],
  "busiestHours":       [ { "dow": 0, "hour": 0, "count": 0 } ], // dow 0=Sun..6=Sat, hour 0..23
  "agents": [ { "userId": "u1", "name": "Ana", "handled": 0, "replies": 0, "avgFirstResponseSec": 0 } ] // avg: number|null
}
```
403 `{ "error": "admin only" }` for non-admins.

Metric definitions:
- **First response**: per conversation `min(agent msg ts) − min(contact msg ts)`; median overall, daily trend bucketed by conversation `createdAt`.
- **Resolution**: rate = resolved ÷ created in range; median time-to-resolution = `resolvedAt − createdAt`; daily created-vs-resolved.
- **Busiest hours**: conversations created grouped by `dow × hour`.
- **Agents**: join `memberships`→`users`; handled = conversations by `assigneeId`, replies = agent messages by `senderId`, avg first response per agent.

Files: `db/tables/conversations.ts`, `repos/conversations.ts`, new `routes/analytics.ts`, mount in `index.ts`, generated migration.

## Frontend
Add `recharts`. New `pages/Analytics.tsx`: range switcher, 4 KPI cards, first-response
line chart, created-vs-resolved bar, busiest-hours heatmap (CSS grid), agent table.
Loading skeletons + empty states. If the query errors with `isAdminOnly`, render the
existing `<AccessDenied />`. Route `/analytics` in `App.tsx`; nav item in `Layout.tsx`.
Reuses `api()`, `isAdminOnly`, `AccessDenied`, shadcn `Card`/`Table`/`Badge`.

## Testing
DB-integration tests can't run here (no Postgres). Add pure-function unit tests for
range→date-window mapping; verify SQL by build + manual check.

## Deploy note
No migrate step in the deploy workflow → apply the `resolvedAt` migration to prod
manually (`pnpm migrate`) after ship.
