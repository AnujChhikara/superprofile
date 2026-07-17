import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "./auth.js";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import {
  Inbox,
  BookOpen,
  Settings,
  Globe,
  MessageSquare,
  ChevronDown,
} from "lucide-react";

const navItems = [
  { href: "/inbox", icon: Inbox, label: "Inbox" },
  { href: "/knowledge", icon: BookOpen, label: "Knowledge Base" },
  { href: "/settings/team", icon: Settings, label: "Team" },
  { href: "/settings/domains", icon: Globe, label: "Domains" },
  { href: "/settings/canned", icon: MessageSquare, label: "Canned" },
];

function AppSidebar() {
  const { user, workspaces, activeWorkspace, setActiveWorkspace } = useAuth();

  return (
    <Sidebar>
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-2">
          <span className="text-2xl">💬</span>
          <span className="text-lg font-bold">SuperProfile</span>
        </div>
      </SidebarHeader>

      {workspaces.length > 0 && (
        <div className="px-2 pb-4">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm">
                <span className="truncate">{activeWorkspace?.name}</span>
                <ChevronDown className="size-4 shrink-0 opacity-50" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {workspaces.map((ws) => (
                <DropdownMenuItem
                  key={ws.id}
                  onClick={() => setActiveWorkspace(ws)}
                  className={
                    activeWorkspace?.id === ws.id ? "bg-accent" : undefined
                  }
                >
                  {ws.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      <Separator />

      <SidebarContent>
        <SidebarMenu>
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <SidebarMenuItem key={item.href}>
                <SidebarMenuButton asChild>
                  <NavLink
                    to={item.href}
                    end={item.href === "/inbox"}
                    className={({ isActive }) =>
                      `flex items-center gap-3 ${isActive ? "bg-sidebar-accent" : ""}`
                    }
                  >
                    <Icon className="size-4" />
                    <span>{item.label}</span>
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarContent>

      <Separator />

      <SidebarFooter>
        {user && (
          <div className="flex items-center gap-3">
            <Avatar className="size-8">
              <AvatarImage src={user.avatarUrl || ""} alt={user.name} />
              <AvatarFallback>
                {user.name?.charAt(0)?.toUpperCase() ?? "?"}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">{user.name}</div>
              <div className="truncate text-xs text-muted-foreground">
                {user.email}
              </div>
            </div>
          </div>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}

export default function Layout() {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center border-b">
          <SidebarTrigger className="ml-4" />
        </header>
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
