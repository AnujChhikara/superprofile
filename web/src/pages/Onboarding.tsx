import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api.js";
import { useAuth } from "../auth.js";

interface Workspace {
  id: string;
  name: string;
  slug: string;
  publicKey: string;
}

export default function Onboarding() {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { setActiveWorkspace, refetch } = useAuth();
  const queryClient = useQueryClient();

  const createWorkspace = useMutation({
    mutationFn: (wsName: string) =>
      api<Workspace>("/api/workspaces", {
        method: "POST",
        body: JSON.stringify({ name: wsName }),
      }),
    onSuccess: (ws) => {
      // Set as active workspace
      setActiveWorkspace({ id: ws.id, name: ws.name, slug: ws.slug, role: "admin" });
      // Invalidate /me so workspaces list updates
      queryClient.invalidateQueries({ queryKey: ["me"] });
      refetch();
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setError(null);
    createWorkspace.mutate(name.trim());
  };

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <div style={styles.header}>
          <span style={styles.emoji}>🚀</span>
          <h1 style={styles.heading}>Create your workspace</h1>
          <p style={styles.sub}>
            A workspace is where your team handles customer support. You can
            invite team members after setup.
          </p>
        </div>

        <form onSubmit={handleSubmit} style={styles.form}>
          <div style={styles.field}>
            <label htmlFor="wsName" style={styles.label}>
              Workspace name
            </label>
            <input
              id="wsName"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Acme Corp Support"
              style={styles.input}
              autoFocus
              required
            />
          </div>

          {error && <p style={styles.error}>{error}</p>}

          <button
            type="submit"
            style={{
              ...styles.btn,
              opacity: createWorkspace.isPending ? 0.7 : 1,
            }}
            disabled={createWorkspace.isPending || !name.trim()}
          >
            {createWorkspace.isPending ? "Creating…" : "Create workspace →"}
          </button>
        </form>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#f9fafb",
    fontFamily: "system-ui, -apple-system, sans-serif",
  },
  card: {
    background: "#fff",
    borderRadius: 12,
    padding: "48px 40px",
    boxShadow: "0 4px 24px rgba(0,0,0,0.08)",
    width: "100%",
    maxWidth: 440,
    boxSizing: "border-box",
  },
  header: {
    textAlign: "center",
    marginBottom: 32,
  },
  emoji: {
    fontSize: 36,
    display: "block",
    marginBottom: 12,
  },
  heading: {
    margin: "0 0 8px",
    fontSize: 24,
    fontWeight: 600,
    color: "#111827",
    letterSpacing: "-0.3px",
  },
  sub: {
    margin: 0,
    fontSize: 14,
    color: "#6b7280",
    lineHeight: 1.6,
  },
  form: {
    display: "flex",
    flexDirection: "column",
    gap: 16,
  },
  field: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  label: {
    fontSize: 13,
    fontWeight: 500,
    color: "#374151",
  },
  input: {
    padding: "10px 14px",
    border: "1px solid #e5e7eb",
    borderRadius: 8,
    fontSize: 15,
    outline: "none",
    color: "#111827",
    boxSizing: "border-box",
    width: "100%",
  },
  error: {
    margin: 0,
    color: "#ef4444",
    fontSize: 13,
  },
  btn: {
    padding: "12px 20px",
    background: "#4f46e5",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    fontSize: 15,
    fontWeight: 600,
    cursor: "pointer",
    width: "100%",
  },
};
