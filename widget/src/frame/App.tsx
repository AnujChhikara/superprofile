import { useState, useEffect, useRef, useCallback } from "preact/hooks";
import { io, type Socket } from "socket.io-client";
import {
  widgetInit,
  startConversation,
  sendMessage,
  getMessages,
  searchKb,
  type WidgetConversation,
  type WidgetMessage,
  type KbSuggestion,
} from "./api";

const BRAND = "#4f46e5";

// Client-side only acknowledgement, rendered while the visitor is waiting for a
// first agent reply. Not persisted — never stored as a message.
const AUTO_ACK = "Thanks for reaching out — someone will reply soon.";

function getVisitorToken(): string {
  let t = localStorage.getItem("sp_visitor");
  if (!t) {
    t = crypto.randomUUID();
    localStorage.setItem("sp_visitor", t);
  }
  return t;
}

export function App({ workspaceKey }: { workspaceKey: string }) {
  const [ready, setReady] = useState(false);
  const [workspaceName, setWorkspaceName] = useState("Support");
  const [agentOnline, setAgentOnline] = useState(false);
  const [conversations, setConversations] = useState<WidgetConversation[]>([]);
  const [view, setView] = useState<"home" | "thread">("home");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeStatus, setActiveStatus] = useState<string | null>(null);
  const [messages, setMessages] = useState<WidgetMessage[]>([]);
  const [agentTyping, setAgentTyping] = useState(false);
  const [connected, setConnected] = useState(true);

  const visitorToken = useRef(getVisitorToken());
  const socketRef = useRef<Socket | null>(null);
  const openedRef = useRef(false);
  const unreadRef = useRef(0);
  const activeIdRef = useRef<string | null>(null);
  activeIdRef.current = activeId;

  const postUnread = useCallback((count: number) => {
    parent.postMessage({ type: "widget:unread", count }, "*");
  }, []);

  // ---- init + socket ----
  useEffect(() => {
    if (!workspaceKey) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await widgetInit(workspaceKey, visitorToken.current);
        if (cancelled) return;
        visitorToken.current = res.visitorToken;
        localStorage.setItem("sp_visitor", res.visitorToken);
        setWorkspaceName(res.workspaceName);
        setAgentOnline(res.agentOnline);
        setConversations(res.conversations);
        setReady(true);

        const socket = io({
          auth: {
            workspaceKey,
            visitorToken: res.visitorToken,
          },
          transports: ["websocket", "polling"],
        });
        socketRef.current = socket;
        socket.on("connect", () => setConnected(true));
        socket.io.on("reconnect", () => setConnected(true));
        socket.on("disconnect", () => setConnected(false));
        socket.on("presence", (p: { agentOnline: boolean }) =>
          setAgentOnline(p.agentOnline)
        );
        socket.on(
          "message:new",
          (p: { conversationId: string; message: WidgetMessage }) => {
            if (p.conversationId === activeIdRef.current) {
              setMessages((m) =>
                m.some((x) => x.id === p.message.id) ? m : [...m, p.message]
              );
              if (p.message.senderType === "agent") {
                socketRef.current?.emit("read", {
                  conversationId: p.conversationId,
                  upToSeq: p.message.seq,
                });
              }
            }
            // Keep the home-list preview + ordering fresh as messages arrive
            // (agent replies, auto system messages, and the visitor's own echo).
            setConversations((cs) =>
              cs.map((c) =>
                c.id === p.conversationId
                  ? {
                      ...c,
                      lastPreview: p.message.body,
                      lastMessageAt: p.message.createdAt,
                    }
                  : c
              )
            );
            // Unread badge when panel closed + message is from an agent.
            if (!openedRef.current && p.message.senderType === "agent") {
              unreadRef.current += 1;
              postUnread(unreadRef.current);
            }
          }
        );
        socket.on(
          "typing",
          (p: { senderType: string; isTyping: boolean; conversationId: string }) => {
            if (
              p.conversationId === activeIdRef.current &&
              p.senderType === "agent"
            )
              setAgentTyping(p.isTyping);
          }
        );
        socket.on(
          "conversation:updated",
          (p: { conversation: { id: string; status: string } }) => {
            const { id, status } = p.conversation;
            setConversations((cs) =>
              cs.map((c) => (c.id === id ? { ...c, status: status as WidgetConversation["status"] } : c))
            );
            if (id === activeIdRef.current) setActiveStatus(status);
          }
        );
      } catch {
        setReady(true); // show UI even if init fails
      }
    })();
    return () => {
      cancelled = true;
      socketRef.current?.disconnect();
    };
  }, [workspaceKey, postUnread]);

  // ---- loader tells us the panel opened → clear unread ----
  useEffect(() => {
    function onMsg(e: MessageEvent) {
      if ((e.data as { type?: string })?.type === "widget:opened") {
        openedRef.current = true;
        unreadRef.current = 0;
        postUnread(0);
      }
    }
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [postUnread]);

  async function openConversation(id: string) {
    setActiveId(id);
    setActiveStatus(conversations.find((c) => c.id === id)?.status ?? null);
    setView("thread");
    setAgentTyping(false);
    const msgs = await getMessages(id, workspaceKey, visitorToken.current);
    setMessages(msgs);
    socketRef.current?.emit("join", { conversationId: id });
    const lastAgentSeq = msgs
      .filter((m) => m.senderType === "agent")
      .reduce((mx, m) => Math.max(mx, m.seq), 0);
    if (lastAgentSeq)
      socketRef.current?.emit("read", { conversationId: id, upToSeq: lastAgentSeq });
  }

  function newConversation() {
    setActiveId(null);
    setActiveStatus(null);
    setMessages([]);
    setAgentTyping(false);
    setView("thread");
  }

  return (
    <div style={styles.root}>
      <Header
        title={view === "thread" ? workspaceName : workspaceName}
        agentOnline={agentOnline}
        showBack={view === "thread"}
        onBack={() => {
          setView("home");
          setActiveId(null);
          setActiveStatus(null);
        }}
        onClose={() => parent.postMessage({ type: "widget:close" }, "*")}
      />
      {!connected && <div style={styles.reconnect}>Reconnecting…</div>}
      {view === "home" ? (
        <Home
          ready={ready}
          conversations={conversations}
          onOpen={openConversation}
          onNew={newConversation}
        />
      ) : (
        <Thread
          workspaceKey={workspaceKey}
          visitorToken={visitorToken.current}
          activeId={activeId}
          messages={messages}
          agentTyping={agentTyping}
          resolved={activeStatus === "resolved"}
          socket={socketRef.current}
          onCreated={(conv, msgs) => {
            setActiveId(conv.id);
            setActiveStatus(conv.status);
            setMessages(msgs);
            // `conv` comes from the server without a preview — derive it from
            // the messages we just created so the home list isn't empty.
            const last = msgs[msgs.length - 1];
            const entry: WidgetConversation = {
              ...conv,
              lastPreview: last?.body ?? null,
              lastMessageAt: last?.createdAt ?? conv.lastMessageAt,
            };
            setConversations((c) => [entry, ...c.filter((x) => x.id !== conv.id)]);
            socketRef.current?.emit("join", { conversationId: conv.id });
          }}
          onSent={(msg) => {
            setMessages((m) => (m.some((x) => x.id === msg.id) ? m : [...m, msg]));
            setConversations((cs) =>
              cs.map((c) =>
                c.id === msg.conversationId
                  ? { ...c, lastPreview: msg.body, lastMessageAt: msg.createdAt }
                  : c
              )
            );
          }}
        />
      )}
    </div>
  );
}

