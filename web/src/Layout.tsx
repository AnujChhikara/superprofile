import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "./auth.js";

export default function Layout() {
  const { user, workspaces, activeWorkspace, setActiveWorkspace } = useAuth();

  return (
    <div style={styles.root}>
      {/* Sidebar */}
      <aside style={styles.sidebar}>
        {/* Logo */}
        <div style={styles.logo}>
          <span style={styles.logoIcon}>💬</span>
          <span style={styles.logoName}>SuperProfile</span>
        </div>

        {/* Workspace selector */}
        {workspaces.length > 0 && (
          <div style={styles.workspaceSection}>
            <select
              value={activeWorkspace?.id ?? ""}
              onChange={(e) => {
                const ws = workspaces.find((w) => w.id === e.target.value);
                if (ws) setActiveWorkspace(ws);
              }}
              style={styles.workspaceSelect}
            >
              {workspaces.map((ws) => (
                <option key={ws.id} value={ws.id}>
                  {ws.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Nav */}
        <nav style={styles.nav}>
          <NavLink to="/inbox" style={navStyle} end>
            <span style={styles.navIcon}>📥</span>
            Inbox
          </NavLink>
          <NavLink to="/knowledge" style={navStyle}>
            <span style={styles.navIcon}>📚</span>
            Knowledge Base
          </NavLink>
          <NavLink to="/settings/team" style={navStyle}>
            <span style={styles.navIcon}>⚙️</span>
            Settings
          </NavLink>
          <NavLink to="/settings/domains" style={navStyle}>
            <span style={styles.navIcon}>🌐</span>
            Domains
          </NavLink>
        </nav>

        {/* User info at bottom */}
        <div style={styles.userSection}>
          {user?.avatarUrl ? (
            <img src={user.avatarUrl} alt={user.name} style={styles.avatar} />
          ) : (
            <div style={styles.avatarPlaceholder}>
              {user?.name?.charAt(0)?.toUpperCase() ?? "?"}
            </div>
          )}
          <div style={styles.userInfo}>
            <div style={styles.userName}>{user?.name}</div>
            <div style={styles.userEmail}>{user?.email}</div>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main style={styles.main}>
        <Outlet />
      </main>
    </div>
  );
}

function navStyle({ isActive }: { isActive: boolean }): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "9px 14px",
    borderRadius: 7,
    fontSize: 14,
    fontWeight: isActive ? 600 : 400,
    color: isActive ? "#4f46e5" : "#374151",
    background: isActive ? "#eef2ff" : "transparent",
    textDecoration: "none",
    transition: "background 0.12s, color 0.12s",
  };
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    display: "flex",
    height: "100vh",
    overflow: "hidden",
    fontFamily: "system-ui, -apple-system, sans-serif",
  },
  sidebar: {
    width: 240,
    flexShrink: 0,
    borderRight: "1px solid #e5e7eb",
    display: "flex",
    flexDirection: "column",
    background: "#fafafa",
    padding: "16px 12px",
    boxSizing: "border-box",
    overflow: "auto",
  },
  logo: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "4px 6px 20px",
    borderBottom: "1px solid #e5e7eb",
    marginBottom: 16,
  },
  logoIcon: {
    fontSize: 22,
  },
  logoName: {
    fontSize: 16,
    fontWeight: 700,
    color: "#111827",
    letterSpacing: "-0.3px",
  },
  workspaceSection: {
    marginBottom: 16,
  },
  workspaceSelect: {
    width: "100%",
    padding: "8px 10px",
    border: "1px solid #e5e7eb",
    borderRadius: 7,
    fontSize: 13,
    color: "#374151",
    background: "#fff",
    cursor: "pointer",
    boxSizing: "border-box",
  },
  nav: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    flex: 1,
  },
  navIcon: {
    fontSize: 16,
    flexShrink: 0,
  },
  userSection: {
    marginTop: 16,
    paddingTop: 16,
    borderTop: "1px solid #e5e7eb",
    display: "flex",
    alignItems: "center",
    gap: 10,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: "50%",
    objectFit: "cover",
    flexShrink: 0,
  },
  avatarPlaceholder: {
    width: 32,
    height: 32,
    borderRadius: "50%",
    background: "#e0e7ff",
    color: "#4f46e5",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 13,
    fontWeight: 700,
    flexShrink: 0,
  },
  userInfo: {
    overflow: "hidden",
  },
  userName: {
    fontSize: 13,
    fontWeight: 600,
    color: "#111827",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  userEmail: {
    fontSize: 11,
    color: "#9ca3af",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  main: {
    flex: 1,
    overflow: "auto",
    background: "#f9fafb",
  },
};
