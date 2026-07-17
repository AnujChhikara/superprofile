import { Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth.js";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { Skeleton } from "@/components/ui/skeleton";
import Layout from "./Layout.js";
import Login from "./pages/Login.js";
import Onboarding from "./pages/Onboarding.js";
import Inbox from "./pages/Inbox.js";
import KnowledgeBase from "./pages/KnowledgeBase.js";
import Analytics from "./pages/Analytics.js";
import TryIt from "./pages/TryIt.js";
import TeamSettings from "./pages/Settings/Team.js";
import Domains from "./pages/Settings/Domains.js";
import CannedResponses from "./pages/Settings/Canned.js";
import WidgetSettings from "./pages/Settings/Widget.js";
import InviteAccept from "./pages/InviteAccept.js";

function AppRoutes() {
  const { user, workspaces, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Skeleton className="size-10 rounded-full" />
      </div>
    );
  }

  return (
    <Routes>
      {/* Invite accept — available regardless of auth state */}
      <Route path="/invite/:token" element={<InviteAccept />} />

      {/* Unauthenticated */}
      {!user && (
        <>
          <Route path="/login" element={<Login />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </>
      )}

      {/* Authenticated, no workspace */}
      {user && workspaces.length === 0 && (
        <>
          <Route path="/onboarding" element={<Onboarding />} />
          <Route path="*" element={<Navigate to="/onboarding" replace />} />
        </>
      )}

      {/* Authenticated, has workspace */}
      {user && workspaces.length > 0 && (
        <Route element={<Layout />}>
          <Route index element={<Navigate to="/inbox" replace />} />
          <Route path="/inbox" element={<Inbox />} />
          <Route path="/knowledge" element={<KnowledgeBase />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/try" element={<TryIt />} />
          <Route path="/settings" element={<WidgetSettings />} />
          <Route path="/settings/team" element={<TeamSettings />} />
          <Route path="/settings/domains" element={<Domains />} />
          <Route path="/settings/canned" element={<CannedResponses />} />
          <Route path="*" element={<Navigate to="/inbox" replace />} />
        </Route>
      )}
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <TooltipProvider>
        <AppRoutes />
        <Toaster />
      </TooltipProvider>
    </AuthProvider>
  );
}
