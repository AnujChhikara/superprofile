import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api.js";
import { useAuth } from "../auth.js";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldGroup, Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle } from "lucide-react";

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
    if (!name.trim()) return;
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
            A workspace is where your team handles customer support. You can
            invite team members after setup.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="wsName">Workspace name</FieldLabel>
                <Input
                  id="wsName"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Acme Corp Support"
                  autoFocus
                  required
                />
              </Field>
            </FieldGroup>

            {error && (
              <Alert variant="destructive">
                <AlertTriangle className="size-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <Button
              type="submit"
              className="w-full"
              disabled={createWorkspace.isPending || !name.trim()}
            >
              {createWorkspace.isPending ? "Creating…" : "Create workspace →"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
