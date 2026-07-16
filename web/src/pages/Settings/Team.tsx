import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api.js";
import { useAuth } from "../../auth.js";

interface Member {
  userId: string;
  role: "admin" | "agent";
  name: string;
  email: string;
  avatarUrl: string | null;
}

export default function TeamSettings() {
  const { activeWorkspace } = useAuth();
  const queryClient = useQueryClient();
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "agent">("agent");
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const { data: members = [], isLoading } = useQuery({
    queryKey: ["team", activeWorkspace?.id],
    queryFn: () => api<Member[]>("/api/team"),
    enabled: !!activeWorkspace,
  });

  const sendInvite = useMutation({
    mutationFn: ({ email, role }: { email: string; role: "admin" | "agent" }) =>
      api<{ inviteUrl: string }>("/api/team/invites", {
        method: "POST",
        body: JSON.stringify({ email, role }),
      }),
    onSuccess: (data) => {
      setInviteUrl(data.inviteUrl);
      setInviteEmail("");
      setInviteError(null);
      queryClient.invalidateQueries({ queryKey: ["team", activeWorkspace?.id] });
    },
    onError: (err: Error) => {
      setInviteError(err.message);
    },
  });

  const changeRole = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: "admin" | "agent" }) =>
      api(`/api/team/members/${userId}`, {
        method: "PATCH",
        body: JSON.stringify({ role }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["team", activeWorkspace?.id] });
    },
  });

  const removeMember = useMutation({
    mutationFn: (userId: string) =>
      api(`/api/team/members/${userId}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["team", activeWorkspace?.id] });
    },
  });

  const handleInviteSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    setInviteError(null);
    setInviteUrl(null);
    sendInvite.mutate({ email: inviteEmail.trim(), role: inviteRole });
  };

  const copyLink = () => {
    if (!inviteUrl) return;
    navigator.clipboard.writeText(inviteUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  if (!activeWorkspace) {
    return <p style={{ padding: 24 }}>No active workspace selected.</p>;
  }

  return (
    <div style={styles.page}>
      <h2 style={styles.heading}>Team</h2>
      <p style={styles.sub}>Manage your workspace members and invites.</p>

      {/* Invite form */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>Invite a teammate</h3>
        <form onSubmit={handleInviteSubmit} style={styles.inviteForm}>
          <input
            type="email"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            placeholder="colleague@company.com"
            style={styles.emailInput}
            required
          />
          <select
            value={inviteRole}
            onChange={(e) => setInviteRole(e.target.value as "admin" | "agent")}
            style={styles.roleSelect}
          >
            <option value="agent">Agent</option>
            <option value="admin">Admin</option>
          </select>
          <button
            type="submit"
            style={styles.inviteBtn}
            disabled={sendInvite.isPending}
          >
            {sendInvite.isPending ? "Sending…" : "Send invite"}
          </button>
        </form>

        {inviteError && <p style={styles.error}>{inviteError}</p>}

        {inviteUrl && (
          <div style={styles.inviteUrlBox}>
            <p style={styles.inviteUrlLabel}>Invite link (share this link):</p>
            <div style={styles.inviteUrlRow}>
              <code style={styles.inviteUrlCode}>{inviteUrl}</code>
              <button onClick={copyLink} style={styles.copyBtn}>
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Members list */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>Members</h3>
        {isLoading ? (
          <p style={styles.muted}>Loading…</p>
        ) : members.length === 0 ? (
          <p style={styles.muted}>No members yet.</p>
        ) : (
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Name</th>
                <th style={styles.th}>Email</th>
                <th style={styles.th}>Role</th>
                {activeWorkspace.role === "admin" && (
                  <th style={styles.th}>Actions</th>
                )}
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.userId} style={styles.tr}>
                  <td style={styles.td}>
                    <div style={styles.nameCell}>
                      {m.avatarUrl ? (
                        <img
                          src={m.avatarUrl}
                          alt={m.name}
                          style={styles.avatar}
                        />
                      ) : (
                        <div style={styles.avatarPlaceholder}>
                          {m.name.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <span>{m.name}</span>
                    </div>
                  </td>
                  <td style={styles.td}>{m.email}</td>
                  <td style={styles.td}>
                    {activeWorkspace.role === "admin" ? (
                      <select
                        value={m.role}
                        onChange={(e) =>
                          changeRole.mutate({
                            userId: m.userId,
                            role: e.target.value as "admin" | "agent",
                          })
                        }
                        style={styles.roleSelectInline}
                      >
                        <option value="agent">Agent</option>
                        <option value="admin">Admin</option>
                      </select>
                    ) : (
                      <span style={styles.roleBadge(m.role)}>{m.role}</span>
                    )}
                  </td>
                  {activeWorkspace.role === "admin" && (
                    <td style={styles.td}>
                      <button
                        onClick={() => removeMember.mutate(m.userId)}
                        style={styles.removeBtn}
                        disabled={removeMember.isPending}
                      >
                        Remove
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

type RoleKey = "admin" | "agent";

const styles = {
  page: {
    padding: "32px 40px",
    maxWidth: 800,
    fontFamily: "system-ui, -apple-system, sans-serif",
  } satisfies React.CSSProperties,
  heading: {
    margin: "0 0 4px",
    fontSize: 22,
    fontWeight: 600,
    color: "#111827",
  } satisfies React.CSSProperties,
  sub: {
    margin: "0 0 32px",
    fontSize: 14,
    color: "#6b7280",
  } satisfies React.CSSProperties,
  section: {
    marginBottom: 40,
    background: "#fff",
    border: "1px solid #e5e7eb",
    borderRadius: 10,
    padding: "24px 28px",
  } satisfies React.CSSProperties,
  sectionTitle: {
    margin: "0 0 16px",
    fontSize: 15,
    fontWeight: 600,
    color: "#374151",
  } satisfies React.CSSProperties,
  inviteForm: {
    display: "flex",
    gap: 10,
    flexWrap: "wrap" as const,
  } satisfies React.CSSProperties,
  emailInput: {
    flex: "1 1 200px",
    padding: "9px 14px",
    border: "1px solid #e5e7eb",
    borderRadius: 7,
    fontSize: 14,
    outline: "none",
    color: "#111827",
  } satisfies React.CSSProperties,
  roleSelect: {
    padding: "9px 12px",
    border: "1px solid #e5e7eb",
    borderRadius: 7,
    fontSize: 14,
    color: "#374151",
    background: "#fff",
    cursor: "pointer",
  } satisfies React.CSSProperties,
  inviteBtn: {
    padding: "9px 18px",
    background: "#4f46e5",
    color: "#fff",
    border: "none",
    borderRadius: 7,
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
  } satisfies React.CSSProperties,
  error: {
    marginTop: 10,
    color: "#ef4444",
    fontSize: 13,
  } satisfies React.CSSProperties,
  inviteUrlBox: {
    marginTop: 16,
    background: "#f9fafb",
    border: "1px solid #e5e7eb",
    borderRadius: 7,
    padding: "12px 16px",
  } satisfies React.CSSProperties,
  inviteUrlLabel: {
    margin: "0 0 6px",
    fontSize: 12,
    fontWeight: 500,
    color: "#6b7280",
  } satisfies React.CSSProperties,
  inviteUrlRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
  } satisfies React.CSSProperties,
  inviteUrlCode: {
    fontSize: 12,
    color: "#374151",
    wordBreak: "break-all" as const,
    flex: 1,
  } satisfies React.CSSProperties,
  copyBtn: {
    flexShrink: 0,
    padding: "5px 12px",
    border: "1px solid #e5e7eb",
    borderRadius: 6,
    background: "#fff",
    fontSize: 12,
    cursor: "pointer",
    color: "#374151",
    fontWeight: 500,
  } satisfies React.CSSProperties,
  table: {
    width: "100%",
    borderCollapse: "collapse" as const,
    fontSize: 14,
  } satisfies React.CSSProperties,
  th: {
    textAlign: "left" as const,
    padding: "8px 12px",
    borderBottom: "1px solid #e5e7eb",
    fontSize: 12,
    fontWeight: 600,
    color: "#6b7280",
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
  } satisfies React.CSSProperties,
  tr: {
    borderBottom: "1px solid #f3f4f6",
  } satisfies React.CSSProperties,
  td: {
    padding: "12px 12px",
    color: "#374151",
    verticalAlign: "middle" as const,
  } satisfies React.CSSProperties,
  nameCell: {
    display: "flex",
    alignItems: "center",
    gap: 10,
  } satisfies React.CSSProperties,
  avatar: {
    width: 28,
    height: 28,
    borderRadius: "50%",
    objectFit: "cover" as const,
  } satisfies React.CSSProperties,
  avatarPlaceholder: {
    width: 28,
    height: 28,
    borderRadius: "50%",
    background: "#e0e7ff",
    color: "#4f46e5",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 12,
    fontWeight: 600,
    flexShrink: 0,
  } satisfies React.CSSProperties,
  roleSelectInline: {
    padding: "4px 8px",
    border: "1px solid #e5e7eb",
    borderRadius: 5,
    fontSize: 13,
    color: "#374151",
    background: "#fff",
    cursor: "pointer",
  } satisfies React.CSSProperties,
  roleBadge: (role: RoleKey): React.CSSProperties => ({
    display: "inline-block",
    padding: "2px 8px",
    borderRadius: 12,
    fontSize: 12,
    fontWeight: 500,
    background: role === "admin" ? "#e0e7ff" : "#f0fdf4",
    color: role === "admin" ? "#4f46e5" : "#16a34a",
  }),
  removeBtn: {
    padding: "4px 10px",
    border: "1px solid #fecaca",
    borderRadius: 5,
    background: "#fff",
    color: "#ef4444",
    fontSize: 12,
    cursor: "pointer",
  } satisfies React.CSSProperties,
  muted: {
    color: "#9ca3af",
    fontSize: 14,
    margin: 0,
  } satisfies React.CSSProperties,
};
