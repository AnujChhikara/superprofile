import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api.js";
import { useAuth } from "../auth.js";

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

function channelIcon(channel: "chat" | "email") {
  return channel === "chat" ? "💬" : "✉️";
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
}

function ConversationList({
  channel,
  status,
  assigneeFilter,
  selectedId,
  onSelect,
  userId,
}: ConvListProps) {
  const params = new URLSearchParams();
  if (channel !== "all") params.set("channel", channel);
  params.set("status", status);
  if (assigneeFilter === "mine") params.set("assignee", userId);
  else if (assigneeFilter === "unassigned") params.set("assignee", "unassigned");

  const { data: conversations = [], isLoading } = useQuery<Conversation[]>({
    queryKey: ["conversations", channel, status, assigneeFilter],
    queryFn: () => api<Conversation[]>(`/api/conversations?${params}`),
    refetchInterval: 10000,
  });

  if (isLoading) {
    return (
      <div style={styles.listEmpty}>
        <span style={{ color: "#9ca3af", fontSize: 13 }}>Loading...</span>
      </div>
    );
  }

  if (conversations.length === 0) {
    return (
      <div style={styles.listEmpty}>
        <span style={{ color: "#9ca3af", fontSize: 13 }}>No conversations</span>
      </div>
    );
  }

  return (
    <div style={styles.list}>
      {conversations.map((conv) => (
        <div
          key={conv.id}
          onClick={() => onSelect(conv.id)}
          style={{
            ...styles.convItem,
            background: selectedId === conv.id ? "#eef2ff" : "transparent",
            borderLeft:
              selectedId === conv.id
                ? "3px solid #4f46e5"
                : "3px solid transparent",
          }}
        >
          <div style={styles.convRow}>
            <span style={styles.chanIcon}>{channelIcon(conv.channel)}</span>
            <span style={styles.convName}>
              {conv.contact?.name ?? conv.contact?.email ?? "Unknown"}
            </span>
            {conv.unreadCount > 0 && (
              <span style={styles.unreadDot}>{conv.unreadCount}</span>
            )}
          </div>
          <div style={styles.convPreview}>
            {conv.lastMessageBody
              ? conv.lastMessageBody.slice(0, 60) +
                (conv.lastMessageBody.length > 60 ? "…" : "")
              : "No messages yet"}
          </div>
          <div style={styles.convMeta}>
            <span
              style={{
                ...styles.statusBadge,
                background:
                  conv.status === "open"
                    ? "#dcfce7"
                    : conv.status === "snoozed"
                    ? "#fef9c3"
                    : "#f3f4f6",
                color:
                  conv.status === "open"
                    ? "#166534"
                    : conv.status === "snoozed"
                    ? "#854d0e"
                    : "#6b7280",
              }}
            >
              {conv.status}
            </span>
            <span style={styles.convTime}>{formatTime(conv.lastMessageAt)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------
// Middle pane: thread + composer
// ------------------------------------------------------------------
interface ThreadPaneProps {
  conversationId: string;
  userId: string;
  onConversationUpdated: () => void;
}

function ThreadPane({
  conversationId,
  userId,
  onConversationUpdated,
}: ThreadPaneProps) {
  const [draft, setDraft] = useState("");
  const queryClient = useQueryClient();
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data: messages = [] } = useQuery<Message[]>({
    queryKey: ["messages", conversationId],
    queryFn: () => api<Message[]>(`/api/conversations/${conversationId}/messages`),
    refetchInterval: 10000,
  });

  // Mark as read when conversation is opened
  useEffect(() => {
    api(`/api/conversations/${conversationId}/read`, { method: "POST" }).catch(
      () => {}
    );
    // Invalidate conversation list to update unread count
    queryClient.invalidateQueries({ queryKey: ["conversations"] });
  }, [conversationId, queryClient]);

  // Scroll to bottom when messages change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const sendMutation = useMutation({
    mutationFn: (body: string) =>
      api(`/api/conversations/${conversationId}/messages`, {
        method: "POST",
        body: JSON.stringify({ body }),
      }),
    onSuccess: () => {
      setDraft("");
      queryClient.invalidateQueries({ queryKey: ["messages", conversationId] });
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
      onConversationUpdated();
    },
  });

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (draft.trim()) {
        sendMutation.mutate(draft.trim());
      }
    }
  }

  return (
    <div style={styles.threadPane}>
      <div style={styles.thread}>
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} userId={userId} />
        ))}
        <div ref={bottomRef} />
      </div>
      <div style={styles.composer}>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a reply… (Enter to send, Shift+Enter for newline)"
          style={styles.composerTextarea}
          disabled={sendMutation.isPending}
        />
        <button
          onClick={() => draft.trim() && sendMutation.mutate(draft.trim())}
          disabled={!draft.trim() || sendMutation.isPending}
          style={{
            ...styles.sendBtn,
            opacity: !draft.trim() || sendMutation.isPending ? 0.5 : 1,
          }}
        >
          Send
        </button>
      </div>
    </div>
  );
}

