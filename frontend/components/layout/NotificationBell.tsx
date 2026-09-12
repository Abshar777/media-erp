"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  BellRing,
  ArrowLeftRight,
  AtSign,
  Bell, CheckCheck, RefreshCw, ServerCrash, Wifi,
  ClipboardList, Play, Coffee, Eye, CheckCircle2,
  RotateCcw, Users, Clock,
} from "lucide-react";
import { fadeVariants, listItemVariants, listVariants } from "@/lib/animations";
import { useMarkAllRead, useMarkRead, useNotifications } from "@/hooks/useNotifications";
import type { Notification } from "@/types/notification";
import {
  desktopPermission,
  requestDesktopPermission,
  subscribeToPush,
} from "@/lib/browserNotifications";
import { cn } from "@/lib/utils";

// ── Relative time formatter ───────────────────────────────────────────────────
function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ── Icon + colour per notification type ──────────────────────────────────────
function typeConfig(type: string): { icon: React.ReactNode; bg: string } {
  switch (type) {
    case "task_assigned":
      return { icon: <ClipboardList className="size-3.5 text-blue-500" />,    bg: "bg-blue-100 dark:bg-blue-900/30" };
    case "task_started":
      return { icon: <Play className="size-3.5 text-emerald-500" />,          bg: "bg-emerald-100 dark:bg-emerald-900/30" };
    case "task_break":
      return { icon: <Coffee className="size-3.5 text-yellow-500" />,         bg: "bg-yellow-100 dark:bg-yellow-900/30" };
    case "pending_review":
      return { icon: <Eye className="size-3.5 text-amber-500" />,             bg: "bg-amber-100 dark:bg-amber-900/30" };
    case "task_approved":
      return { icon: <CheckCircle2 className="size-3.5 text-emerald-500" />,  bg: "bg-emerald-100 dark:bg-emerald-900/30" };
    case "task_reedit":
      return { icon: <RotateCcw className="size-3.5 text-orange-500" />,      bg: "bg-orange-100 dark:bg-orange-900/30" };
    case "team_task_assigned":
      return { icon: <Users className="size-3.5 text-purple-500" />,          bg: "bg-purple-100 dark:bg-purple-900/30" };
    case "due_date_reminder":
      return { icon: <Clock className="size-3.5 text-red-500" />,             bg: "bg-red-100 dark:bg-red-900/30" };
    case "task_transferred":
      return { icon: <ArrowLeftRight className="size-3.5 text-sky-500" />,   bg: "bg-sky-100 dark:bg-sky-900/30" };
    case "mention":
      return { icon: <AtSign className="size-3.5 text-sky-500" />,            bg: "bg-sky-100 dark:bg-sky-900/30" };
    case "sync_success":
      return { icon: <Wifi className="size-3.5 text-emerald-500" />,          bg: "bg-emerald-100 dark:bg-emerald-900/30" };
    case "sync_error":
      return { icon: <ServerCrash className="size-3.5 text-destructive" />,   bg: "bg-red-100 dark:bg-red-900/30" };
    default:
      return { icon: <Bell className="size-3.5 text-primary" />,              bg: "bg-muted" };
  }
}

// Route to navigate to when a task-related notification is clicked
const TASK_TYPES = new Set([
  "task_assigned", "task_started", "task_break", "pending_review",
  "task_approved", "task_reedit", "team_task_assigned", "due_date_reminder",
  "task_transferred",
]);

// ── Single notification row ───────────────────────────────────────────────────
function NotifRow({ item, onClose }: { item: Notification; onClose: () => void }) {
  const markRead = useMarkRead();
  const router   = useRouter();
  const { icon, bg } = typeConfig(item.type);

  function handleClick() {
    if (!item.read) markRead.mutate(item.id);
    if (TASK_TYPES.has(item.type)) {
      router.push("/projects");
      onClose();
    }
  }

  return (
    <motion.button
      variants={listItemVariants}
      type="button"
      onClick={handleClick}
      className={cn(
        "w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-muted/60 transition-colors",
        !item.read && "bg-primary/5"
      )}
    >
      <div className={cn("mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full", bg)}>
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className={cn("text-xs font-medium truncate", !item.read ? "text-foreground" : "text-muted-foreground")}>
          {item.title}
        </p>
        <p className="mt-0.5 text-[11px] text-muted-foreground line-clamp-2">{item.message}</p>
        <p className="mt-1 text-[10px] text-muted-foreground/60">{timeAgo(item.created_at)}</p>
      </div>
      {!item.read && (
        <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" />
      )}
    </motion.button>
  );
}

