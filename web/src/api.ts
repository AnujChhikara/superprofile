const API_BASE = import.meta.env.VITE_API_ORIGIN ?? "http://localhost:3000";

// Public help-center (KB) origin. Prefer an explicit VITE_KB_ORIGIN; otherwise
// derive it from the API origin by swapping the `api.` subdomain for `kb.`
// (e.g. https://api.anujchhikara.com → https://kb.anujchhikara.com). Falls back
// to the API origin for hosts without an `api.` prefix (e.g. localhost in dev).
export function kbOrigin(): string {
  const explicit = import.meta.env.VITE_KB_ORIGIN;
  if (explicit) return explicit;
  try {
    const u = new URL(API_BASE);
    if (u.hostname.startsWith("api.")) {
      u.hostname = "kb." + u.hostname.slice("api.".length);
      return u.origin;
    }
  } catch {
    // fall through to API base
  }
  return API_BASE;
}

// Error that carries the HTTP status so callers can react to it (e.g. render
// an "admins only" screen on a 403 from an admin-gated route).
export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

// True when a request was rejected because the route is restricted to admins
// (backend: requireWorkspace("admin") → 403 { error: "admin only" }).
export function isAdminOnly(err: unknown): boolean {
  return (
    err instanceof ApiError &&
    err.status === 403 &&
    /admin only/i.test(err.message)
  );
}

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
    throw new ApiError(errMsg, res.status);
  }

  // 204 No Content
  if (res.status === 204) return undefined as unknown as T;

  return res.json() as Promise<T>;
}
