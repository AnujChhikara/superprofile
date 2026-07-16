const API_BASE = import.meta.env.VITE_API_ORIGIN ?? "http://localhost:3000";

export async function api<T = unknown>(
  path: string,
  opts: RequestInit = {}
): Promise<T> {
  const activeWorkspaceId = localStorage.getItem("activeWorkspaceId");

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(opts.headers as Record<string, string> | undefined),
  };

  if (activeWorkspaceId) {
    headers["X-Workspace-Id"] = activeWorkspaceId;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    credentials: "include",
    headers,
  });

  if (!res.ok) {
    let errMsg = `API error ${res.status}`;
    try {
      const body = await res.json();
      errMsg = body.error ?? errMsg;
    } catch {
      // ignore parse errors
    }
    throw new Error(errMsg);
  }

  // 204 No Content
  if (res.status === 204) return undefined as unknown as T;

  return res.json() as Promise<T>;
}
