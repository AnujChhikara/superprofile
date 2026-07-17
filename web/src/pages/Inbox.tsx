import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api.js";
import { useAuth } from "../auth.js";
import { getSocket } from "../lib/socket.js";
import { cn } from "@/lib/utils";
import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Avatar,
  AvatarFallback,
  Badge,
  Card,
  CardContent,
  ScrollArea,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  Tabs,
  TabsList,
  TabsTrigger,
  Textarea,
  Separator,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui";
import { MessageCircle, Mail, ChevronDown, Zap } from "lucide-react";

// ------------------------------------------------------------------
// Realtime: subscribe the socket to the query cache. Returns per-conversation
// typing + contact-read state plus a helper to emit the agent's typing.
// ------------------------------------------------------------------
function useInboxRealtime(workspaceId: string | null) {
  const queryClient = useQueryClient();
  const [typingByConv, setTypingByConv] = useState<Record<string, boolean>>({});
  const [readSeqByConv, setReadSeqByConv] = useState<Record<string, number>>({});
  const socketRef = useRef<ReturnType<typeof getSocket> | null>(null);
  const typingTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    if (!workspaceId) return;
    const socket = getSocket(workspaceId);
    socketRef.current = socket;

    const onMessageNew = (p: { conversationId: string; message: Message }) => {
      queryClient.setQueryData<Message[]>(
        ["messages", p.conversationId],
        (old) => {
          if (!old) return old; // thread not open/loaded — list refetch covers it
          if (old.some((m) => m.id === p.message.id)) return old; // dedupe
          return [...old, p.message];
        }
      );
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
    };

    const onConvUpdated = (p: { conversation: Conversation }) => {
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
      queryClient.invalidateQueries({
        queryKey: ["conversation", p.conversation.id],
      });
    };

    const onTyping = (p: {
      conversationId: string;
      senderType: "contact" | "agent";
      isTyping: boolean;
    }) => {
      if (p.senderType !== "contact") return; // only surface the visitor typing
      setTypingByConv((s) => ({ ...s, [p.conversationId]: p.isTyping }));
      // Auto-clear a stuck "typing" after 4s in case the stop event is lost.
      clearTimeout(typingTimers.current[p.conversationId]);
      if (p.isTyping) {
        typingTimers.current[p.conversationId] = setTimeout(() => {
          setTypingByConv((s) => ({ ...s, [p.conversationId]: false }));
        }, 4000);
      }
    };

    const onRead = (p: {
      conversationId: string;
      senderType: "contact" | "agent";
      upToSeq: number;
    }) => {
      // senderType "contact" here means the visitor read the agent's messages.
      if (p.senderType !== "contact") return;
      setReadSeqByConv((s) => ({
        ...s,
        [p.conversationId]: Math.max(s[p.conversationId] ?? 0, p.upToSeq),
      }));
    };

    const onSummary = (p: { conversationId: string }) => {
      queryClient.invalidateQueries({
        queryKey: ["summary", p.conversationId],
      });
    };

    const onReconnect = () => {
      // Refetch to close any gap while disconnected (no dupes: refetch replaces).
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
      queryClient.invalidateQueries({ queryKey: ["messages"] });
    };

    socket.on("message:new", onMessageNew);
    socket.on("conversation:updated", onConvUpdated);
    socket.on("typing", onTyping);
    socket.on("read", onRead);
    socket.on("summary:updated", onSummary);
    socket.io.on("reconnect", onReconnect);

    return () => {
      socket.off("message:new", onMessageNew);
      socket.off("conversation:updated", onConvUpdated);
      socket.off("typing", onTyping);
      socket.off("read", onRead);
      socket.off("summary:updated", onSummary);
      socket.io.off("reconnect", onReconnect);
    };
  }, [workspaceId, queryClient]);

  const emitTyping = useCallback(
    (conversationId: string, isTyping: boolean) => {
      socketRef.current?.emit("typing", { conversationId, isTyping });
    },
    []
  );

  const joinConversation = useCallback((conversationId: string) => {
    socketRef.current?.emit("join", { conversationId });
  }, []);

  return { typingByConv, readSeqByConv, emitTyping, joinConversation };
}

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------
interface Contact {
  id: string;
  email: string | null;
  name: string | null;
  visitorToken: string | null;
  lastSeenAt: string | null;
  createdAt: string;
}