// ── Main bell component ───────────────────────────────────────────────────────
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  // Read on mount only — Notification.permission isn't available during SSR.
  const [alertPerm, setAlertPerm] = useState<string>("unsupported");
  useEffect(() => {
    const perm = desktopPermission();
    setAlertPerm(perm);
    // Someone who granted permission before web push existed has no
    // subscription yet; subscribeToPush is idempotent, so just try.
    if (perm === "granted") void subscribeToPush();
  }, []);
  const ref = useRef<HTMLDivElement>(null);
  const { data, isLoading } = useNotifications(30);
  const markAll = useMarkAllRead();

  const unread = data?.unread_count ?? 0;
  const items  = data?.items ?? [];

  // Close on outside click
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      {/* Bell button */}
      <motion.button
        whileHover={{ scale: 1.08 }}
        whileTap={{ scale: 0.92 }}
        onClick={() => setOpen((v) => !v)}
        className="relative flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        title="Notifications"
      >
        <Bell className="size-4" />
        <AnimatePresence>
          {unread > 0 && (
            <motion.span
              key="badge"
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0 }}
              className="absolute -right-0.5 -top-0.5 flex min-w-[16px] h-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground"
            >
              {unread > 99 ? "99+" : unread}
            </motion.span>
          )}
        </AnimatePresence>
      </motion.button>

      {/* Dropdown */}
      <AnimatePresence>
        {open && (
          <motion.div
            key="dropdown"
            variants={fadeVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className="absolute right-0 top-10 z-50 w-80 rounded-xl border bg-card shadow-xl overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b px-4 py-2.5">
              <p className="text-xs font-semibold">
                Notifications
                {unread > 0 && (
                  <span className="ml-2 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold text-primary">
                    {unread} new
                  </span>
                )}
              </p>
              {unread > 0 && (
                <button
                  type="button"
                  onClick={() => markAll.mutate()}
                  disabled={markAll.isPending}
                  className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                >
                  <CheckCheck className="size-3" />
                  Mark all read
                </button>
              )}
            </div>

            {/* Desktop alerts — only shown while the browser can still be asked.
                Once granted or blocked there is nothing useful to offer here. */}
            {alertPerm === "default" && (
              <button
                type="button"
                onClick={async () => {
                  const perm = await requestDesktopPermission();
                  setAlertPerm(perm);
                  // Also register for Web Push, so alerts still arrive once
                  // every tab is closed. No-ops if the server has no VAPID keys.
                  if (perm === "granted") void subscribeToPush();
                }}
                className="flex w-full items-center gap-2 border-b bg-primary/5 px-4 py-2.5 text-left text-[11px] text-primary hover:bg-primary/10 transition-colors"
              >
                <BellRing className="size-3.5 shrink-0" />
                Turn on desktop alerts for mentions, assignments and approvals
              </button>
            )}
            {alertPerm === "denied" && (
              <p className="border-b px-4 py-2 text-[11px] text-muted-foreground">
                Desktop alerts are blocked in your browser settings for this site.
              </p>
            )}

            {/* Body */}
            <div className="max-h-[360px] overflow-y-auto">
              {isLoading && (
                <div className="flex h-24 items-center justify-center">
                  <RefreshCw className="size-4 animate-spin text-muted-foreground" />
                </div>
              )}

              {!isLoading && items.length === 0 && (
                <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
                  <Bell className="size-8 text-muted-foreground/30" />
                  <p className="text-xs text-muted-foreground">No notifications yet</p>
                </div>
              )}

              {!isLoading && items.length > 0 && (
                <motion.div
                  variants={listVariants}
                  initial="initial"
                  animate="animate"
                  className="divide-y divide-border"
                >
                  {items.map((item) => (
                    <NotifRow key={item.id} item={item} onClose={() => setOpen(false)} />
                  ))}
                </motion.div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