function Header({
  title,
  agentOnline,
  showBack,
  onBack,
  onClose,
}: {
  title: string;
  agentOnline: boolean;
  showBack: boolean;
  onBack: () => void;
  onClose: () => void;
}) {
  return (
    <div style={styles.header}>
      {showBack && (
        <button style={styles.iconBtn} onClick={onBack} aria-label="Back">
          ‹
        </button>
      )}
      <div style={{ flex: 1 }}>
        <div style={styles.headerTitle}>{title}</div>
        <div style={styles.headerSub}>
          <span
            style={{
              ...styles.dot,
              background: agentOnline ? "#22c55e" : "#9ca3af",
            }}
          />
          {agentOnline ? "We're online" : "We'll reply by email"}
        </div>
      </div>
      <button style={styles.iconBtn} onClick={onClose} aria-label="Close">
        ×
      </button>
    </div>
  );
}

function Home({
  ready,
  conversations,
  onOpen,
  onNew,
}: {
  ready: boolean;
  conversations: WidgetConversation[];
  onOpen: (id: string) => void;
  onNew: () => void;
}) {
  return (
    <div style={styles.body}>
      {!ready ? (
        <div style={styles.muted}>Loading…</div>
      ) : (
        <>
          {conversations.length === 0 ? (
            <div style={styles.muted}>
              Send us a message and we'll get back to you.
            </div>
          ) : (
            <div style={styles.convList}>
              {conversations.map((c) => (
                <button
                  key={c.id}
                  style={styles.convItem}
                  onClick={() => onOpen(c.id)}
                >
                  <div style={styles.convTitle}>
                    {c.subject ?? "Conversation"}
                  </div>
                  <div style={styles.convPreview}>
                    {c.lastPreview ?? "No messages yet"}
                  </div>
                </button>
              ))}
            </div>
          )}
          <button style={styles.primaryBtn} onClick={onNew}>
            + New conversation
          </button>
        </>
      )}
    </div>
  );
}

