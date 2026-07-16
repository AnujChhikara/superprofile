import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../auth.js";

export default function InviteAccept() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { user, isLoading, refetch, setActiveWorkspace, workspaces } = useAuth();
  const [status, setStatus] = useState<"idle" | "accepting" | "done" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (isLoading) return;

    // Not logged in: redirect to login with invite in query
    if (!user) {
      const API_BASE = import.meta.env.VITE_API_ORIGIN ?? "http://localhost:3000";
      window.location.href = `${API_BASE}/api/auth/google?invite=${token}`;
      return;
    }

    if (status !== "idle") return;

    // Accept the invite
    setStatus("accepting");
    api<{ ok: boolean; workspaceId: string }>(`/api/invites/${token}/accept`, {
      method: "POST",
    })
      .then((data) => {
        refetch();
        // Wait a tick for refetch to populate workspaces, then navigate
        setTimeout(() => {
          const ws = workspaces.find((w) => w.id === data.workspaceId);
          if (ws) setActiveWorkspace(ws);
          setStatus("done");
          navigate("/inbox", { replace: true });
        }, 600);
      })
      .catch((err: Error) => {
        setStatus("error");
        setErrorMsg(err.message);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, user, token]);

  if (isLoading || status === "idle" || status === "accepting") {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <p style={styles.text}>Accepting invite…</p>
          <div style={styles.spinner} />
        </div>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <p style={styles.errorText}>Failed to accept invite</p>
          <p style={styles.errorDetail}>{errorMsg}</p>
          <button onClick={() => navigate("/")} style={styles.btn}>
            Go home
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <p style={styles.text}>Invite accepted! Redirecting…</p>
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
    fontFamily: "system-ui, -apple-system, sans-serif",
    background: "#f9fafb",
  },
  card: {
    background: "#fff",
    borderRadius: 12,
    padding: "48px 40px",
    boxShadow: "0 4px 24px rgba(0,0,0,0.08)",
    textAlign: "center",
    minWidth: 300,
  },
  text: {
    fontSize: 16,
    color: "#374151",
    margin: 0,
  },
  errorText: {
    fontSize: 16,
    fontWeight: 600,
    color: "#ef4444",
    margin: "0 0 8px",
  },
  errorDetail: {
    fontSize: 14,
    color: "#6b7280",
    margin: "0 0 20px",
  },
  btn: {
    padding: "10px 20px",
    background: "#4f46e5",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    fontSize: 14,
    cursor: "pointer",
    fontWeight: 500,
  },
  spinner: {
    margin: "20px auto 0",
    width: 28,
    height: 28,
    border: "3px solid #e5e7eb",
    borderTop: "3px solid #4f46e5",
    borderRadius: "50%",
    animation: "spin 0.8s linear infinite",
  },
};
