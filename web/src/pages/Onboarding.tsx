import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api.js";
import { useAuth } from "../auth.js";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle, Mail } from "lucide-react";

interface Workspace {
  id: string;
  name: string;
  slug: string;
  publicKey: string;
}

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .replace(/__+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

const PARSE_DOMAIN = "parse.anujchhikara.com";
const NAME_REGEX = /^[a-zA-Z0-9 _]*$/;

export default function Onboarding() {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { setActiveWorkspace, refetch } = useAuth();
  const queryClient = useQueryClient();

  const slug = toSlug(name);
  const previewEmail = slug ? `${slug}@${PARSE_DOMAIN}` : null;
  const isInvalid = name.length > 0 && !NAME_REGEX.test(name);

  const createWorkspace = useMutation({
    mutationFn: (wsName: string) =>
      api<Workspace>("/api/workspaces", {
        method: "POST",
        body: JSON.stringify({ name: wsName }),
      }),
    onSuccess: (ws) => {
      setActiveWorkspace({ id: ws.id, name: ws.name, slug: ws.slug, role: "admin" });
      queryClient.invalidateQueries({ queryKey: ["me"] });
      refetch();
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || isInvalid) return;
    setError(null);
    createWorkspace.mutate(name.trim());
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="mb-4 block text-4xl">🚀</div>
          <CardTitle className="text-2xl">Create your workspace</CardTitle>
          <CardDescription>
            Your workspace name becomes your support email address.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="wsName">Workspace name</Label>
              <Input
                id="wsName"
                type="text"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setError(null);
                }}
                placeholder="e.g. Acme_Corp"
                autoFocus
                required
                className={isInvalid ? "border-destructive" : ""}
              />
              {isInvalid && (
                <p className="text-xs text-destructive">
                  Only letters, numbers, spaces, and underscores allowed.
                </p>
              )}
              {previewEmail && !isInvalid && (
                <div className="flex items-center gap-2 rounded-md bg-muted px-3 py-2">
                  <Mail className="size-3.5 shrink-0 text-muted-foreground" />
                  <p className="text-xs text-muted-foreground break-all">
                    Your support email:{" "}
                    <span className="font-medium text-foreground">{previewEmail}</span>
                  </p>
                </div>
              )}
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertTriangle className="size-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <Button
              type="submit"
              className="w-full"
              disabled={createWorkspace.isPending || !name.trim() || isInvalid}
            >
              {createWorkspace.isPending ? "Creating…" : "Create workspace →"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
