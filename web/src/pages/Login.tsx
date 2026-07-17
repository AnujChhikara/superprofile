import { Button } from "@/components/ui/button";
import { Inbox, Sparkles, BookOpen } from "lucide-react";

const API_BASE = import.meta.env.VITE_API_ORIGIN ?? "http://localhost:3000";

const FEATURES = [
  { icon: Inbox, label: "Inbox" },
  { icon: Sparkles, label: "AI Drafts" },
  { icon: BookOpen, label: "Knowledge Base" },
] as const;

export default function Login() {
  const handleGoogleLogin = () => {
    window.location.href = `${API_BASE}/api/auth/google`;
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4">
      {/* Indigo radial spotlight — the signature atmospheric element */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 70% 55% at 50% 38%, oklch(0.511 0.229 277 / 0.22) 0%, transparent 70%)",
        }}
      />

      <div className="relative z-10 w-full max-w-md">
        {/* Card */}
        <div
          className="rounded-2xl border bg-card p-8"
          style={{
            borderColor: "oklch(1 0 0 / 0.07)",
            boxShadow: "0 8px 40px -8px oklch(0 0 0 / 0.4), 0 0 0 1px oklch(1 0 0 / 0.04)",
          }}
        >
          {/* Logo mark */}
          <div className="mb-7 flex items-center gap-2.5">
            <div
              className="flex size-8 items-center justify-center rounded-lg text-sm font-bold text-white"
              style={{ background: "oklch(0.60 0.22 277)" }}
            >
              S
            </div>
            <span className="text-base font-semibold tracking-tight text-foreground">
              SuperProfile
            </span>
          </div>

          {/* Feature pills — shows what the product is before asking to sign in */}
          <div className="mb-6 flex flex-wrap gap-2">
            {FEATURES.map(({ icon: Icon, label }) => (
              <span
                key={label}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-3 py-1 text-xs font-medium text-muted-foreground"
              >
                <Icon className="size-3" />
                {label}
              </span>
            ))}
          </div>

          {/* Headline */}
          <h1 className="mb-2 text-[1.6rem] font-semibold leading-tight tracking-tight text-foreground">
            Your support team's<br />command center
          </h1>
          <p className="mb-8 text-sm leading-relaxed text-muted-foreground">
            Handle every customer conversation in one place — real-time inbox,
            AI‑assisted replies, and a knowledge base your whole team can trust.
          </p>

          {/* Divider with label */}
          <div className="relative mb-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-border" />
            </div>
            <div className="relative flex justify-center">
              <span
                className="px-3 text-xs text-muted-foreground"
                style={{ background: "oklch(0.18 0.014 277)" }}
              >
                sign in to continue
              </span>
            </div>
          </div>

          {/* Google sign-in */}
          <Button
            onClick={handleGoogleLogin}
            variant="outline"
            className="h-12 w-full gap-3 cursor-pointer text-sm"
          >
            <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden>
              <path fill="#4285F4" d="M16.51 8H8.98v3h4.3c-.18 1-.74 1.48-1.6 2.04v2.01h2.6a7.8 7.8 0 002.38-5.88c0-.57-.05-.66-.15-1.18z" />
              <path fill="#34A853" d="M8.98 17c2.16 0 3.97-.72 5.3-1.94l-2.6-2a4.8 4.8 0 01-7.18-2.54H1.83v2.07A8 8 0 008.98 17z" />
              <path fill="#FBBC05" d="M4.5 10.52a4.8 4.8 0 010-3.04V5.41H1.83a8 8 0 000 7.18l2.67-2.07z" />
              <path fill="#EA4335" d="M8.98 4.18c1.17 0 2.23.4 3.06 1.2l2.3-2.3A8 8 0 001.83 5.4L4.5 7.49a4.77 4.77 0 014.48-3.3z" />
            </svg>
            Continue with Google
          </Button>

          {/* Legal */}
          <p className="mt-5 text-center text-xs text-muted-foreground">
            By continuing you agree to our{" "}
            <a href="#" className="underline underline-offset-2 transition-colors hover:text-foreground">
              Terms
            </a>{" "}
            and{" "}
            <a href="#" className="underline underline-offset-2 transition-colors hover:text-foreground">
              Privacy Policy
            </a>
            .
          </p>
        </div>
      </div>
    </div>
  );
}
