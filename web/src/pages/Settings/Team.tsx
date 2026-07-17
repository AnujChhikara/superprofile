import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api.js";
import { useAuth } from "../../auth.js";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldGroup, Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Copy, Trash2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

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
      toast.success("Invite link copied!");
    });
  };

  if (!activeWorkspace) {
    return <p className="p-6">No active workspace selected.</p>;
  }

  return (
    <div className="max-w-3xl space-y-8 p-8">
      <div>
        <h1 className="text-2xl font-semibold">Team</h1>
        <p className="text-muted-foreground">Manage your workspace members and invites.</p>
      </div>

      {/* Invite form */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Invite a teammate</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={handleInviteSubmit} className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row">
              <FieldGroup className="flex-1">
                <Field>
                  <Input
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="colleague@company.com"
                    required
                  />
                </Field>
              </FieldGroup>
              <FieldGroup className="min-w-max">
                <Field>
                  <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as "admin" | "agent")}>
                    <SelectTrigger className="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="agent">Agent</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              </FieldGroup>
              <Button type="submit" disabled={sendInvite.isPending}>
                {sendInvite.isPending ? "Sending…" : "Send invite"}
              </Button>
            </div>
          </form>

          {inviteError && (
            <Alert variant="destructive">
              <AlertTriangle className="size-4" />
              <AlertDescription>{inviteError}</AlertDescription>
            </Alert>
          )}

          {inviteUrl && (
            <Alert>
              <AlertDescription className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground">
                  Invite link (share this link):
                </p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 break-all rounded bg-muted p-2 text-xs">
                    {inviteUrl}
                  </code>
                  <Button size="sm" variant="outline" onClick={copyLink}>
                    <Copy className="size-3" />
                  </Button>
                </div>
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Members list */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Members</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-muted-foreground">Loading…</p>
          ) : members.length === 0 ? (
            <p className="text-muted-foreground">No members yet.</p>
          ) : (
            <div className="space-y-3">
              {members.map((m) => (
                <div key={m.userId} className="flex items-center justify-between rounded-lg border p-4">
                  <div className="flex items-center gap-3">
                    <Avatar className="size-8">
                      <AvatarImage src={m.avatarUrl || ""} alt={m.name} />
                      <AvatarFallback>{m.name.charAt(0).toUpperCase()}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{m.name}</p>
                      <p className="truncate text-xs text-muted-foreground">{m.email}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {activeWorkspace.role === "admin" ? (
                      <>
                        <Select
                          value={m.role}
                          onValueChange={(role) =>
                            changeRole.mutate({
                              userId: m.userId,
                              role: role as "admin" | "agent",
                            })
                          }
                        >
                          <SelectTrigger className="w-24">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="agent">Agent</SelectItem>
                            <SelectItem value="admin">Admin</SelectItem>
                          </SelectContent>
                        </Select>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="text-destructive hover:bg-destructive/10"
                          onClick={() => removeMember.mutate(m.userId)}
                          disabled={removeMember.isPending}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </>
                    ) : (
                      <Badge variant={m.role === "admin" ? "default" : "secondary"}>
                        {m.role}
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