interface Conversation {
  id: string;
  workspaceId: string;
  contactId: string;
  channel: "chat" | "email";
  status: "open" | "snoozed" | "resolved";
  assigneeId: string | null;
  subject: string | null;
  snoozedUntil: string | null;
  lastMessageAt: string;
  createdAt: string;
  contact: Contact | null;
  lastMessageBody: string | null;
  unreadCount: number;
}

interface Message {
  id: string;
  conversationId: string;
  senderType: "contact" | "agent" | "system";
  senderId: string | null;
  body: string;
  seq: number;
  readAt: string | null;
  createdAt: string;
}

interface TeamMember {
  userId: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  role: "admin" | "agent";
}

interface CannedResponse {
  id: string;
  title: string;
  body: string;
}

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------
function formatTime(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString();
}

// ------------------------------------------------------------------
// Left pane: conversation list
// ------------------------------------------------------------------
interface ConvListProps {
  channel: "all" | "chat" | "email";
  status: "open" | "snoozed" | "resolved";
  assigneeFilter: "all" | "mine" | "unassigned";
  selectedId: string | null;
  onSelect: (id: string) => void;
  userId: string;
  team: TeamMember[];
}

function ConversationList({
  channel,
  status,
  assigneeFilter,
  selectedId,
  onSelect,
  userId,
  team,
}: ConvListProps) {
  const params = new URLSearchParams();
  if (channel !== "all") params.set("channel", channel);
  params.set("status", status);
  if (assigneeFilter === "mine") params.set("assignee", userId);
  else if (assigneeFilter === "unassigned") params.set("assignee", "unassigned");

  const { data: conversations = [], isLoading } = useQuery<Conversation[]>({
    queryKey: ["conversations", channel, status, assigneeFilter],
    queryFn: () => api<Conversation[]>(`/api/conversations?${params}`),
  });

  if (isLoading) {
    return (
      <ScrollArea className="flex-1">
        <div className="flex flex-col items-center justify-center p-6">
          <span className="text-sm text-muted-foreground">Loading...</span>
        </div>
      </ScrollArea>
    );
  }

  if (conversations.length === 0) {
    return (
      <ScrollArea className="flex-1">
        <div className="flex flex-col items-center justify-center p-6">
          <span className="text-sm text-muted-foreground">No conversations</span>
        </div>
      </ScrollArea>
    );
  }

  return (
    <ScrollArea className="flex-1">
      <div className="flex flex-col">
        {conversations.map((conv) => (
          <button
            key={conv.id}
            onClick={() => onSelect(conv.id)}
            className={cn(
              "flex flex-col gap-1 border-b px-3.5 py-3 text-left transition-colors hover:bg-muted",
              selectedId === conv.id && "bg-muted border-l-2 border-l-primary"
            )}
          >
            {/* Row: channel icon, name, unread badge */}
            <div className="flex items-center gap-2">
              <span className="text-xs flex-shrink-0">
                {conv.channel === "chat" ? (
                  <MessageCircle className="size-3.5" />
                ) : (
                  <Mail className="size-3.5" />
                )}
              </span>
              <span className="flex-1 truncate text-sm font-semibold text-foreground">
                {conv.contact?.name ?? conv.contact?.email ?? "Unknown"}
              </span>
              {conv.unreadCount > 0 && (
                <Badge variant="default" className="flex-shrink-0 text-xs">
                  {conv.unreadCount}
                </Badge>
              )}
            </div>

            {/* Preview: truncated last message */}
            <div className="truncate text-xs text-muted-foreground">
              {conv.lastMessageBody
                ? conv.lastMessageBody.slice(0, 60) +
                  (conv.lastMessageBody.length > 60 ? "…" : "")
                : "No messages yet"}
            </div>

            {/* Meta: status badge, assignee, time */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 min-w-0">
                <Badge
                  variant={
                    conv.status === "open"
                      ? "default"
                      : conv.status === "snoozed"
                      ? "secondary"
                      : "outline"
                  }
                  className="text-xs shrink-0"
                >
                  {conv.status}
                </Badge>
                {conv.assigneeId && (() => {
                  const agent = team.find((m) => m.userId === conv.assigneeId);
                  return agent ? (
                    <span className="text-xs text-muted-foreground truncate">
                      {agent.name.split(" ")[0]}
                    </span>
                  ) : null;
                })()}
              </div>
              <span className="text-xs text-muted-foreground shrink-0">
                {formatTime(conv.lastMessageAt)}
              </span>
            </div>
          </button>
        ))}
      </div>
    </ScrollArea>
  );
}

// ------------------------------------------------------------------
// Middle pane: thread + composer
// ------------------------------------------------------------------
interface ThreadPaneProps {
  conversationId: string;
  userId: string;
  onConversationUpdated: () => void;
  contactTyping: boolean;
  contactReadSeq: number;
  emitTyping: (conversationId: string, isTyping: boolean) => void;
  joinConversation: (conversationId: string) => void;
}

function ThreadPane({
  conversationId,
  userId,
  onConversationUpdated,
  contactTyping,
  contactReadSeq,
  emitTyping,
  joinConversation,
}: ThreadPaneProps) {
  const [draft, setDraft] = useState("");
  const queryClient = useQueryClient();
  const bottomRef = useRef<HTMLDivElement>(null);
  const typingStopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTypingRef = useRef(false);

  const { data: messages = [] } = useQuery<Message[]>({
    queryKey: ["messages", conversationId],
    queryFn: () => api<Message[]>(`/api/conversations/${conversationId}/messages`),
  });

  const { data: convMeta } = useQuery<Conversation & { contact: Contact | null }>({
    queryKey: ["conversation", conversationId],
    queryFn: () => api<Conversation & { contact: Contact | null }>(`/api/conversations/${conversationId}`),
  });

  const { data: canned = [] } = useQuery<CannedResponse[]>({
    queryKey: ["canned"],
    queryFn: () => api<CannedResponse[]>("/api/canned"),
  });
  // Typing "/" at the start opens a filterable canned-response picker.
  const cannedMatches =
    draft.startsWith("/")
      ? canned.filter((c) =>
          c.title.toLowerCase().includes(draft.slice(1).toLowerCase())
        )
      : [];

  const draftMutation = useMutation({
    mutationFn: () =>
      api<{ draft: string }>(`/api/conversations/${conversationId}/draft`, {
        method: "POST",
      }),
    onSuccess: (r) => setDraft(r.draft),
  });

  // Join the conversation room + mark as read when opened.
  useEffect(() => {
    joinConversation(conversationId);
    api(`/api/conversations/${conversationId}/read`, { method: "POST" }).catch(
      () => {}
    );
    queryClient.invalidateQueries({ queryKey: ["conversations"] });
  }, [conversationId, queryClient, joinConversation]);

  // Scroll to bottom when messages change or the contact starts typing.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, contactTyping]);

  // Stop broadcasting "typing" when the thread changes or unmounts.
  useEffect(() => {
    return () => {
      if (isTypingRef.current) {
        emitTyping(conversationId, false);
        isTypingRef.current = false;
      }
      if (typingStopTimer.current) clearTimeout(typingStopTimer.current);
    };
  }, [conversationId, emitTyping]);

  const sendMutation = useMutation({
    mutationFn: (body: string) =>
      api(`/api/conversations/${conversationId}/messages`, {
        method: "POST",
        body: JSON.stringify({ body }),
      }),
    onSuccess: () => {
      setDraft("");
      // Stop the typing indicator immediately on send.
      if (isTypingRef.current) {
        emitTyping(conversationId, false);
        isTypingRef.current = false;
      }
      queryClient.invalidateQueries({ queryKey: ["messages", conversationId] });
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
      onConversationUpdated();
    },
  });

  function handleDraftChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setDraft(e.target.value);
    // Emit "typing: true" on first keystroke, debounce "false" 2s after the last.
    if (!isTypingRef.current) {
      emitTyping(conversationId, true);
      isTypingRef.current = true;
    }
    if (typingStopTimer.current) clearTimeout(typingStopTimer.current);
    typingStopTimer.current = setTimeout(() => {
      emitTyping(conversationId, false);
      isTypingRef.current = false;
    }, 2000);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (draft.trim()) {
        sendMutation.mutate(draft.trim());
      }
    }
  }

  // The highest agent-message seq the contact has read → renders ✓✓.
  const contact = convMeta?.contact;
  const contactName = contact?.name ?? contact?.email ?? "Unknown";
  const contactInitial = contactName.charAt(0).toUpperCase();

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Thread header */}
      <div className="flex items-center gap-3 border-b px-4 py-3 shrink-0">
        <div className="flex size-8 items-center justify-center rounded-full bg-muted text-muted-foreground text-sm font-medium shrink-0">
          {contactInitial}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold truncate">{contactName}</p>
          {contact?.email && contact?.name && (
            <p className="text-xs text-muted-foreground truncate">{contact.email}</p>
          )}
        </div>
        {convMeta?.channel && (
          <div className="ml-auto shrink-0">
            {convMeta.channel === "chat"
              ? <MessageCircle className="size-4 text-muted-foreground" />
              : <Mail className="size-4 text-muted-foreground" />
            }
          </div>
        )}
      </div>

      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-2 px-4 py-4">
          {messages.map((msg) => (
            <MessageBubble
              key={msg.id}
              message={msg}
              userId={userId}
              readByContact={
                msg.senderType === "agent" && msg.seq <= contactReadSeq
              }
            />
          ))}
          {contactTyping && (
            <div className="flex justify-start">
              <div className="bg-muted text-muted-foreground rounded-2xl rounded-tl-none px-3.5 py-2.5 text-sm italic">
                typing…
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      {/* Canned response picker (type "/" to open) */}
      {draft.startsWith("/") && cannedMatches.length > 0 && (
        <div className="border-t max-h-[180px] overflow-y-auto bg-background">
          {cannedMatches.slice(0, 6).map((c) => (
            <button
              key={c.id}
              onClick={() => setDraft(c.body)}
              className="flex flex-col w-full text-left gap-0.5 px-4 py-2 border-b bg-background hover:bg-muted transition-colors"
            >
              <span className="text-sm font-semibold text-primary">
                {c.title}
              </span>
              <span className="text-xs text-muted-foreground truncate">
                {c.body.slice(0, 60)}
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="border-t px-4 py-3 flex gap-2 bg-background">
        <Textarea
          value={draft}
          onChange={handleDraftChange}
          onKeyDown={handleKeyDown}
          placeholder="Type a reply… ( / for canned, Enter to send )"
          disabled={sendMutation.isPending}
          className="min-h-[72px] flex-1 resize-none"
        />
        <div className="flex flex-col gap-1.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                onClick={() => draftMutation.mutate()}
                disabled={draftMutation.isPending}
                variant="outline"
                size="sm"
                className="text-xs"
              >
                {draftMutation.isPending ? "…" : <Zap className="size-3.5 mr-1" />}
                {!draftMutation.isPending && "Draft"}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              AI draft grounded in the summary + knowledge base
            </TooltipContent>
          </Tooltip>
          <Button
            onClick={() => draft.trim() && sendMutation.mutate(draft.trim())}
            disabled={!draft.trim() || sendMutation.isPending}
            size="sm"
            className="text-xs"
          >
            Send
          </Button>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({
  message,
  userId,
  readByContact,
}: {
  message: Message;
  userId: string;
  readByContact?: boolean;
}) {
  const isAgent =
    message.senderType === "agent" && message.senderId === userId;
  const isOwnAgent = message.senderType === "agent";
  const isSystem = message.senderType === "system";

  if (isSystem) {
    return (
      <div className="flex justify-center py-1">
        <Badge variant="secondary" className="text-xs">
          {message.body}
        </Badge>
      </div>
    );
  }

  return (
    <div className={cn("flex gap-2", isAgent ? "justify-end" : "justify-start")}>
      {!isAgent && (
        <div className="flex size-6 items-center justify-center rounded-full bg-muted text-muted-foreground text-xs font-medium shrink-0 mt-1">
          ?
        </div>
      )}
      <div className={cn("flex flex-col max-w-[65%]", isAgent ? "items-end" : "items-start")}>
        <div
          className={cn(
            "rounded-2xl px-3.5 py-2.5 text-sm whitespace-pre-wrap break-words",
            isAgent
              ? "bg-primary/90 text-primary-foreground rounded-br-sm"
              : "bg-secondary text-secondary-foreground rounded-bl-sm"
          )}
        >
          {message.body}
        </div>
        <span className="text-[11px] text-muted-foreground mt-1 px-1">
          {formatTime(message.createdAt)}
          {isOwnAgent && (
            <span className="ml-1 opacity-70">
              {readByContact ? "✓✓" : "✓"}
            </span>
          )}
        </span>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
// Right pane: contact info + actions
// ------------------------------------------------------------------
interface DetailPaneProps {
  conversationId: string;
  onUpdated: () => void;
}

interface SummaryResp {
  summary: { body: string; messageCount: number; updatedAt: string } | null;
  messageCount: number;
  stale?: boolean;
}

function SummaryCard({ conversationId }: { conversationId: string }) {
  const queryClient = useQueryClient();
  const { data } = useQuery<SummaryResp>({
    queryKey: ["summary", conversationId],
    queryFn: () =>
      api<SummaryResp>(`/api/conversations/${conversationId}/summary`),
  });
  const regenerate = useMutation({
    mutationFn: () =>
      api(`/api/conversations/${conversationId}/summary/regenerate`, {
        method: "POST",
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["summary", conversationId] }),
  });

  return (
    <div className="px-4 pb-4">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          AI Summary
        </span>
        {data?.summary && data.stale && (
          <Badge variant="secondary" className="text-xs">
            may be out of date
          </Badge>
        )}
      </div>
      {data?.summary ? (
        <>
          <Card className="mb-2">
            <CardContent className="pt-3 text-sm text-foreground whitespace-pre-wrap">
              {data.summary.body}
            </CardContent>
          </Card>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>updated {formatTime(data.summary.updatedAt)}</span>
            <Button
              onClick={() => regenerate.mutate()}
              disabled={regenerate.isPending}
              variant="link"
              size="sm"
              className="text-xs p-0 h-auto"
            >
              {regenerate.isPending ? "…" : "Regenerate"}
            </Button>
          </div>
        </>
      ) : (
        <div className="text-xs text-muted-foreground space-y-2">
          <p>
            {(data?.messageCount ?? 0) < 6
              ? "Summary appears after a few messages."
              : "No summary yet."}
          </p>
          {(data?.messageCount ?? 0) >= 6 && (
            <Button
              onClick={() => regenerate.mutate()}
              disabled={regenerate.isPending}
              variant="outline"
              size="sm"
              className="text-xs w-full"
            >
              {regenerate.isPending ? "…" : "Generate"}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function DetailPane({ conversationId, onUpdated }: DetailPaneProps) {
  const queryClient = useQueryClient();
  const [snoozeMenuOpen, setSnoozeMenuOpen] = useState(false);

  const { data: conv } = useQuery<Conversation & { contact: Contact | null }>({
    queryKey: ["conversation", conversationId],
    queryFn: () =>
      api<Conversation & { contact: Contact | null }>(
        `/api/conversations/${conversationId}`
      ),
  });

  const { data: team = [] } = useQuery<TeamMember[]>({
    queryKey: ["team"],
    queryFn: () => api<TeamMember[]>("/api/team"),
  });

  const patchMutation = useMutation({
    mutationFn: (patch: Record<string, unknown>) =>
      api(`/api/conversations/${conversationId}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["conversation", conversationId] });
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
      onUpdated();
    },
  });

  function snooze(ms: number) {
    const until = new Date(Date.now() + ms).toISOString();
    patchMutation.mutate({ status: "snoozed", snoozedUntil: until });
    setSnoozeMenuOpen(false);
  }

  function snoozeUntilTomorrow9am() {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    patchMutation.mutate({ status: "snoozed", snoozedUntil: d.toISOString() });
    setSnoozeMenuOpen(false);
  }

  if (!conv) {
    return (
      <ScrollArea className="flex-1">
        <div className="p-6 text-muted-foreground text-sm">
          Loading...
        </div>
      </ScrollArea>
    );
  }

  return (
    <ScrollArea className="flex-1">
      <div className="flex flex-col">
        {/* Contact card */}
        <div className="flex items-center gap-2.5 px-4 pb-4">
          <Avatar className="size-10 flex-shrink-0">
            <AvatarFallback className="bg-primary/10 text-primary">
              {(conv.contact?.name ?? conv.contact?.email ?? "?")
                .charAt(0)
                .toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-foreground truncate">
              {conv.contact?.name ?? "Unknown"}
            </div>
            {conv.contact?.email && (
              <div className="text-xs text-muted-foreground truncate">
                {conv.contact.email}
              </div>
            )}
          </div>
        </div>

        <Separator className="mb-3" />

        {/* AI summary */}
        <SummaryCard conversationId={conversationId} />

        <Separator className="mt-2 mb-3" />

        {/* Status actions */}
        <div className="px-4 pb-4">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            Status
          </div>
          <div className="flex gap-1.5 flex-wrap">
            {conv.status !== "resolved" ? (
              <Button
                onClick={() => patchMutation.mutate({ status: "resolved" })}
                disabled={patchMutation.isPending}
                size="sm"
                className="text-xs"
              >
                Resolve
              </Button>
            ) : (
              <Button
                onClick={() => patchMutation.mutate({ status: "open" })}
                disabled={patchMutation.isPending}
                variant="outline"
                size="sm"
                className="text-xs"
              >
                Reopen
              </Button>
            )}

            {/* Snooze dropdown menu */}
            <DropdownMenu open={snoozeMenuOpen} onOpenChange={setSnoozeMenuOpen}>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs"
                >
                  Snooze
                  <ChevronDown className="size-3 ml-1" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-40">
                <DropdownMenuItem onClick={() => snooze(60 * 60 * 1000)}>
                  1 hour
                </DropdownMenuItem>
                <DropdownMenuItem onClick={snoozeUntilTomorrow9am}>
                  Tomorrow 9am
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    const custom = prompt(
                      "Enter snooze date/time (ISO format, e.g. 2025-01-01T09:00:00)"
                    );
                    if (custom) {
                      patchMutation.mutate({
                        status: "snoozed",
                        snoozedUntil: custom,
                      });
                    }
                    setSnoozeMenuOpen(false);
                  }}
                >
                  Custom...
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <Separator className="mb-3" />

        {/* Assignee */}
        <div className="px-4 pb-4">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            Assignee
          </div>
          <Select
            value={conv.assigneeId ?? ""}
            onValueChange={(value: string) =>
              patchMutation.mutate({ assigneeId: value || null })
            }
          >
            <SelectTrigger className="w-full text-sm h-9">
              <SelectValue placeholder="Unassigned" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">Unassigned</SelectItem>
              {team.map((m) => (
                <SelectItem key={m.userId} value={m.userId}>
                  {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Separator className="mb-3" />

        {/* Conv info */}
        <div className="px-4 pb-4">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            Details
          </div>
          <div className="space-y-2 text-xs">
            <div className="grid grid-cols-2 gap-1">
              <span className="text-muted-foreground">Channel</span>
              <span className="text-foreground font-medium flex items-center gap-1 justify-end">
                {conv.channel === "chat" ? (
                  <MessageCircle className="size-3 shrink-0" />
                ) : (
                  <Mail className="size-3 shrink-0" />
                )}
                <span className="capitalize">{conv.channel}</span>
              </span>
            </div>
            {conv.subject && (
              <div className="grid grid-cols-2 gap-1">
                <span className="text-muted-foreground">Subject</span>
                <span className="text-foreground font-medium text-right break-words">
                  {conv.subject}
                </span>
              </div>
            )}
            {conv.snoozedUntil && (
              <div className="grid grid-cols-2 gap-1">
                <span className="text-muted-foreground">Snoozed</span>
                <span className="text-foreground font-medium text-right">
                  {new Date(conv.snoozedUntil).toLocaleDateString()}
                </span>
              </div>
            )}
            <div className="grid grid-cols-2 gap-1">
              <span className="text-muted-foreground">Created</span>
              <span className="text-foreground font-medium text-right">
                {new Date(conv.createdAt).toLocaleDateString()}
              </span>
            </div>
          </div>
        </div>
      </div>
    </ScrollArea>
  );
}

// ------------------------------------------------------------------
// Main Inbox page
// ------------------------------------------------------------------
export default function Inbox() {
  const { user, activeWorkspace } = useAuth();
  const queryClient = useQueryClient();

  const { typingByConv, readSeqByConv, emitTyping, joinConversation } =
    useInboxRealtime(activeWorkspace?.id ?? null);

  const [channelTab, setChannelTab] = useState<"all" | "chat" | "email">("all");
  const [statusFilter, setStatusFilter] = useState<
    "open" | "snoozed" | "resolved"
  >("open");
  const [assigneeFilter, setAssigneeFilter] = useState<
    "all" | "mine" | "unassigned"
  >("all");
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null);

  const { data: team = [] } = useQuery<TeamMember[]>({
    queryKey: ["team"],
    queryFn: () => api<TeamMember[]>("/api/team"),
    enabled: !!activeWorkspace,
  });

  const handleConversationUpdated = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["conversations"] });
    if (selectedConvId) {
      queryClient.invalidateQueries({
        queryKey: ["conversation", selectedConvId],
      });
    }
  }, [queryClient, selectedConvId]);

  if (!user) return null;

  return (
    <div className="flex flex-1 overflow-hidden bg-background">
      {/* Left pane: filters + conversation list */}
      <div className="w-72 flex-shrink-0 border-r border-border flex flex-col bg-background overflow-hidden">
        {/* Channel tabs */}
        <Tabs
          value={channelTab}
          onValueChange={(val: string) => setChannelTab(val as "all" | "chat" | "email")}
          className="w-full border-b border-border"
        >
          <TabsList className="w-full justify-start rounded-none bg-transparent border-b-0 gap-0.5 px-3 py-2.5">
            <TabsTrigger value="all" className="text-xs px-3 h-7">
              All
            </TabsTrigger>
            <TabsTrigger value="chat" className="text-xs gap-1.5 px-3 h-7">
              <MessageCircle className="size-3" />
              Chat
            </TabsTrigger>
            <TabsTrigger value="email" className="text-xs gap-1.5 px-3 h-7">
              <Mail className="size-3" />
              Email
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {/* Filter row */}
        <div className="flex gap-2 px-3 py-2.5 border-b border-border">
          <Select
            value={statusFilter}
            onValueChange={(val: string) =>
              setStatusFilter(val as "open" | "snoozed" | "resolved")
            }
          >
            <SelectTrigger className="h-8 flex-1 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="snoozed">Snoozed</SelectItem>
              <SelectItem value="resolved">Resolved</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={assigneeFilter}
            onValueChange={(val: string) =>
              setAssigneeFilter(val as "all" | "mine" | "unassigned")
            }
          >
            <SelectTrigger className="h-8 flex-1 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Agents</SelectItem>
              <SelectItem value="mine">Mine</SelectItem>
              <SelectItem value="unassigned">Unassigned</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Conversation list */}
        <ConversationList
          channel={channelTab}
          status={statusFilter}
          assigneeFilter={assigneeFilter}
          selectedId={selectedConvId}
          onSelect={setSelectedConvId}
          userId={user.id}
          team={team}
        />
      </div>

      {/* Middle pane: thread */}
      <div className="flex-1 flex flex-col overflow-hidden bg-background">
        {selectedConvId ? (
          <ThreadPane
            key={selectedConvId}
            conversationId={selectedConvId}
            userId={user.id}
            onConversationUpdated={handleConversationUpdated}
            contactTyping={!!typingByConv[selectedConvId]}
            contactReadSeq={readSeqByConv[selectedConvId] ?? 0}
            emitTyping={emitTyping}
            joinConversation={joinConversation}
          />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center">
            <MessageCircle className="size-10 mb-3 text-muted-foreground" />
            <div className="text-sm text-muted-foreground">
              Select a conversation to start
            </div>
          </div>
        )}
      </div>

      {/* Right pane: detail */}
      <div className="w-72 flex-shrink-0 border-l border-border flex flex-col overflow-hidden bg-muted/50">
        {selectedConvId ? (
          <DetailPane
            key={selectedConvId}
            conversationId={selectedConvId}
            onUpdated={handleConversationUpdated}
          />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center">
            <div className="text-xs text-muted-foreground">No selection</div>
          </div>
        )}
      </div>
    </div>
  );
}
