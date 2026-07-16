const API_BASE = import.meta.env.VITE_API_ORIGIN ?? "http://localhost:3000";

export default function Login() {
  const handleGoogleLogin = () => {
    window.location.href = `${API_BASE}/api/auth/google`;
  };

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <div style={styles.logo}>
          <span style={styles.logoIcon}>💬</span>
          <span style={styles.logoText}>SuperProfile</span>
        </div>
        <h1 style={styles.heading}>Welcome back</h1>
        <p style={styles.subheading}>
          Sign in to your customer support workspace
        </p>
        <button onClick={handleGoogleLogin} style={styles.googleBtn}>
          <svg width="18" height="18" viewBox="0 0 18 18" style={{ marginRight: 10 }}>
            <path
              fill="#4285F4"
              d="M16.51 8H8.98v3h4.3c-.18 1-.74 1.48-1.6 2.04v2.01h2.6a7.8 7.8 0 002.38-5.88c0-.57-.05-.66-.15-1.18z"
            />
            <path
              fill="#34A853"
              d="M8.98 17c2.16 0 3.97-.72 5.3-1.94l-2.6-2a4.8 4.8 0 01-7.18-2.54H1.83v2.07A8 8 0 008.98 17z"
            />
            <path
              fill="#FBBC05"
              d="M4.5 10.52a4.8 4.8 0 010-3.04V5.41H1.83a8 8 0 000 7.18l2.67-2.07z"
            />
            <path
              fill="#EA4335"
              d="M8.98 4.18c1.17 0 2.23.4 3.06 1.2l2.3-2.3A8 8 0 001.83 5.4L4.5 7.49a4.77 4.77 0 014.48-3.3z"
            />
          </svg>
          Continue with Google
        </button>
        <p style={styles.footer}>
          By signing in you agree to our Terms of Service and Privacy Policy.
        </p>
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
    maxWidth: 400,
    textAlign: "center",
    boxSizing: "border-box",
  },
  logo: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginBottom: 24,
  },
  logoIcon: {
    fontSize: 28,
  },
  logoText: {
    fontSize: 22,
    fontWeight: 700,
    color: "#111827",
    letterSpacing: "-0.5px",
  },
  heading: {
    margin: "0 0 8px",
    fontSize: 24,
    fontWeight: 600,
    color: "#111827",
    letterSpacing: "-0.3px",
  },
  subheading: {
    margin: "0 0 32px",
    fontSize: 14,
    color: "#6b7280",
    lineHeight: 1.5,
  },
  googleBtn: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
    padding: "12px 20px",
    border: "1px solid #e5e7eb",
    borderRadius: 8,
    background: "#fff",
    fontSize: 15,
    fontWeight: 500,
    color: "#374151",
    cursor: "pointer",
    transition: "background 0.15s, border-color 0.15s",
    boxSizing: "border-box",
  },
  footer: {
    marginTop: 24,
    fontSize: 12,
    color: "#9ca3af",
    lineHeight: 1.5,
  },
};