function MessageBubble({
  message,
  userId,
}: {
  message: Message;
  userId: string;
}) {
  const isAgent =
    message.senderType === "agent" && message.senderId === userId;
  const isSystem = message.senderType === "system";

  if (isSystem) {
    return (
      <div style={styles.systemMsg}>
        {/* Use textContent approach - React renders text safely by default */}
        <span style={styles.systemMsgText}>{message.body}</span>
      </div>
    );
  }

  return (
    <div
      style={{
        ...styles.bubbleWrap,
        justifyContent: isAgent ? "flex-end" : "flex-start",
      }}
    >
      <div
        style={{
          ...styles.bubble,
          background: isAgent ? "#4f46e5" : "#f3f4f6",
          color: isAgent ? "#fff" : "#111827",
          borderRadius: isAgent
            ? "16px 16px 4px 16px"
            : "16px 16px 16px 4px",
          maxWidth: "70%",
        }}
      >
        {/* React's default text rendering escapes content — never dangerouslySetInnerHTML */}
        <p style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
          {message.body}
        </p>
        <span
          style={{
            fontSize: 10,
            opacity: 0.6,
            marginTop: 4,
            display: "block",
          }}
        >
          {formatTime(message.createdAt)}
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

function DetailPane({ conversationId, onUpdated }: DetailPaneProps) {
  const queryClient = useQueryClient();
  const [snoozeMenuOpen, setSnoozeMenuOpen] = useState(false);

  const { data: conv } = useQuery<Conversation & { contact: Contact | null }>({
    queryKey: ["conversation", conversationId],
    queryFn: () =>
      api<Conversation & { contact: Contact | null }>(
        `/api/conversations/${conversationId}`
      ),
    refetchInterval: 10000,
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
      <div style={styles.detailPane}>
        <div style={{ padding: 24, color: "#9ca3af", fontSize: 13 }}>
          Loading...
        </div>
      </div>
    );
  }

  return (
    <div style={styles.detailPane}>
      {/* Contact card */}
      <div style={styles.contactCard}>
        <div style={styles.contactAvatar}>
          {(conv.contact?.name ?? conv.contact?.email ?? "?")
            .charAt(0)
            .toUpperCase()}
        </div>
        <div>
          <div style={styles.contactName}>
            {conv.contact?.name ?? "Unknown"}
          </div>
          {conv.contact?.email && (
            <div style={styles.contactEmail}>{conv.contact.email}</div>
          )}
        </div>
      </div>

      <div style={styles.divider} />

      {/* Status actions */}
      <div style={styles.section}>
        <div style={styles.sectionLabel}>Status</div>
        <div style={styles.actionRow}>
          {conv.status !== "resolved" ? (
            <button
              onClick={() => patchMutation.mutate({ status: "resolved" })}
              style={styles.btnPrimary}
              disabled={patchMutation.isPending}
            >
              Resolve
            </button>
          ) : (
            <button
              onClick={() => patchMutation.mutate({ status: "open" })}
              style={styles.btnSecondary}
              disabled={patchMutation.isPending}
            >
              Reopen
            </button>
          )}

          {/* Snooze menu */}
          <div style={{ position: "relative" }}>
            <button
              onClick={() => setSnoozeMenuOpen((v) => !v)}
              style={styles.btnSecondary}
            >
              Snooze
            </button>
            {snoozeMenuOpen && (
              <div style={styles.snoozeMenu}>
                <button
                  style={styles.snoozeItem}
                  onClick={() => snooze(60 * 60 * 1000)}
                >
                  1 hour
                </button>
                <button
                  style={styles.snoozeItem}
                  onClick={snoozeUntilTomorrow9am}
                >
                  Tomorrow 9am
                </button>
                <button
                  style={styles.snoozeItem}
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
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div style={styles.divider} />

      {/* Assignee */}
      <div style={styles.section}>
        <div style={styles.sectionLabel}>Assignee</div>
        <select
          value={conv.assigneeId ?? ""}
          onChange={(e) =>
            patchMutation.mutate({
              assigneeId: e.target.value || null,
            })
          }
          style={styles.select}
        >
          <option value="">Unassigned</option>
          {team.map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.name}
            </option>
          ))}
        </select>
      </div>

      <div style={styles.divider} />

      {/* Conv info */}
      <div style={styles.section}>
        <div style={styles.sectionLabel}>Details</div>
        <div style={styles.detailRow}>
          <span style={styles.detailKey}>Channel</span>
          <span style={styles.detailVal}>
            {channelIcon(conv.channel)} {conv.channel}
          </span>
        </div>
        {conv.subject && (
          <div style={styles.detailRow}>
            <span style={styles.detailKey}>Subject</span>
            <span style={styles.detailVal}>{conv.subject}</span>
          </div>
        )}
        {conv.snoozedUntil && (
          <div style={styles.detailRow}>
            <span style={styles.detailKey}>Snoozed until</span>
            <span style={styles.detailVal}>
              {new Date(conv.snoozedUntil).toLocaleString()}
            </span>
          </div>
        )}
        <div style={styles.detailRow}>
          <span style={styles.detailKey}>Created</span>
          <span style={styles.detailVal}>
            {new Date(conv.createdAt).toLocaleDateString()}
          </span>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
// Main Inbox page
// ------------------------------------------------------------------
export default function Inbox() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [channelTab, setChannelTab] = useState<"all" | "chat" | "email">("all");
  const [statusFilter, setStatusFilter] = useState<
    "open" | "snoozed" | "resolved"
  >("open");
  const [assigneeFilter, setAssigneeFilter] = useState<
    "all" | "mine" | "unassigned"
  >("all");
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null);

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
    <div style={styles.root}>
      {/* Left pane: filters + conversation list */}
      <div style={styles.leftPane}>
        {/* Channel tabs */}
        <div style={styles.tabs}>
          {(["all", "chat", "email"] as const).map((ch) => (
            <button
              key={ch}
              onClick={() => setChannelTab(ch)}
              style={{
                ...styles.tab,
                background: channelTab === ch ? "#4f46e5" : "transparent",
                color: channelTab === ch ? "#fff" : "#6b7280",
              }}
            >
              {ch === "all" ? "All" : channelIcon(ch === "chat" ? "chat" : "email") + " " + ch.charAt(0).toUpperCase() + ch.slice(1)}
            </button>
          ))}
        </div>

        {/* Filter row */}
        <div style={styles.filterRow}>
          <select
            value={statusFilter}
            onChange={(e) =>
              setStatusFilter(e.target.value as "open" | "snoozed" | "resolved")
            }
            style={styles.filterSelect}
          >
            <option value="open">Open</option>
            <option value="snoozed">Snoozed</option>
            <option value="resolved">Resolved</option>
          </select>
          <select
            value={assigneeFilter}
            onChange={(e) =>
              setAssigneeFilter(
                e.target.value as "all" | "mine" | "unassigned"
              )
            }
            style={styles.filterSelect}
          >
            <option value="all">All Agents</option>
            <option value="mine">Mine</option>
            <option value="unassigned">Unassigned</option>
          </select>
        </div>

        {/* Conversation list */}
        <ConversationList
          channel={channelTab}
          status={statusFilter}
          assigneeFilter={assigneeFilter}
          selectedId={selectedConvId}
          onSelect={setSelectedConvId}
          userId={user.id}
        />
      </div>

      {/* Middle pane: thread */}
      <div style={styles.middlePane}>
        {selectedConvId ? (
          <ThreadPane
            key={selectedConvId}
            conversationId={selectedConvId}
            userId={user.id}
            onConversationUpdated={handleConversationUpdated}
          />
        ) : (
          <div style={styles.emptyThread}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>💬</div>
            <div style={{ fontSize: 14, color: "#9ca3af" }}>
              Select a conversation to start
            </div>
          </div>
        )}
      </div>

      {/* Right pane: detail */}
      <div style={styles.rightPaneWrap}>
        {selectedConvId ? (
          <DetailPane
            key={selectedConvId}
            conversationId={selectedConvId}
            onUpdated={handleConversationUpdated}
          />
        ) : (
          <div style={styles.emptyThread}>
            <div style={{ fontSize: 13, color: "#d1d5db" }}>No selection</div>
          </div>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
// Styles
// ------------------------------------------------------------------
const styles: Record<string, React.CSSProperties> = {
  root: {
    display: "flex",
    height: "100%",
    overflow: "hidden",
    fontFamily: "system-ui, -apple-system, sans-serif",
  },
  // Left pane
  leftPane: {
    width: 300,
    flexShrink: 0,
    borderRight: "1px solid #e5e7eb",
    display: "flex",
    flexDirection: "column",
    background: "#fff",
    overflow: "hidden",
  },
  tabs: {
    display: "flex",
    gap: 4,
    padding: "12px 12px 8px",
    borderBottom: "1px solid #f3f4f6",
  },
  tab: {
    flex: 1,
    padding: "6px 8px",
    border: "none",
    borderRadius: 6,
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 500,
    transition: "background 0.12s",
  },
  filterRow: {
    display: "flex",
    gap: 8,
    padding: "8px 12px",
    borderBottom: "1px solid #f3f4f6",
  },
  filterSelect: {
    flex: 1,
    padding: "5px 8px",
    border: "1px solid #e5e7eb",
    borderRadius: 6,
    fontSize: 12,
    color: "#374151",
    background: "#fff",
    cursor: "pointer",
  },
  list: {
    flex: 1,
    overflowY: "auto",
  },
  listEmpty: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  convItem: {
    padding: "12px 14px",
    cursor: "pointer",
    borderBottom: "1px solid #f9fafb",
    transition: "background 0.1s",
  },
  convRow: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    marginBottom: 3,
  },
  chanIcon: {
    fontSize: 13,
    flexShrink: 0,
  },
  convName: {
    fontSize: 13,
    fontWeight: 600,
    color: "#111827",
    flex: 1,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  unreadDot: {
    background: "#4f46e5",
    color: "#fff",
    borderRadius: 10,
    fontSize: 10,
    fontWeight: 700,
    padding: "1px 5px",
    flexShrink: 0,
  },
  convPreview: {
    fontSize: 12,
    color: "#6b7280",
    marginBottom: 4,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  convMeta: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  statusBadge: {
    fontSize: 10,
    fontWeight: 600,
    padding: "1px 6px",
    borderRadius: 10,
    textTransform: "uppercase",
    letterSpacing: "0.03em",
  },
  convTime: {
    fontSize: 11,
    color: "#9ca3af",
  },
  // Middle pane
  middlePane: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    background: "#fff",
  },
  emptyThread: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
  },
  threadPane: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    overflow: "hidden",
  },
  thread: {
    flex: 1,
    overflowY: "auto",
    padding: "20px 24px",
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  bubbleWrap: {
    display: "flex",
  },
  bubble: {
    padding: "10px 14px",
    wordBreak: "break-word",
  },
  systemMsg: {
    display: "flex",
    justifyContent: "center",
    padding: "4px 0",
  },
  systemMsgText: {
    fontSize: 12,
    color: "#9ca3af",
    background: "#f9fafb",
    padding: "3px 10px",
    borderRadius: 10,
  },
  composer: {
    borderTop: "1px solid #e5e7eb",
    padding: "12px 16px",
    display: "flex",
    gap: 8,
    background: "#fff",
  },
  composerTextarea: {
    flex: 1,
    padding: "10px 12px",
    border: "1px solid #e5e7eb",
    borderRadius: 8,
    resize: "none",
    fontSize: 13,
    fontFamily: "inherit",
    height: 72,
    outline: "none",
    color: "#111827",
  },
  sendBtn: {
    padding: "0 16px",
    background: "#4f46e5",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    fontWeight: 600,
    fontSize: 13,
    cursor: "pointer",
    transition: "opacity 0.12s",
  },
  // Right pane
  rightPaneWrap: {
    width: 260,
    flexShrink: 0,
    borderLeft: "1px solid #e5e7eb",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    background: "#fafafa",
  },
  detailPane: {
    display: "flex",
    flexDirection: "column",
    overflowY: "auto",
    padding: "16px 0",
  },
  contactCard: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "0 16px 16px",
  },
  contactAvatar: {
    width: 40,
    height: 40,
    borderRadius: "50%",
    background: "#e0e7ff",
    color: "#4f46e5",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 16,
    fontWeight: 700,
    flexShrink: 0,
  },
  contactName: {
    fontSize: 14,
    fontWeight: 600,
    color: "#111827",
  },
  contactEmail: {
    fontSize: 12,
    color: "#6b7280",
  },
  divider: {
    borderTop: "1px solid #e5e7eb",
    margin: "0 0 12px",
  },
  section: {
    padding: "0 16px 16px",
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: 600,
    color: "#9ca3af",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    marginBottom: 8,
  },
  actionRow: {
    display: "flex",
    gap: 6,
    flexWrap: "wrap",
  },
  btnPrimary: {
    padding: "6px 12px",
    background: "#4f46e5",
    color: "#fff",
    border: "none",
    borderRadius: 6,
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
  },
  btnSecondary: {
    padding: "6px 12px",
    background: "#f3f4f6",
    color: "#374151",
    border: "1px solid #e5e7eb",
    borderRadius: 6,
    fontSize: 12,
    fontWeight: 500,
    cursor: "pointer",
  },
  snoozeMenu: {
    position: "absolute",
    top: "100%",
    left: 0,
    zIndex: 100,
    background: "#fff",
    border: "1px solid #e5e7eb",
    borderRadius: 8,
    boxShadow: "0 4px 16px rgba(0,0,0,0.1)",
    minWidth: 150,
    overflow: "hidden",
    marginTop: 4,
  },
  snoozeItem: {
    display: "block",
    width: "100%",
    padding: "8px 12px",
    background: "none",
    border: "none",
    textAlign: "left",
    fontSize: 13,
    color: "#374151",
    cursor: "pointer",
  },
  select: {
    width: "100%",
    padding: "6px 8px",
    border: "1px solid #e5e7eb",
    borderRadius: 6,
    fontSize: 12,
    color: "#374151",
    background: "#fff",
    cursor: "pointer",
  },
  detailRow: {
    display: "flex",
    justifyContent: "space-between",
    marginBottom: 6,
    fontSize: 12,
  },
  detailKey: {
    color: "#9ca3af",
  },
  detailVal: {
    color: "#374151",
    fontWeight: 500,
    maxWidth: "55%",
    textAlign: "right",
    wordBreak: "break-word",
  },
};
