import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api.js";
import { useAuth } from "../../auth.js";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Trash2, AlertTriangle, CheckCircle2, Clock, X } from "lucide-react";

interface Member {
  userId: string;
  role: "admin" | "agent";
  name: string;
  email: string;
  avatarUrl: string | null;
}

interface PendingInvite {
  id: string;
  email: string;
  role: "admin" | "agent";
  expiresAt: string;
}

function daysUntil(dateStr: string): number {
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

export default function TeamSettings() {
  const { activeWorkspace } = useAuth();
  const queryClient = useQueryClient();
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "agent">("agent");
  const [invitedEmail, setInvitedEmail] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);

  const isAdmin = activeWorkspace?.role === "admin";

  const { data: members = [], isLoading: membersLoading } = useQuery({
    queryKey: ["team", activeWorkspace?.id],
    queryFn: () => api<Member[]>("/api/team"),
    enabled: !!activeWorkspace,
  });

  const { data: pendingInvites = [] } = useQuery({
    queryKey: ["invites", activeWorkspace?.id],
    queryFn: () => api<PendingInvite[]>("/api/team/invites"),
    enabled: !!activeWorkspace && isAdmin,
  });

  const sendInvite = useMutation({
    mutationFn: ({ email, role }: { email: string; role: "admin" | "agent" }) =>
      api<{ inviteUrl: string }>("/api/team/invites", {
        method: "POST",
        body: JSON.stringify({ email, role }),
      }),
    onSuccess: (_data, variables) => {
      setInvitedEmail(variables.email);
      setInviteEmail("");
      setInviteError(null);
      queryClient.invalidateQueries({ queryKey: ["team", activeWorkspace?.id] });
      queryClient.invalidateQueries({ queryKey: ["invites", activeWorkspace?.id] });
    },
    onError: (err: Error) => {
      setInviteError(err.message);
    },
  });

  const revokeInvite = useMutation({
    mutationFn: (inviteId: string) =>
      api(`/api/team/invites/${inviteId}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invites", activeWorkspace?.id] });
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
    setInvitedEmail(null);
    sendInvite.mutate({ email: inviteEmail.trim(), role: inviteRole });
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
      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Invite a teammate</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <form onSubmit={handleInviteSubmit}>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="colleague@company.com"
                  required
                  className="flex-1"
                />
                <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as "admin" | "agent")}>
                  <SelectTrigger className="w-full sm:w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="agent">Agent</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
                <Button type="submit" disabled={sendInvite.isPending} className="w-full sm:w-auto">
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

            {invitedEmail && (
              <Alert>
                <CheckCircle2 className="size-4 text-green-500" />
                <AlertDescription>
                  Invite sent to <span className="font-medium">{invitedEmail}</span> — they'll receive an email with a link to join.
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      )}

      {/* Pending invites */}
      {isAdmin && pendingInvites.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Pending Invites</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {pendingInvites.map((invite) => {
                const days = daysUntil(invite.expiresAt);
                return (
                  <div
                    key={invite.id}
                    className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-4 py-3"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="flex size-8 items-center justify-center rounded-full bg-muted text-muted-foreground shrink-0">
                        <Clock className="size-3.5" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{invite.email}</p>
                        <p className="text-xs text-muted-foreground">
                          Expires in {days} day{days !== 1 ? "s" : ""}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge variant="secondary" className="capitalize text-xs">
                        {invite.role}
                      </Badge>
                      <Badge variant="outline" className="text-xs text-amber-500 border-amber-500/30 bg-amber-500/5">
                        Pending
                      </Badge>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                        onClick={() => revokeInvite.mutate(invite.id)}
                        disabled={revokeInvite.isPending}
                        title="Revoke invite"
                      >
                        <X className="size-3.5" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Members list */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Members</CardTitle>
        </CardHeader>
        <CardContent>
          {membersLoading ? (
            <p className="text-muted-foreground">Loading…</p>
          ) : members.length === 0 ? (
            <p className="text-muted-foreground">No members yet.</p>
          ) : (
            <div className="space-y-2">
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
                    {isAdmin ? (
                      <>
                        <Select
                          value={m.role}
                          onValueChange={(role) =>
                            changeRole.mutate({ userId: m.userId, role: role as "admin" | "agent" })
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
                      <Badge variant={m.role === "admin" ? "default" : "secondary"} className="capitalize">
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
