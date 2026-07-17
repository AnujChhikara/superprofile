import { Router } from "express";
import { db } from "../db/client.js";
import { sql } from "drizzle-orm";
import { requireAuth, requireWorkspace } from "../auth/middleware.js";

export const analyticsRouter = Router();

// ------------------------------------------------------------------
// Response contract (pinned — the frontend depends on this exact shape)
// ------------------------------------------------------------------
export type AnalyticsRange = "7d" | "30d" | "90d" | "all";

export interface AnalyticsResponse {
  range: AnalyticsRange;
  summary: {
    conversationsCreated: number;
    resolved: number;
    resolutionRate: number; // 0..1
    medianFirstResponseSec: number | null;
    medianResolutionSec: number | null;
    openNow: number;
  };
  firstResponseTrend: Array<{
    date: string; // YYYY-MM-DD
    medianSec: number | null;
    count: number;
  }>;
  resolutionTrend: Array<{
    date: string; // YYYY-MM-DD
    created: number;
    resolved: number;
  }>;
  busiestHours: Array<{
    dow: number; // 0=Sun..6=Sat
    hour: number; // 0..23
    count: number;
  }>;
  agents: Array<{
    userId: string;
    name: string;
    handled: number;
    replies: number;
    avgFirstResponseSec: number | null;
  }>;
}

// ------------------------------------------------------------------
// Pure helper: map a range string to the window's lower bound (or null
// for "all"). Exported for unit testing — no DB access.
// ------------------------------------------------------------------
export function rangeToSince(range: AnalyticsRange, now: Date): Date | null {
  const days: Record<Exclude<AnalyticsRange, "all">, number> = {
    "7d": 7,
    "30d": 30,
    "90d": 90,
  };
  if (range === "all") return null;
  return new Date(now.getTime() - days[range] * 24 * 60 * 60 * 1000);
}

function parseRange(raw: unknown): AnalyticsRange {
  return raw === "7d" || raw === "90d" || raw === "all" ? raw : "30d";
}

// Round to an integer, preserving null.
function roundOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function toNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

analyticsRouter.use(requireAuth, requireWorkspace("admin"));

