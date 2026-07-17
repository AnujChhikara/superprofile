import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api.js";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Copy, Trash2, ExternalLink } from "lucide-react";
import { toast } from "sonner";

interface DnsRecord {
  type: string;
  name: string;
  value: string;
}

interface Domain {
  id: string;
  hostname: string;
  status: "pending_dns" | "verifying" | "active" | "failed";
  error: string | null;
  records: DnsRecord[];
}

const STATUS_CONFIG: Record<string, { variant: "secondary" | "default" | "destructive"; label: string }> = {
  pending_dns: { variant: "secondary", label: "Pending DNS" },
  verifying: { variant: "secondary", label: "Verifying" },
  active: { variant: "default", label: "Active" },
  failed: { variant: "destructive", label: "Failed" },
};

export default function Domains() {
  const qc = useQueryClient();
  const [hostname, setHostname] = useState("");
  const [err, setErr] = useState("");

  const { data: domains = [] } = useQuery<Domain[]>({
    queryKey: ["domains"],
    queryFn: () => api<Domain[]>("/api/domains"),
  });

  const add = useMutation({
    mutationFn: () =>
      api("/api/domains", {
        method: "POST",
        body: JSON.stringify({ hostname }),
      }),
    onSuccess: () => {
      setHostname("");
      setErr("");
      qc.invalidateQueries({ queryKey: ["domains"] });
      toast.success("Domain added");
    },
    onError: (e: Error) => setErr(e.message),
  });

  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: string }) =>
      api(`/api/domains/${id}/${action}`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["domains"] });
      toast.success("Updated");
    },
  });

  const del = useMutation({
    mutationFn: (id: string) => api(`/api/domains/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["domains"] });
      toast.success("Domain removed");
    },
  });

  const copyValue = (value: string) => {
    navigator.clipboard.writeText(value);
    toast.success("Copied to clipboard");
  };

  return (
    <div className="max-w-2xl space-y-8 p-8">
      <div>
        <h1 className="text-2xl font-semibold">Custom Domains</h1>
        <p className="text-muted-foreground">
          Serve your help center from your own domain (e.g. help.yourcompany.com).
        </p>
      </div>

      {/* Add domain form */}
      <div className="flex gap-2">
        <Input
          value={hostname}
          onChange={(e) => setHostname(e.target.value)}
          placeholder="help.yourcompany.com"
          className="flex-1"
        />
        <Button
          disabled={!hostname.trim() || add.isPending}
          onClick={() => add.mutate()}
        >
          Add domain
        </Button>
      </div>

      {err && (
        <Alert variant="destructive">
          <AlertDescription>{err}</AlertDescription>
        </Alert>
      )}

      {/* Domains list */}
      <div className="space-y-4">
        {domains.length === 0 && (
          <p className="text-muted-foreground">No custom domains yet.</p>
        )}

        {domains.map((d) => {
          const st = STATUS_CONFIG[d.status];
          return (
            <Card key={d.id}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg">{d.hostname}</CardTitle>
                  <Badge variant={st.variant}>{st.label}</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {d.error && (
                  <Alert variant="destructive">
                    <AlertDescription>{d.error}</AlertDescription>
                  </Alert>
                )}

                {d.status !== "active" && (
                  <div className="space-y-2 rounded-lg bg-muted p-3">
                    <p className="text-xs font-semibold text-muted-foreground">
                      Add these DNS records:
                    </p>
                    <div className="space-y-2">
                      {d.records.map((r) => (
                        <div key={r.type} className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="w-10 font-bold text-primary">{r.type}</span>
                          <code className="rounded border border-border bg-background px-2 py-1">
                            {r.name}
                          </code>
                          <span className="text-muted-foreground">→</span>
                          <code className="flex-1 rounded border border-border bg-background px-2 py-1">
                            {r.value}
                          </code>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="size-6"
                            onClick={() => copyValue(r.value)}
                          >
                            <Copy className="size-3" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  {d.status !== "active" && (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => act.mutate({ id: d.id, action: "verify" })}
                        disabled={act.isPending}
                      >
                        {d.status === "verifying" ? "Check status" : "Verify"}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => act.mutate({ id: d.id, action: "simulate" })}
                        disabled={act.isPending}
                        title="Demo mode: mark active without real DNS/cert"
                      >
                        Simulate (demo)
                      </Button>
                    </>
                  )}
                  {d.status === "active" && (
                    <Button
                      size="sm"
                      variant="outline"
                      asChild
                    >
                      <a href={`https://${d.hostname}`} target="_blank" rel="noreferrer">
                        Open
                        <ExternalLink className="ml-1 size-3" />
                      </a>
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => del.mutate(d.id)}
                    disabled={del.isPending}
                  >
                    <Trash2 className="size-3" />
                    Remove
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