function Thread({
  workspaceKey,
  visitorToken,
  activeId,
  messages,
  agentTyping,
  resolved,
  socket,
  onCreated,
  onSent,
}: {
  workspaceKey: string;
  visitorToken: string;
  activeId: string | null;
  messages: WidgetMessage[];
  agentTyping: boolean;
  resolved: boolean;
  socket: Socket | null;
  onCreated: (conv: WidgetConversation, msgs: WidgetMessage[]) => void;
  onSent: (msg: WidgetMessage) => void;
}) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [suggestions, setSuggestions] = useState<KbSuggestion[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const kbTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTyping = useRef(false);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, agentTyping]);

  // Debounced KB suggestions: ≥4 chars, 600ms after last keystroke, top 3.
  function scheduleKbSearch(q: string) {
    if (kbTimer.current) clearTimeout(kbTimer.current);
    if (q.trim().length < 4) {
      setSuggestions([]);
      return;
    }
    kbTimer.current = setTimeout(async () => {
      const hits = await searchKb(workspaceKey, q.trim());
      setSuggestions(hits.slice(0, 3));
    }, 600);
  }

  function emitTyping(v: boolean) {
    if (!activeId || !socket) return;
    socket.emit("typing", { conversationId: activeId, isTyping: v });
    isTyping.current = v;
  }

  function onInput(e: Event) {
    const value = (e.target as HTMLTextAreaElement).value;
    setDraft(value);
    scheduleKbSearch(value);
    if (activeId) {
      if (!isTyping.current) emitTyping(true);
      if (typingTimer.current) clearTimeout(typingTimer.current);
      typingTimer.current = setTimeout(() => emitTyping(false), 2000);
    }
  }

  async function send() {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    if (isTyping.current) emitTyping(false);
    try {
      if (!activeId) {
        const res = await startConversation(workspaceKey, visitorToken, body);
        onCreated(res.conversation, res.messages);
      } else {
        const msg = await sendMessage(
          workspaceKey,
          visitorToken,
          activeId,
          body
        );
        onSent(msg);
      }
      setDraft("");
      setSuggestions([]);
    } catch {
      // keep the draft so the visitor can retry
    } finally {
      setSending(false);
    }
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  return (
    <div style={styles.threadWrap}>
      <div style={styles.thread}>
        {messages.length === 0 && (
          <div style={styles.muted}>Start the conversation below.</div>
        )}
        {messages.map((m) => <Bubble key={m.id} m={m} />)}
        {(() => {
          // Client-side only acknowledgement: shown while the visitor has sent a
          // message and no agent has replied yet. It is never persisted, so it
          // disappears the instant an agent responds and never appears in the
          // agent's inbox.
          const hasVisitorMsg = messages.some((m) => m.senderType === "contact");
          const hasAgentReply = messages.some((m) => m.senderType === "agent");
          return hasVisitorMsg && !hasAgentReply && !resolved ? (
            <div style={{ ...styles.bubbleRow, justifyContent: "center" }}>
              <div style={styles.systemMsg}>{AUTO_ACK}</div>
            </div>
          ) : null;
        })()}
        {agentTyping && (
          <div style={{ ...styles.bubbleRow, justifyContent: "flex-start" }}>
            <div style={{ ...styles.bubble, ...styles.bubbleAgent, fontStyle: "italic", color: "#6b7280" }}>
              typing…
            </div>
          </div>
        )}
        {resolved && (
          <div style={{ ...styles.bubbleRow, justifyContent: "center" }}>
            <div style={styles.systemMsg}>
              An agent marked this conversation as resolved
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      {/* When resolved, the thread is fully read-only: no suggestions, no composer. */}
      {!resolved && suggestions.length > 0 && (
        <div style={styles.suggestWrap}>
          <div style={styles.suggestLabel}>Suggested articles</div>
          {suggestions.map((s) => (
            <a
              key={s.id}
              href={s.url}
              target="_blank"
              rel="noreferrer"
              style={styles.suggestCard}
            >
              📄 {s.title}
            </a>
          ))}
        </div>
      )}
      {!resolved && (
        <div style={styles.composer}>
          <textarea
            style={styles.textarea}
            value={draft}
            placeholder="Type a message…"
            onInput={onInput}
            onKeyDown={onKeyDown}
            disabled={sending}
          />
          <button
            style={{ ...styles.sendBtn, opacity: !draft.trim() || sending ? 0.5 : 1 }}
            onClick={() => void send()}
            disabled={!draft.trim() || sending}
          >
            ➤
          </button>
        </div>
      )}
    </div>
  );
}

// Render text with any http(s) URLs turned into clickable anchors. We only ever
// wrap tokens that matched the URL regex; everything else is rendered as plain
// text nodes, so untrusted message bodies can't inject markup (XSS-safe).
const URL_RE = /(https?:\/\/[^\s]+)/g;
const IS_URL_RE = /^https?:\/\/[^\s]+$/;
function Linkified({ text, linkColor }: { text: string; linkColor?: string }) {
  const parts = text.split(URL_RE);
  return (
    <>
      {parts.map((part, i) =>
        IS_URL_RE.test(part) ? (
          <a
            key={i}
            href={part}
            target="_blank"
            rel="noreferrer"
            style={{ color: linkColor ?? "#4f46e5", textDecoration: "underline" }}
          >
            {part}
          </a>
        ) : (
          part
        )
      )}
    </>
  );
}

function Bubble({ m }: { m: WidgetMessage }) {
  if (m.senderType === "system") {
    return (
      <div style={{ ...styles.bubbleRow, justifyContent: "center" }}>
        <div style={styles.systemMsg}>
          <Linkified text={m.body} />
        </div>
      </div>
    );
  }
  const isVisitor = m.senderType === "contact";
  return (
    <div
      style={{
        ...styles.bubbleRow,
        justifyContent: isVisitor ? "flex-end" : "flex-start",
      }}
    >
      <div
        style={{
          ...styles.bubble,
          ...(isVisitor ? styles.bubbleVisitor : styles.bubbleAgent),
        }}
      >
        <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
          <Linkified text={m.body} linkColor={isVisitor ? "#fff" : "#4f46e5"} />
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, any> = {
  root: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    background: "#fff",
    color: "#111827",
    fontSize: "14px",
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "14px 16px",
    background: BRAND,
    color: "#fff",
  },
  headerTitle: { fontWeight: 700, fontSize: "15px" },
  headerSub: { fontSize: "12px", opacity: 0.9, display: "flex", alignItems: "center", gap: "5px" },
  dot: { width: "8px", height: "8px", borderRadius: "50%", display: "inline-block" },
  iconBtn: {
    background: "rgba(255,255,255,0.15)",
    border: "none",
    color: "#fff",
    width: "28px",
    height: "28px",
    borderRadius: "6px",
    cursor: "pointer",
    fontSize: "18px",
    lineHeight: "1",
  },
  reconnect: {
    background: "#fef9c3",
    color: "#854d0e",
    fontSize: "12px",
    textAlign: "center",
    padding: "4px",
  },
  body: {
    flex: 1,
    overflowY: "auto",
    padding: "16px",
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  },
  muted: { color: "#9ca3af", fontSize: "13px", textAlign: "center", padding: "12px" },
  convList: { display: "flex", flexDirection: "column", gap: "8px" },
  convItem: {
    textAlign: "left",
    border: "1px solid #e5e7eb",
    borderRadius: "10px",
    padding: "10px 12px",
    background: "#fff",
    cursor: "pointer",
  },
  convTitle: { fontWeight: 600, fontSize: "13px", marginBottom: "2px" },
  convPreview: {
    fontSize: "12px",
    color: "#6b7280",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  primaryBtn: {
    marginTop: "auto",
    background: BRAND,
    color: "#fff",
    border: "none",
    borderRadius: "10px",
    padding: "12px",
    fontWeight: 600,
    cursor: "pointer",
  },
  threadWrap: { flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" },
  thread: {
    flex: 1,
    overflowY: "auto",
    padding: "16px",
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },
  bubbleRow: { display: "flex" },
  bubble: { maxWidth: "78%", padding: "8px 12px", borderRadius: "14px", fontSize: "13px" },
  bubbleVisitor: { background: BRAND, color: "#fff", borderBottomRightRadius: "4px" },
  bubbleAgent: { background: "#f3f4f6", color: "#111827", borderBottomLeftRadius: "4px" },
  systemMsg: { background: "#f9fafb", color: "#9ca3af", fontSize: "12px", padding: "3px 10px", borderRadius: "10px" },
  suggestWrap: {
    padding: "8px 12px",
    borderTop: "1px solid #eef2f7",
    background: "#fafafe",
  },
  suggestLabel: {
    fontSize: "11px",
    color: "#94a3b8",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    marginBottom: "6px",
  },
  suggestCard: {
    display: "block",
    fontSize: "13px",
    color: "#4f46e5",
    textDecoration: "none",
    padding: "6px 8px",
    borderRadius: "8px",
    background: "#fff",
    border: "1px solid #e5e7eb",
    marginBottom: "4px",
  },
  composer: {
    display: "flex",
    gap: "8px",
    padding: "10px 12px",
    borderTop: "1px solid #e5e7eb",
  },
  textarea: {
    flex: 1,
    resize: "none",
    height: "40px",
    border: "1px solid #e5e7eb",
    borderRadius: "10px",
    padding: "10px 12px",
    fontFamily: "inherit",
    fontSize: "13px",
    outline: "none",
  },
  sendBtn: {
    background: BRAND,
    color: "#fff",
    border: "none",
    borderRadius: "10px",
    width: "44px",
    cursor: "pointer",
    fontSize: "16px",
  },
};