analyticsRouter.get("/", async (req, res) => {
  const wsId = req.workspaceId!;
  const range = parseRange(req.query.range);
  const since = rangeToSince(range, new Date());

  try {
    // A NULL lower bound means "no lower bound" (the `all` range). We express
    // the window predicate once and reuse it; `since IS NULL` short-circuits it.
    const sinceParam = since;

    // ---- Summary: created / resolved / rate / median resolution ----
    const summaryRows = await db.execute(sql`
      SELECT
        count(*) FILTER (
          WHERE ${sinceParam}::timestamptz IS NULL OR c.created_at >= ${sinceParam}
        ) AS created,
        count(*) FILTER (
          WHERE c.status = 'resolved'
            AND (${sinceParam}::timestamptz IS NULL OR c.created_at >= ${sinceParam})
        ) AS resolved,
        percentile_cont(0.5) WITHIN GROUP (
          ORDER BY extract(epoch FROM (c.resolved_at - c.created_at))
        ) FILTER (
          WHERE c.resolved_at IS NOT NULL
            AND (${sinceParam}::timestamptz IS NULL OR c.resolved_at >= ${sinceParam})
        ) AS median_resolution_sec
      FROM conversations c
      WHERE c.workspace_id = ${wsId}
    `);
    const s = (summaryRows.rows[0] ?? {}) as {
      created?: unknown;
      resolved?: unknown;
      median_resolution_sec?: unknown;
    };
    const conversationsCreated = toNum(s.created);
    const resolved = toNum(s.resolved);

    // ---- openNow: workspace-wide, not window-bound ----
    const openRows = await db.execute(sql`
      SELECT count(*) AS open_now
      FROM conversations c
      WHERE c.workspace_id = ${wsId} AND c.status <> 'resolved'
    `);
    const openNow = toNum((openRows.rows[0] as { open_now?: unknown })?.open_now);

    // ---- First response per conversation (CTE), overall median + daily trend --
    // fr = seconds between first contact msg and first agent msg, per conv, only
    // where an agent reply exists. Bucketed by the conversation's created_at.
    const firstResponseRows = await db.execute(sql`
      WITH fr AS (
        SELECT
          c.id,
          c.created_at::date AS d,
          extract(epoch FROM (
            min(m.created_at) FILTER (WHERE m.sender_type = 'agent')
            - min(m.created_at) FILTER (WHERE m.sender_type = 'contact')
          )) AS secs
        FROM conversations c
        JOIN messages m ON m.conversation_id = c.id
        WHERE c.workspace_id = ${wsId}
          AND (${sinceParam}::timestamptz IS NULL OR c.created_at >= ${sinceParam})
        GROUP BY c.id, c.created_at
        HAVING min(m.created_at) FILTER (WHERE m.sender_type = 'agent') IS NOT NULL
           AND min(m.created_at) FILTER (WHERE m.sender_type = 'contact') IS NOT NULL
      )
      SELECT
        to_char(d, 'YYYY-MM-DD') AS date,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY secs) FILTER (WHERE secs >= 0) AS median_sec,
        count(*) FILTER (WHERE secs >= 0) AS cnt
      FROM fr
      GROUP BY d
      ORDER BY d ASC
    `);
    const firstResponseTrend = (
      firstResponseRows.rows as Array<{
        date: string;
        median_sec: unknown;
        cnt: unknown;
      }>
    ).map((r) => ({
      date: r.date,
      medianSec: roundOrNull(r.median_sec),
      count: toNum(r.cnt),
    }));

    // Overall median first response = median across all qualifying conversations.
    const medianFrRows = await db.execute(sql`
      WITH fr AS (
        SELECT
          extract(epoch FROM (
            min(m.created_at) FILTER (WHERE m.sender_type = 'agent')
            - min(m.created_at) FILTER (WHERE m.sender_type = 'contact')
          )) AS secs
        FROM conversations c
        JOIN messages m ON m.conversation_id = c.id
        WHERE c.workspace_id = ${wsId}
          AND (${sinceParam}::timestamptz IS NULL OR c.created_at >= ${sinceParam})
        GROUP BY c.id
        HAVING min(m.created_at) FILTER (WHERE m.sender_type = 'agent') IS NOT NULL
           AND min(m.created_at) FILTER (WHERE m.sender_type = 'contact') IS NOT NULL
      )
      SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY secs) FILTER (WHERE secs >= 0) AS median_sec
      FROM fr
    `);
    const medianFirstResponseSec = roundOrNull(
      (medianFrRows.rows[0] as { median_sec?: unknown })?.median_sec
    );

    // ---- Resolution trend: per-day created vs resolved, merged by date ----
    const resolutionTrendRows = await db.execute(sql`
      WITH created AS (
        SELECT c.created_at::date AS d, count(*) AS n
        FROM conversations c
        WHERE c.workspace_id = ${wsId}
          AND (${sinceParam}::timestamptz IS NULL OR c.created_at >= ${sinceParam})
        GROUP BY c.created_at::date
      ),
      resolved AS (
        SELECT c.resolved_at::date AS d, count(*) AS n
        FROM conversations c
        WHERE c.workspace_id = ${wsId}
          AND c.resolved_at IS NOT NULL
          AND (${sinceParam}::timestamptz IS NULL OR c.resolved_at >= ${sinceParam})
        GROUP BY c.resolved_at::date
      )
      SELECT
        to_char(days.d, 'YYYY-MM-DD') AS date,
        coalesce(cr.n, 0) AS created,
        coalesce(rs.n, 0) AS resolved
      FROM (
        SELECT d FROM created
        UNION
        SELECT d FROM resolved
      ) days
      LEFT JOIN created cr ON cr.d = days.d
      LEFT JOIN resolved rs ON rs.d = days.d
      ORDER BY days.d ASC
    `);
    const resolutionTrend = (
      resolutionTrendRows.rows as Array<{
        date: string;
        created: unknown;
        resolved: unknown;
      }>
    ).map((r) => ({
      date: r.date,
      created: toNum(r.created),
      resolved: toNum(r.resolved),
    }));

    // ---- Busiest hours: created conversations grouped by dow x hour ----
    const busiestRows = await db.execute(sql`
      SELECT
        extract(dow FROM c.created_at)::int AS dow,
        extract(hour FROM c.created_at)::int AS hour,
        count(*) AS cnt
      FROM conversations c
      WHERE c.workspace_id = ${wsId}
        AND (${sinceParam}::timestamptz IS NULL OR c.created_at >= ${sinceParam})
      GROUP BY 1, 2
      ORDER BY 1, 2
    `);
    const busiestHours = (
      busiestRows.rows as Array<{ dow: unknown; hour: unknown; cnt: unknown }>
    ).map((r) => ({
      dow: toNum(r.dow),
      hour: toNum(r.hour),
      count: toNum(r.cnt),
    }));

    // ---- Agents: all admin/agent members, with handled / replies / avg fr ----
    const agentRows = await db.execute(sql`
      WITH members AS (
        SELECT mem.user_id, u.name
        FROM memberships mem
        JOIN users u ON u.id = mem.user_id
        WHERE mem.workspace_id = ${wsId}
          AND mem.role IN ('admin', 'agent')
      ),
      handled AS (
        SELECT c.assignee_id AS user_id, count(*) AS n
        FROM conversations c
        WHERE c.workspace_id = ${wsId}
          AND c.assignee_id IS NOT NULL
          AND (${sinceParam}::timestamptz IS NULL OR c.created_at >= ${sinceParam})
        GROUP BY c.assignee_id
      ),
      replies AS (
        SELECT m.sender_id AS user_id, count(*) AS n
        FROM messages m
        WHERE m.workspace_id = ${wsId}
          AND m.sender_type = 'agent'
          AND m.sender_id IS NOT NULL
          AND (${sinceParam}::timestamptz IS NULL OR m.created_at >= ${sinceParam})
        GROUP BY m.sender_id
      ),
      fr AS (
        SELECT
          agent_first.sender_id AS user_id,
          extract(epoch FROM (agent_first.first_agent - contact_first.first_contact)) AS secs
        FROM (
          SELECT DISTINCT ON (m.conversation_id)
            m.conversation_id, m.sender_id, m.created_at AS first_agent
          FROM messages m
          JOIN conversations c ON c.id = m.conversation_id
          WHERE c.workspace_id = ${wsId}
            AND m.sender_type = 'agent'
            AND (${sinceParam}::timestamptz IS NULL OR c.created_at >= ${sinceParam})
          ORDER BY m.conversation_id, m.created_at ASC
        ) agent_first
        JOIN (
          SELECT m.conversation_id, min(m.created_at) AS first_contact
          FROM messages m
          WHERE m.sender_type = 'contact'
          GROUP BY m.conversation_id
        ) contact_first ON contact_first.conversation_id = agent_first.conversation_id
      ),
      fr_avg AS (
        SELECT user_id, avg(secs) AS avg_secs
        FROM fr
        WHERE secs >= 0 AND user_id IS NOT NULL
        GROUP BY user_id
      )
      SELECT
        members.user_id,
        members.name,
        coalesce(handled.n, 0) AS handled,
        coalesce(replies.n, 0) AS replies,
        fr_avg.avg_secs AS avg_first_response_sec
      FROM members
      LEFT JOIN handled ON handled.user_id = members.user_id
      LEFT JOIN replies ON replies.user_id = members.user_id
      LEFT JOIN fr_avg ON fr_avg.user_id = members.user_id
      ORDER BY members.name ASC
    `);
    const agents = (
      agentRows.rows as Array<{
        user_id: string;
        name: string;
        handled: unknown;
        replies: unknown;
        avg_first_response_sec: unknown;
      }>
    ).map((r) => ({
      userId: r.user_id,
      name: r.name,
      handled: toNum(r.handled),
      replies: toNum(r.replies),
      avgFirstResponseSec: roundOrNull(r.avg_first_response_sec),
    }));

    const resolutionRate =
      conversationsCreated > 0 ? resolved / conversationsCreated : 0;

    const response: AnalyticsResponse = {
      range,
      summary: {
        conversationsCreated,
        resolved,
        resolutionRate,
        medianFirstResponseSec,
        medianResolutionSec: roundOrNull(s.median_resolution_sec),
        openNow,
      },
      firstResponseTrend,
      resolutionTrend,
      busiestHours,
      agents,
    };

    return void res.json(response);
  } catch (err) {
    console.error("[analytics]", err);
    return void res.status(500).json({ error: "analytics failed" });
  }
});
