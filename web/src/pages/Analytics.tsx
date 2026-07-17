import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import { api, isAdminOnly } from "../api.js";
import { AccessDenied } from "@/components/AccessDenied";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

type Range = "7d" | "30d" | "90d" | "all";

interface Analytics {
  range: Range;
  summary: {
    conversationsCreated: number;
    resolved: number;
    resolutionRate: number;
    medianFirstResponseSec: number | null;
    medianResolutionSec: number | null;
    openNow: number;
  };
  firstResponseTrend: { date: string; medianSec: number | null; count: number }[];
  resolutionTrend: { date: string; created: number; resolved: number }[];
  busiestHours: { dow: number; hour: number; count: number }[];
  agents: {
    userId: string;
    name: string;
    handled: number;
    replies: number;
    avgFirstResponseSec: number | null;
  }[];
}

const RANGES: { value: Range; label: string }[] = [
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "90d", label: "90d" },
  { value: "all", label: "All" },
];

const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Format a duration in seconds into a compact human string (e.g. "4m 12s",
// "3h 20m"). Returns "—" for null.
export function formatDuration(sec: number | null): string {
  if (sec == null) return "—";
  if (sec < 0) sec = 0;
  const s = Math.round(sec);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) {
    const rem = s % 60;
    return rem ? `${m}m ${rem}s` : `${m}m`;
  }
  const h = Math.floor(m / 60);
  if (h < 24) {
    const rem = m % 60;
    return rem ? `${h}h ${rem}m` : `${h}h`;
  }
  const d = Math.floor(h / 24);
  const remH = h % 24;
  return remH ? `${d}d ${remH}h` : `${d}d`;
}

function secToMin(sec: number | null): number | null {
  return sec == null ? null : Math.round((sec / 60) * 10) / 10;
}

