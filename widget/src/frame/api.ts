// The frame is served from the API origin, so relative /api/widget/* works.
export interface WidgetConversation {
  id: string;
  subject: string | null;
  status: "open" | "snoozed" | "resolved";
  lastMessageAt: string;
  lastPreview: string | null;
}

export interface WidgetMessage {
  id: string;
  conversationId: string;
  senderType: "contact" | "agent" | "system";
  body: string;
  seq: number;
  readAt: string | null;
  createdAt: string;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? res.status);
  return res.json() as Promise<T>;
}

export function widgetInit(workspaceKey: string, visitorToken?: string) {
  return post<{
    visitorToken: string;
    workspaceName: string;
    agentOnline: boolean;
    conversations: WidgetConversation[];
  }>("/api/widget/init", { workspaceKey, visitorToken });
}

export function startConversation(
  workspaceKey: string,
  visitorToken: string,
  body: string
) {
  return post<{
    conversation: WidgetConversation;
    message: WidgetMessage;
    messages: WidgetMessage[];
  }>("/api/widget/conversations", { workspaceKey, visitorToken, body });
}

export function sendMessage(
  workspaceKey: string,
  visitorToken: string,
  conversationId: string,
  body: string
) {
  return post<WidgetMessage>(
    `/api/widget/conversations/${conversationId}/messages`,
    { workspaceKey, visitorToken, body }
  );
}

export async function getMessages(
  conversationId: string,
  workspaceKey: string,
  visitorToken: string,
  after?: number
): Promise<WidgetMessage[]> {
  const q = new URLSearchParams();
  if (after !== undefined) q.set("after", String(after));
  // Credentials go in headers, not the URL, so the token isn't logged.
  const res = await fetch(
    `/api/widget/conversations/${conversationId}/messages?${q}`,
    {
      headers: {
        "X-Workspace-Key": workspaceKey,
        "X-Visitor-Token": visitorToken,
      },
    }
  );
  if (!res.ok) return [];
  return res.json();
}

export interface KbSuggestion {
  id: string;
  title: string;
  slug: string;
  url: string;
}

export async function searchKb(
  workspaceKey: string,
  q: string
): Promise<KbSuggestion[]> {
  const res = await fetch(
    `/api/public/kb/${encodeURIComponent(workspaceKey)}/search?q=${encodeURIComponent(q)}`
  );
  if (!res.ok) return [];
  return res.json();
}

export function identify(
  workspaceKey: string,
  visitorToken: string,
  email: string,
  name?: string
) {
  return post<{ ok: boolean }>("/api/widget/identify", {
    workspaceKey,
    visitorToken,
    email,
    name,
  });
}
