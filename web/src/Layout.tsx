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
  BarChart3,
  MessagesSquare,
  Settings,
  Globe,
  MessageSquare,
  ChevronDown,
  LogOut,
  Users,
  type LucideIcon,
} from "lucide-react";

const API_ORIGIN = import.meta.env.VITE_API_ORIGIN ?? "http://localhost:3000";

type NavItem = {
  href: string;
  icon: LucideIcon;
  label: string;
  // External links open in a new tab (e.g. the standalone /demo storefront that
  // embeds the live widget) instead of navigating within the SPA.
  external?: boolean;
};

const navItems: NavItem[] = [
  { href: "/inbox", icon: Inbox, label: "Inbox" },
  { href: "/knowledge", icon: BookOpen, label: "Knowledge Base" },
  { href: "/analytics", icon: BarChart3, label: "Analytics" },
  { href: `${API_ORIGIN}/demo`, icon: MessagesSquare, label: "Test widget", external: true },
  { href: "/settings/team", icon: Users, label: "Team" },
  { href: "/settings/domains", icon: Globe, label: "Domains" },
  { href: "/settings/canned", icon: MessageSquare, label: "Canned" },
  { href: "/settings", icon: Settings, label: "Settings" },
];

function AppSidebar() {
  const { user, workspaces, activeWorkspace, setActiveWorkspace, signOut } = useAuth();

  return (
    <Sidebar>
      <SidebarHeader className="px-3 py-4">
        <div className="flex items-center gap-2.5">
          <div
            className="flex size-8 items-center justify-center rounded-lg text-sm font-bold text-white shrink-0"
            style={{ background: "oklch(0.60 0.22 277)" }}
          >
            S
          </div>
          <span className="text-base font-semibold tracking-tight">SuperProfile</span>
        </div>
      </SidebarHeader>

      {workspaces.length > 0 && (
        <div className="px-3 pb-3">
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

      <SidebarContent className="px-2 pt-2">
        <SidebarMenu>
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <SidebarMenuItem key={item.href}>
                <SidebarMenuButton asChild size="default">
                  {item.external ? (
                    <a
                      href={item.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sidebar-foreground"
                    >
                      <Icon className="size-4" />
                      <span>{item.label}</span>
                    </a>
                  ) : (
                    <NavLink
                      to={item.href}
                      end={item.href === "/inbox" || item.href === "/settings"}
                      className={({ isActive }) =>
                        isActive ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium" : "text-sidebar-foreground"
                      }
                    >
                      <Icon className="size-4" />
                      <span>{item.label}</span>
                    </NavLink>
                  )}
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarContent>

      <Separator />

      <SidebarFooter className="px-3 py-3">
        {user && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex w-full items-center gap-3 rounded-md px-1 py-1.5 hover:bg-sidebar-accent transition-colors">
                <Avatar className="size-8 shrink-0">
                  <AvatarImage src={user.avatarUrl || ""} alt={user.name} />
                  <AvatarFallback>
                    {user.name?.charAt(0)?.toUpperCase() ?? "?"}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1 text-left">
                  <div className="truncate text-sm font-medium">{user.name}</div>
                  <div className="truncate text-xs text-muted-foreground">{user.email}</div>
                </div>
                <ChevronDown className="size-4 shrink-0 opacity-50" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start" className="w-56">
              <DropdownMenuLabel className="font-normal">
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium">{user.name}</span>
                  <span className="text-xs text-muted-foreground">{user.email}</span>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => signOut()}
                className="text-destructive focus:text-destructive cursor-pointer"
              >
                <LogOut className="size-4" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
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
        <header className="flex h-14 shrink-0 items-center border-b px-4 gap-3">
          <SidebarTrigger />
          <Separator orientation="vertical" className="h-4" />
        </header>
        <main className="flex flex-1 flex-col overflow-hidden">
          <Outlet />
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