export default function Analytics() {
  const [range, setRange] = useState<Range>("30d");

  const { data, isLoading, error } = useQuery<Analytics>({
    queryKey: ["analytics", range],
    queryFn: () => api<Analytics>(`/api/analytics?range=${range}`),
    retry: (c, e) => !isAdminOnly(e) && c < 2,
  });

  if (isAdminOnly(error)) return <AccessDenied />;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-8">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Analytics</h1>
          <p className="text-muted-foreground">
            Response times, resolution rate, busiest hours and agent performance.
          </p>
        </div>
        <Tabs value={range} onValueChange={(v) => setRange(v as Range)}>
          <TabsList>
            {RANGES.map((r) => (
              <TabsTrigger key={r.value} value={r.value}>
                {r.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {isLoading || !data ? (
        <LoadingState />
      ) : (
        <>
          <KpiRow summary={data.summary} />
          <FirstResponseChart trend={data.firstResponseTrend} />
          <ResolutionChart trend={data.resolutionTrend} />
          <BusiestHours cells={data.busiestHours} />
          <AgentTable agents={data.agents} />
        </>
      )}
    </div>
  );
}

function LoadingState() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-72 rounded-xl" />
      <Skeleton className="h-72 rounded-xl" />
      <Skeleton className="h-56 rounded-xl" />
      <Skeleton className="h-64 rounded-xl" />
    </div>
  );
}

function Kpi({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-semibold tracking-tight">{value}</div>
        {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function KpiRow({ summary }: { summary: Analytics["summary"] }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Kpi
        label="Resolution rate"
        value={`${Math.round(summary.resolutionRate * 100)}%`}
        sub={`${summary.resolved} of ${summary.conversationsCreated} resolved`}
      />
      <Kpi
        label="Median first response"
        value={formatDuration(summary.medianFirstResponseSec)}
      />
      <Kpi
        label="Median time to resolve"
        value={formatDuration(summary.medianResolutionSec)}
        sub={
          summary.medianResolutionSec == null
            ? "since tracking began"
            : undefined
        }
      />
      <Kpi
        label="Conversations"
        value={String(summary.conversationsCreated)}
        sub={`${summary.openNow} open now`}
      />
    </div>
  );
}

function ChartEmpty() {
  return (
    <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
      No data for this period
    </div>
  );
}

function FirstResponseChart({
  trend,
}: {
  trend: Analytics["firstResponseTrend"];
}) {
  const data = trend.map((d) => ({
    date: d.date,
    minutes: secToMin(d.medianSec),
  }));
  const hasData = data.some((d) => d.minutes != null);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">First response time (median)</CardTitle>
      </CardHeader>
      <CardContent>
        {!hasData ? (
          <ChartEmpty />
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 12 }}
                stroke="currentColor"
                className="text-muted-foreground"
              />
              <YAxis
                tick={{ fontSize: 12 }}
                stroke="currentColor"
                className="text-muted-foreground"
                unit="m"
                allowDecimals={false}
              />
              <Tooltip
                formatter={(v) => [`${v} min`, "Median"]}
                contentStyle={{ fontSize: 12 }}
              />
              <Line
                type="monotone"
                dataKey="minutes"
                stroke="oklch(0.60 0.22 277)"
                strokeWidth={2}
                dot={false}
                connectNulls
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}

function ResolutionChart({ trend }: { trend: Analytics["resolutionTrend"] }) {
  const hasData = trend.some((d) => d.created > 0 || d.resolved > 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Created vs resolved</CardTitle>
      </CardHeader>
      <CardContent>
        {!hasData ? (
          <ChartEmpty />
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={trend} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 12 }}
                stroke="currentColor"
                className="text-muted-foreground"
              />
              <YAxis
                tick={{ fontSize: 12 }}
                stroke="currentColor"
                className="text-muted-foreground"
                allowDecimals={false}
              />
              <Tooltip contentStyle={{ fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="created" name="Created" fill="oklch(0.60 0.22 277)" radius={[3, 3, 0, 0]} />
              <Bar dataKey="resolved" name="Resolved" fill="oklch(0.72 0.15 160)" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}

function BusiestHours({ cells }: { cells: Analytics["busiestHours"] }) {
  // Lookup keyed by "dow-hour" → count.
  const lookup = new Map<string, number>();
  let max = 0;
  for (const c of cells) {
    lookup.set(`${c.dow}-${c.hour}`, c.count);
    if (c.count > max) max = c.count;
  }
  const hours = Array.from({ length: 24 }, (_, h) => h);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Busiest hours</CardTitle>
      </CardHeader>
      <CardContent>
        {max === 0 ? (
          <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
            No data for this period
          </div>
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-[560px]">
              {/* Hour axis */}
              <div
                className="grid gap-1 pl-10"
                style={{ gridTemplateColumns: "repeat(24, minmax(0, 1fr))" }}
              >
                {hours.map((h) => (
                  <div
                    key={h}
                    className="text-center text-[10px] text-muted-foreground"
                  >
                    {h % 3 === 0 ? h : ""}
                  </div>
                ))}
              </div>

              {/* Rows */}
              <div className="mt-1 space-y-1">
                {DOW_LABELS.map((label, dow) => (
                  <div key={dow} className="flex items-center gap-1">
                    <div className="w-9 shrink-0 text-right text-[11px] text-muted-foreground">
                      {label}
                    </div>
                    <div
                      className="grid flex-1 gap-1"
                      style={{
                        gridTemplateColumns: "repeat(24, minmax(0, 1fr))",
                      }}
                    >
                      {hours.map((h) => {
                        const count = lookup.get(`${dow}-${h}`) ?? 0;
                        const intensity = count === 0 ? 0 : count / max;
                        return (
                          <div
                            key={h}
                            title={`${label} ${h}:00 — ${count} conversation${count === 1 ? "" : "s"}`}
                            className={
                              count === 0
                                ? "aspect-square rounded-sm bg-muted"
                                : "aspect-square rounded-sm bg-primary"
                            }
                            style={
                              count === 0
                                ? undefined
                                : { opacity: 0.2 + intensity * 0.8 }
                            }
                          />
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AgentTable({ agents }: { agents: Analytics["agents"] }) {
  const sorted = [...agents].sort((a, b) => b.handled - a.handled);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Agent performance</CardTitle>
      </CardHeader>
      <CardContent>
        {sorted.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No agent activity for this period
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Agent</th>
                  <th className="px-3 py-2 text-right font-medium">Handled</th>
                  <th className="px-3 py-2 text-right font-medium">Replies</th>
                  <th className="px-3 py-2 text-right font-medium">
                    Avg first response
                  </th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((a) => (
                  <tr key={a.userId} className="border-b last:border-0">
                    <td className="px-3 py-2 font-medium">{a.name}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {a.handled}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {a.replies}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatDuration(a.avgFirstResponseSec)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
