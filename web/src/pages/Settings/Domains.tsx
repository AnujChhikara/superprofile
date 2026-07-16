import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api.js";

interface DnsRecord {
  type: string;
  name: string;
  value: string;
}
interface Domain {
  id: string;
  hostname: string;
  status: "pending_dns" | "verifying" | "active" | "failed";
  error: string | null;
  records: DnsRecord[];
}

const STATUS_STYLE: Record<string, { bg: string; fg: string; label: string }> = {
  pending_dns: { bg: "#fef9c3", fg: "#854d0e", label: "Pending DNS" },
  verifying: { bg: "#dbeafe", fg: "#1e40af", label: "Verifying" },
  active: { bg: "#dcfce7", fg: "#166534", label: "Active" },
  failed: { bg: "#fee2e2", fg: "#b91c1c", label: "Failed" },
};

export default function Domains() {
  const qc = useQueryClient();
  const [hostname, setHostname] = useState("");
  const [err, setErr] = useState("");

  const { data: domains = [] } = useQuery<Domain[]>({
    queryKey: ["domains"],
    queryFn: () => api<Domain[]>("/api/domains"),
  });

  const add = useMutation({
    mutationFn: () =>
      api("/api/domains", {
        method: "POST",
        body: JSON.stringify({ hostname }),
      }),
    onSuccess: () => {
      setHostname("");
      setErr("");
      qc.invalidateQueries({ queryKey: ["domains"] });
    },
    onError: (e: Error) => setErr(e.message),
  });

  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: string }) =>
      api(`/api/domains/${id}/${action}`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["domains"] }),
  });

  const del = useMutation({
    mutationFn: (id: string) => api(`/api/domains/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["domains"] }),
  });

  return (
    <div style={S.wrap}>
      <h2 style={S.h2}>Custom Domains</h2>
      <p style={S.sub}>
        Serve your help center from your own domain (e.g. help.yourcompany.com).
      </p>

      <div style={S.addRow}>
        <input
          style={S.input}
          value={hostname}
          onChange={(e) => setHostname(e.target.value)}
          placeholder="help.yourcompany.com"
        />
        <button
          style={S.primary}
          disabled={!hostname.trim() || add.isPending}
          onClick={() => add.mutate()}
        >
          Add domain
        </button>
      </div>
      {err && <div style={S.err}>{err}</div>}

      <div style={{ marginTop: 24 }}>
        {domains.length === 0 && (
          <div style={S.muted}>No custom domains yet.</div>
        )}
        {domains.map((d) => {
          const st = STATUS_STYLE[d.status];
          return (
            <div key={d.id} style={S.card}>
              <div style={S.cardHead}>
                <strong>{d.hostname}</strong>
                <span style={{ ...S.pill, background: st.bg, color: st.fg }}>
                  {st.label}
                </span>
              </div>
              {d.error && <div style={S.errNote}>{d.error}</div>}

              {d.status !== "active" && (
                <div style={S.records}>
                  <div style={S.recordsLabel}>Add these DNS records:</div>
                  {d.records.map((r) => (
                    <div key={r.type} style={S.recordRow}>
                      <span style={S.recType}>{r.type}</span>
                      <code style={S.code}>{r.name}</code>
                      <span style={S.arrow}>→</span>
                      <code style={S.code}>{r.value}</code>
                      <button
                        style={S.copyBtn}
                        onClick={() => navigator.clipboard?.writeText(r.value)}
                      >
                        Copy
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div style={S.actions}>
                {d.status !== "active" && (
                  <button
                    style={S.secondary}
                    onClick={() => act.mutate({ id: d.id, action: "verify" })}
                    disabled={act.isPending}
                  >
                    {d.status === "verifying" ? "Check status" : "Verify"}
                  </button>
                )}
                {d.status !== "active" && (
                  <button
                    style={S.secondary}
                    onClick={() => act.mutate({ id: d.id, action: "simulate" })}
                    disabled={act.isPending}
                    title="Demo mode: mark active without real DNS/cert"
                  >
                    Simulate verification (demo)
                  </button>
                )}
                {d.status === "active" && (
                  <a
                    style={S.link}
                    href={`https://${d.hostname}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open ↗
                  </a>
                )}
                <button style={S.danger} onClick={() => del.mutate(d.id)}>
                  Remove
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  wrap: { padding: "32px 40px", maxWidth: 720, fontFamily: "system-ui, sans-serif" },
  h2: { margin: "0 0 4px", fontSize: 22, fontWeight: 600, color: "#111827" },
  sub: { margin: "0 0 20px", color: "#6b7280", fontSize: 14 },
  addRow: { display: "flex", gap: 8 },
  input: { flex: 1, padding: "9px 12px", border: "1px solid #e5e7eb", borderRadius: 8, fontSize: 14 },
  primary: { background: "#4f46e5", color: "#fff", border: "none", borderRadius: 8, padding: "9px 16px", fontWeight: 600, fontSize: 13, cursor: "pointer" },
  secondary: { background: "#f3f4f6", color: "#374151", border: "1px solid #e5e7eb", borderRadius: 6, padding: "6px 12px", fontSize: 12, cursor: "pointer" },
  danger: { background: "#fef2f2", color: "#b91c1c", border: "1px solid #fecaca", borderRadius: 6, padding: "6px 12px", fontSize: 12, cursor: "pointer" },
  link: { color: "#4f46e5", fontSize: 13, alignSelf: "center" },
  err: { color: "#b91c1c", fontSize: 13, marginTop: 8 },
  muted: { color: "#9ca3af", fontSize: 14 },
  card: { border: "1px solid #e5e7eb", borderRadius: 12, padding: 16, marginBottom: 12, background: "#fff" },
  cardHead: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  pill: { fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 10 },
  errNote: { color: "#b45309", fontSize: 12, marginBottom: 8 },
  records: { background: "#f9fafb", borderRadius: 8, padding: 12, marginBottom: 12 },
  recordsLabel: { fontSize: 12, color: "#6b7280", marginBottom: 8 },
  recordRow: { display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" },
  recType: { fontSize: 11, fontWeight: 700, color: "#4f46e5", width: 44 },
  code: { background: "#fff", border: "1px solid #e5e7eb", borderRadius: 4, padding: "2px 6px", fontSize: 12, fontFamily: "monospace" },
  arrow: { color: "#9ca3af" },
  copyBtn: { background: "none", border: "1px solid #e5e7eb", borderRadius: 4, padding: "2px 8px", fontSize: 11, cursor: "pointer" },
  actions: { display: "flex", gap: 8, alignItems: "center" },
};
