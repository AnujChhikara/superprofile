import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api.js";

interface Canned {
  id: string;
  title: string;
  body: string;
}

export default function CannedResponses() {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  const { data: items = [] } = useQuery<Canned[]>({
    queryKey: ["canned"],
    queryFn: () => api<Canned[]>("/api/canned"),
  });

  const create = useMutation({
    mutationFn: () =>
      api("/api/canned", {
        method: "POST",
        body: JSON.stringify({ title, body }),
      }),
    onSuccess: () => {
      setTitle("");
      setBody("");
      qc.invalidateQueries({ queryKey: ["canned"] });
    },
  });

  const del = useMutation({
    mutationFn: (id: string) => api(`/api/canned/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["canned"] }),
  });

  return (
    <div style={S.wrap}>
      <h2 style={S.h2}>Canned Responses</h2>
      <p style={S.sub}>
        Save reusable replies. In the inbox composer, type <code>/</code> to insert one.
      </p>

      <div style={S.form}>
        <input
          style={S.input}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title (e.g. Refund policy)"
        />
        <textarea
          style={S.textarea}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Response text…"
        />
        <button
          style={S.primary}
          disabled={!title.trim() || !body.trim() || create.isPending}
          onClick={() => create.mutate()}
        >
          Add response
        </button>
      </div>

      <div style={{ marginTop: 24 }}>
        {items.length === 0 && <div style={S.muted}>No canned responses yet.</div>}
        {items.map((c) => (
          <div key={c.id} style={S.card}>
            <div style={S.cardHead}>
              <strong>{c.title}</strong>
              <button style={S.danger} onClick={() => del.mutate(c.id)}>
                Delete
              </button>
            </div>
            <div style={S.body}>{c.body}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  wrap: { padding: "32px 40px", maxWidth: 680, fontFamily: "system-ui, sans-serif" },
  h2: { margin: "0 0 4px", fontSize: 22, fontWeight: 600, color: "#111827" },
  sub: { margin: "0 0 20px", color: "#6b7280", fontSize: 14 },
  form: { display: "flex", flexDirection: "column", gap: 8 },
  input: { padding: "9px 12px", border: "1px solid #e5e7eb", borderRadius: 8, fontSize: 14 },
  textarea: { padding: "9px 12px", border: "1px solid #e5e7eb", borderRadius: 8, fontSize: 14, minHeight: 80, resize: "vertical", fontFamily: "inherit" },
  primary: { alignSelf: "flex-start", background: "#4f46e5", color: "#fff", border: "none", borderRadius: 8, padding: "9px 16px", fontWeight: 600, fontSize: 13, cursor: "pointer" },
  muted: { color: "#9ca3af", fontSize: 14 },
  card: { border: "1px solid #e5e7eb", borderRadius: 12, padding: 16, marginBottom: 12, background: "#fff" },
  cardHead: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  body: { fontSize: 13, color: "#374151", whiteSpace: "pre-wrap" },
  danger: { background: "#fef2f2", color: "#b91c1c", border: "1px solid #fecaca", borderRadius: 6, padding: "4px 10px", fontSize: 12, cursor: "pointer" },
};
