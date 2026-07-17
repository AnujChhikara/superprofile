import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api.js";

export interface User {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  createdAt: string;
}

export interface WorkspaceRef {
  id: string;
  name: string;
  slug: string;
  publicKey: string;
  role: "admin" | "agent";
}

interface AuthCtx {
  user: User | null;
  workspaces: WorkspaceRef[];
  activeWorkspace: WorkspaceRef | null;
  setActiveWorkspace: (ws: WorkspaceRef) => void;
  isLoading: boolean;
  refetch: () => void;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [activeWsId, setActiveWsId] = useState<string | null>(
    localStorage.getItem("activeWorkspaceId")
  );

  const { data, isLoading } = useQuery({
    queryKey: ["me"],
    queryFn: () =>
      api<{ user: User; workspaces: WorkspaceRef[] }>("/api/me").catch(
        () => null
      ),
    retry: false,
    staleTime: 30_000,
  });

  const user = data?.user ?? null;
  const workspaces = data?.workspaces ?? [];

  // Auto-select a workspace if none is stored or stored one no longer exists
  const activeWorkspace: WorkspaceRef | null = (() => {
    if (!workspaces.length) return null;
    const found = activeWsId ? workspaces.find((w) => w.id === activeWsId) : null;
    if (found) return found;
    // Default to first workspace
    return workspaces[0] ?? null;
  })();

  const setActiveWorkspace = useCallback((ws: WorkspaceRef) => {
    localStorage.setItem("activeWorkspaceId", ws.id);
    setActiveWsId(ws.id);
  }, []);

  const refetch = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["me"] });
  }, [queryClient]);

  const signOut = useCallback(async () => {
    await api("/api/auth/logout", { method: "POST" }).catch(() => {});
    localStorage.removeItem("activeWorkspaceId");
    queryClient.clear();
    window.location.href = "/";
  }, [queryClient]);

  return (
    <AuthContext.Provider
      value={{
        user,
        workspaces,
        activeWorkspace,
        setActiveWorkspace,
        isLoading,
        refetch,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthCtx {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
