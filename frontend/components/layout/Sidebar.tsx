"use client";

import { useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart2,
  Building2,
  Cable,
  CalendarDays,
  CalendarClock,
  ChevronLeft,
  ClipboardCheck,
  Calculator,
  MailCheck,
  Kanban,
  Key,
  LayoutDashboard,
  LogOut,
  Mail,
  MessageCircle,
  Send,
  Settings,
  Share2,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingUp,
  Users,
  UsersRound,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/stores/uiStore";
import { useAuthStore } from "@/stores/authStore";
import { useLogout } from "@/hooks/useAuth";
import { useUnreadCounts } from "@/hooks/useChat";
import { useTeams } from "@/hooks/useTeams";
import { useLeaderQueue } from "@/hooks/useProjects";
import { useMyVerifications } from "@/hooks/useVerify";
import ThemeToggle from "@/components/shared/ThemeToggle";
import InstallAppRow from "@/components/InstallAppRow";
import {
  listVariants,
  navItemVariants,
} from "@/lib/animations";

const NAV_ITEMS = [
  { label: "Overview",      href: "/dashboard",      icon: LayoutDashboard, module: "dashboard" },
  { label: "Connectors",    href: "/connectors",     icon: Cable,           module: "connectors", hidden: true },
  { label: "Reports",       href: "/reports",        icon: TrendingUp,      module: "reports",  hidden: true },
  { label: "Analytics",     href: "/analytics",      icon: BarChart2,                           hidden: true },
  { label: "Campaigns",     href: "/campaigns",      icon: Target,          module: "campaigns", hidden: true },
  { label: "Schedule",      href: "/schedule",       icon: CalendarDays,                        hidden: true },
  { label: "Rules",         href: "/rules",          icon: Zap,                                 hidden: true },
  { label: "Email Reports", href: "/email-reports",  icon: Mail,                                hidden: true },
  { label: "Projects",      href: "/projects",       icon: Kanban,          module: "projects" },
  { label: "Media Schedule", href: "/media-schedule", icon: CalendarClock },
  { label: "Teams",         href: "/teams",          icon: UsersRound,      module: "teams" },
  { label: "Leader Desk",   href: "/leader",         icon: ClipboardCheck },
  { label: "Verifications", href: "/verify",         icon: ShieldCheck },
  { label: "AI Queries",    href: "/ai",             icon: Sparkles,        module: "ai", hidden: true },
  { label: "Publish",       href: "/social",         icon: Share2,                              hidden: true },
  { label: "Send DM",       href: "/social/dm",      icon: Send,                                hidden: true },
  { label: "Chat",          href: "/chat",           icon: MessageCircle },
  { label: "Clients",       href: "/clients",        icon: Building2,                           hidden: true },
  { label: "Users",         href: "/users",          icon: Users,           module: "users" },
  { label: "Roles",         href: "/roles",          icon: ShieldCheck,     module: "roles" },
];

const BOTTOM_ITEMS = [
  { label: "API Keys",       href: "/settings/api-keys",       icon: Key,        hidden: true },
  { label: "Custom Metrics", href: "/settings/custom-metrics", icon: Calculator, hidden: true },
  { label: "Email Logs",     href: "/email-logs",              icon: MailCheck,  superAdmin: true },
  { label: "Settings",       href: "/settings",                icon: Settings,   module: "settings" },
];

interface NavItemProps {
  label: string;
  href: string;
  icon: React.ElementType;
  soon?: boolean;
  collapsed: boolean;
  onClick?: () => void;
  module?: string;
  badge?: number;
}

function NavItem({ label, href, icon: Icon, soon, collapsed, onClick, module, badge }: NavItemProps) {
  const pathname = usePathname();
  const isActive =
    href === "/dashboard"
      ? pathname === "/dashboard"
      : pathname.startsWith(href);

  const inner = (
    <motion.div
      variants={navItemVariants}
      whileHover={!soon && !isActive ? { x: 3 } : undefined}
      className={cn(
        "relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors select-none",
        collapsed ? "justify-center" : "",
        soon
          ? "cursor-default opacity-40"
          : isActive
          ? "text-sidebar-primary-foreground"
          : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground cursor-pointer"
      )}
      title={collapsed ? label : undefined}
    >
      {isActive && (
        <motion.div
          layoutId="activeNavIndicator"
          className="absolute inset-0 rounded-xl bg-sidebar-primary"
          transition={{ type: "spring", stiffness: 380, damping: 32 }}
        />
      )}

      <div className="relative z-10 shrink-0">
        <Icon className={cn(collapsed ? "size-5" : "size-4")} />
        {!!badge && badge > 0 && (
          <span className="absolute -top-1.5 -right-1.5 flex size-3.5 items-center justify-center rounded-full bg-primary text-[8px] font-bold text-primary-foreground">
            {badge > 9 ? "9+" : badge}
          </span>
        )}
      </div>

      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.span
            key="label"
            initial={{ opacity: 0, width: 0 }}
            animate={{ opacity: 1, width: "auto" }}
            exit={{ opacity: 0, width: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="relative z-10 overflow-hidden whitespace-nowrap"
          >
            {label}
            {soon && (
              <span className="ml-2 rounded-sm bg-sidebar-accent px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sidebar-accent-foreground">
                soon
              </span>
            )}
          </motion.span>
        )}
      </AnimatePresence>
    </motion.div>
  );

  if (soon) return inner;

  return (
    <Link href={href} onClick={onClick} className="block outline-none">
      {inner}
    </Link>
  );
}

function SidebarContent({
  collapsed,
  onNavClick,
}: {
  collapsed: boolean;
  onNavClick?: () => void;
}) {
  const user = useAuthStore((s) => s.user);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const logout = useLogout();
  const { data: unreadMap = {} } = useUnreadCounts();
  const totalUnread = Object.values(unreadMap).reduce((a, b) => a + b, 0);

  // Leader Desk is for Super Admins and anyone who leads a team
  const { data: teams = [] } = useTeams();
  const isSuperAdmin = !!(user?.role?.is_system_role && user?.role?.role_name === "Super Admin");
  const showLeaderDesk = isSuperAdmin || teams.some((t) => t.my_role === "leader");

  // Always shown. Hiding it until you had something waiting meant nobody could
  // find the page at all — including the people who needed to look at it before
  // anything had been assigned to them.
  const { data: myVerifications = [] } = useMyVerifications("pending");
  const verifyBadge = myVerifications.length;

  // Badge: pending reviews + unassigned incoming + reedit tasks (only fetched when user can see Leader Desk)
  const { data: leaderData } = useLeaderQueue({ enabled: showLeaderDesk });
  const leaderBadge = showLeaderDesk
    ? (leaderData?.review?.length ?? 0) + (leaderData?.incoming?.length ?? 0) + (leaderData?.reedit?.length ?? 0)
    : 0;

  // Filter nav items the user can see
  const visibleNav = NAV_ITEMS.filter((item) =>
    !item.hidden &&
    (!item.module || hasPermission(item.module, "view")) &&
    (item.href !== "/leader" || showLeaderDesk)
  );
  const visibleBottom = BOTTOM_ITEMS.filter((item) =>
    !item.hidden &&
    (!item.module || hasPermission(item.module, "view")) &&
    (!item.superAdmin || isSuperAdmin)
  );

  const initials = user?.name
    ? user.name.split(" ").map((w: string) => w[0]).join("").slice(0, 2).toUpperCase()
    : user?.email?.[0]?.toUpperCase() ?? "U";

  return (
    <div className="flex h-full flex-col bg-sidebar border-r border-sidebar-border">
      {/* Logo */}
      <div
        className={cn(
          "flex h-16 shrink-0 items-center border-b border-sidebar-border px-4",
          collapsed ? "justify-center" : "gap-3"
        )}
      >
        <motion.div
          whileHover={{ rotate: [0, -10, 10, 0] }}
          transition={{ duration: 0.4 }}
          className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground"
        >
          <BarChart2 className="size-4" />
        </motion.div>
        <AnimatePresence initial={false}>
          {!collapsed && (
            <motion.span
              key="logo-text"
              initial={{ opacity: 0, width: 0 }}
              animate={{ opacity: 1, width: "auto" }}
              exit={{ opacity: 0, width: 0 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
              className="overflow-hidden whitespace-nowrap font-semibold tracking-tight text-sidebar-foreground"
            >
              mediaERP
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      {/* Nav */}
      <motion.nav
        variants={listVariants}
        initial="initial"
        animate="animate"
        className="flex-1 overflow-y-auto overflow-x-hidden px-2 py-4 space-y-0.5"
      >
        {visibleNav.map((item) => (
          <NavItem
            key={item.href}
            {...item}
            collapsed={collapsed}
            onClick={onNavClick}
            badge={
              item.href === "/chat" ? totalUnread :
              item.href === "/leader" ? (leaderBadge || undefined) :
              item.href === "/verify" ? (verifyBadge || undefined) :
              undefined
            }
          />
        ))}

        <div className="my-3 border-t border-sidebar-border" />

        {visibleBottom.map((item) => (
          <NavItem key={item.href} {...item} collapsed={collapsed} onClick={onNavClick} />
        ))}
      </motion.nav>

      {/* Footer */}
      <div className="shrink-0 border-t border-sidebar-border px-2 py-3 space-y-1">
        {/* Install app (hidden once installed) */}
        <InstallAppRow collapsed={collapsed} />

        {/* Theme toggle row */}
        <div
          className={cn(
            "flex items-center rounded-xl px-3 py-2",
            collapsed ? "justify-center" : "gap-3"
          )}
        >
          <ThemeToggle />
          <AnimatePresence initial={false}>
            {!collapsed && (
              <motion.span
                key="theme-label"
                initial={{ opacity: 0, width: 0 }}
                animate={{ opacity: 1, width: "auto" }}
                exit={{ opacity: 0, width: 0 }}
                transition={{ duration: 0.18 }}
                className="overflow-hidden whitespace-nowrap text-sm text-sidebar-foreground/60"
              >
                Theme
              </motion.span>
            )}
          </AnimatePresence>
        </div>

        {/* User (→ profile) + logout.
            The sign-out button is a sibling of the link, never nested inside it —
            a <button> inside an <a> is invalid HTML and swallows the click. */}
        <div
          className={cn(
            "flex items-center rounded-xl px-3 py-2 gap-3",
            collapsed ? "justify-center" : ""
          )}
        >
          <Link
            href="/profile"
            title="View your profile"
            aria-label="View your profile"
            className={cn(
              "flex min-w-0 items-center gap-3 rounded-lg outline-none transition-colors hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring",
              collapsed ? "" : "flex-1 -mx-1 px-1 py-0.5"
            )}
          >
            <motion.div
              whileHover={{ scale: 1.08 }}
              className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground text-xs font-bold"
            >
              {initials}
            </motion.div>

            <AnimatePresence initial={false}>
              {!collapsed && (
                <motion.div
                  key="user-info"
                  initial={{ opacity: 0, width: 0 }}
                  animate={{ opacity: 1, width: "auto" }}
                  exit={{ opacity: 0, width: 0 }}
                  transition={{ duration: 0.18 }}
                  className="min-w-0 overflow-hidden"
                >
                  <p className="truncate text-xs font-medium text-sidebar-foreground">
                    {user?.name ?? user?.email}
                  </p>
                  {user?.name && (
                    <p className="truncate text-[10px] text-sidebar-foreground/50">
                      {user.email}
                    </p>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </Link>

          <AnimatePresence initial={false}>
            {!collapsed && (
              <motion.button
                key="logout"
                initial={{ opacity: 0, width: 0 }}
                animate={{ opacity: 1, width: "auto" }}
                exit={{ opacity: 0, width: 0 }}
                transition={{ duration: 0.18 }}
                whileHover={{ scale: 1.15 }}
                whileTap={{ scale: 0.9 }}
                onClick={() => logout.mutate()}
                className="shrink-0 rounded-md p-1 text-sidebar-foreground/50 hover:bg-sidebar-accent hover:text-destructive transition-colors"
                title="Sign out"
              >
                <LogOut className="size-3.5" />
              </motion.button>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

export function Sidebar() {
  const { sidebarCollapsed, toggleSidebar, mobileOpen, setMobileOpen } =
    useUiStore();
  const pathname = usePathname();

  // Always close the mobile drawer when the route changes. Otherwise the drawer
  // and its full-screen backdrop can linger (AnimatePresence can skip the
  // unmount when navigation re-renders the tree mid-exit) and swallow every tap.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname, setMobileOpen]);

  return (
    <>
      {/* Desktop sidebar */}
      <motion.aside
        animate={{ width: sidebarCollapsed ? 64 : 240 }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
        className="relative hidden shrink-0 lg:block"
      >
        <div className="sticky top-0 h-screen overflow-hidden">
          <SidebarContent collapsed={sidebarCollapsed} />
        </div>

        {/* Collapse toggle */}
        <motion.button
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.9 }}
          onClick={toggleSidebar}
          className="absolute -right-3 top-20 z-50 flex size-6 items-center justify-center rounded-full border border-sidebar-border bg-sidebar text-sidebar-foreground shadow-sm hover:bg-sidebar-accent transition-colors"
        >
          <motion.div
            animate={{ rotate: sidebarCollapsed ? 0 : 180 }}
            transition={{ duration: 0.25 }}
          >
            <ChevronLeft className="size-3.5" />
          </motion.div>
        </motion.button>
      </motion.aside>

      {/* Mobile overlay — always mounted, toggled via `animate` + `pointer-events`.
          A conditional AnimatePresence overlay could get its unmount skipped when
          a nav tap navigates mid-exit, leaving an invisible backdrop that
          swallowed every click. Gating pointer-events on `mobileOpen` guarantees a
          closed overlay can never block interaction. */}
      <motion.div
        aria-hidden={!mobileOpen}
        initial={false}
        animate={{ opacity: mobileOpen ? 1 : 0 }}
        transition={{ duration: 0.2 }}
        style={{ pointerEvents: mobileOpen ? "auto" : "none" }}
        className="fixed inset-0 z-40 bg-black/50 lg:hidden"
        onClick={() => setMobileOpen(false)}
      />
      <motion.aside
        initial={false}
        animate={{ x: mobileOpen ? 0 : "-100%" }}
        transition={{ type: "spring", stiffness: 320, damping: 34 }}
        style={{ pointerEvents: mobileOpen ? "auto" : "none" }}
        className="fixed left-0 top-0 z-50 h-full w-64 lg:hidden"
      >
        <SidebarContent
          collapsed={false}
          onNavClick={() => setMobileOpen(false)}
        />
      </motion.aside>
    </>
  );
}
