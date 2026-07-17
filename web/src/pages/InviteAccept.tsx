import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../auth.js";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle } from "lucide-react";

export default function InviteAccept() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { user, isLoading, refetch, setActiveWorkspace, workspaces } = useAuth();
  const [status, setStatus] = useState<"idle" | "accepting" | "done" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [acceptedWsId, setAcceptedWsId] = useState<string | null>(null);

  // Step 1: accept the invite (or bounce to login) once auth state is known
  useEffect(() => {
    if (isLoading) return;

    // Not logged in: redirect to login with invite in query
    if (!user) {
      const API_BASE = import.meta.env.VITE_API_ORIGIN ?? "http://localhost:3000";
      window.location.href = `${API_BASE}/api/auth/google?invite=${token}`;
      return;
    }

    if (status !== "idle") return;

    setStatus("accepting");
    api<{ ok: boolean; workspaceId: string }>(`/api/invites/${token}/accept`, {
      method: "POST",
    })
      .then((data) => {
        setAcceptedWsId(data.workspaceId);
        refetch();
      })
      .catch((err: Error) => {
        setStatus("error");
        setErrorMsg(err.message);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, user, token]);

  // Step 2: once the refetched workspaces list contains the accepted
  // workspace, activate it and navigate — no fixed sleeps.
  useEffect(() => {
    if (!acceptedWsId || status === "done") return;
    const ws = workspaces.find((w) => w.id === acceptedWsId);
    if (!ws) return;
    setActiveWorkspace(ws);
    setStatus("done");
    navigate("/inbox", { replace: true });
  }, [acceptedWsId, workspaces, status, setActiveWorkspace, navigate]);

  if (isLoading || status === "idle" || status === "accepting") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Card className="w-full max-w-sm">
          <CardContent className="flex flex-col items-center gap-4 pt-6">
            <p className="text-base text-foreground">Accepting invite…</p>
            <Skeleton className="size-8 rounded-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Card className="w-full max-w-sm">
          <CardContent className="flex flex-col gap-4 pt-6">
            <Alert variant="destructive">
              <AlertTriangle className="size-4" />
              <AlertDescription className="ml-2">
                Failed to accept invite
              </AlertDescription>
            </Alert>
            <p className="text-sm text-muted-foreground">{errorMsg}</p>
            <Button onClick={() => navigate("/")} className="w-full">
              Go home
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <Card className="w-full max-w-sm">
        <CardContent className="pt-6">
          <p className="text-center text-base text-foreground">
            Invite accepted! Redirecting…
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
