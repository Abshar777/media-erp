"use client";

import { useState, useMemo, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  CalendarDays, ChevronLeft, ChevronRight, Clock,
  Image as ImageIcon, Plus, RefreshCw, Share2, X,
} from "lucide-react";
import { toast } from "sonner";

import PageHeader from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { SelectField } from "@/components/ui/select-field";
import {
  useScheduledPosts, useCreateScheduledPost, useCancelScheduledPost,
  type ScheduledPost,
} from "@/hooks/useSchedule";
import { useConnectors } from "@/hooks/useConnectors";
import type { Connector } from "@/types/connector";
import { fmtDateTimeIST } from "@/lib/datetime";

// ── Helpers ───────────────────────────────────────────────────────────────────
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

function isoDate(d: Date): string { return d.toISOString().slice(0, 10); }
function localIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function getMonthGrid(year: number, month: number): (Date | null)[] {
  const first = new Date(year, month, 1);
  const last  = new Date(year, month + 1, 0);
  const cells: (Date | null)[] = [];
  for (let i = 0; i < first.getDay(); i++) cells.push(null);
  for (let d = 1; d <= last.getDate(); d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

// ── Status chip ───────────────────────────────────────────────────────────────
const STATUS_STYLES: Record<string, string> = {
  pending:   "bg-blue-500/20 text-blue-700 dark:text-blue-300",
  published: "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300",
  failed:    "bg-red-500/20 text-red-700 dark:text-red-300",
  cancelled: "bg-muted text-muted-foreground",
};

function StatusChip({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium capitalize ${STATUS_STYLES[status] ?? STATUS_STYLES.pending}`}>
      {status}
    </span>
  );
}

// ── Platform icon ─────────────────────────────────────────────────────────────
function PlatformBadge({ platform }: { platform: string }) {
  if (platform === "instagram_login") return (
    <span className="flex items-center gap-1 text-xs text-muted-foreground">
      <Share2 className="size-3" /> Instagram
    </span>
  );
  return (
    <span className="flex items-center gap-1 text-xs text-muted-foreground">
      <ImageIcon className="size-3" /> {platform.replace(/_/g, " ")}
    </span>
  );
}

// ── Post Detail Popover ───────────────────────────────────────────────────────
function PostDetailPanel({ post, onClose }: { post: ScheduledPost; onClose: () => void }) {
  const cancel = useCancelScheduledPost();

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      className="fixed right-4 top-20 z-50 w-80 rounded-2xl border bg-card p-5 shadow-2xl"
    >
      <div className="mb-3 flex items-start justify-between">
        <div>
          <StatusChip status={post.status} />
          <PlatformBadge platform={post.platform} />
        </div>
        <button onClick={onClose} className="rounded-lg p-1 text-muted-foreground hover:bg-muted transition-colors">
          <X className="size-4" />
        </button>
      </div>

      {post.image_url && (
        <img src={post.image_url} alt="preview" className="mb-3 w-full rounded-xl object-cover" style={{ maxHeight: 160 }} />
      )}

      <p className="mb-3 whitespace-pre-wrap text-sm">{post.caption || <span className="italic text-muted-foreground">No caption</span>}</p>

      <div className="mb-3 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Clock className="size-3" />
        Scheduled: {fmtDateTimeIST(post.scheduled_at)}
      </div>

      {post.error && (
        <p className="mb-3 rounded-lg bg-red-500/10 p-2 text-xs text-red-600">{post.error}</p>
      )}

      {post.status === "pending" && (
        <Button
          size="sm" variant="outline"
          className="w-full text-red-500 hover:border-red-500/50 hover:text-red-600"
          onClick={() => cancel.mutate(post.id, { onSuccess: onClose })}
          disabled={cancel.isPending}
        >
          {cancel.isPending ? <RefreshCw className="mr-2 size-3 animate-spin" /> : null}
          Cancel post
        </Button>
      )}
    </motion.div>
  );
}

// ── Create Post Modal ─────────────────────────────────────────────────────────
const SUPPORTED_PLATFORMS = ["instagram_login", "facebook_pages"];

function CreateModal({ onClose }: { onClose: () => void }) {
  const { data: connectors = [] } = useConnectors();
  const create = useCreateScheduledPost();

  const eligible = (connectors as Connector[]).filter(
    c => SUPPORTED_PLATFORMS.includes(c.platform) && c.status === "connected"
  );

  const [connectorId, setConnectorId] = useState(eligible[0]?.id ?? "");
  const [caption, setCaption]         = useState("");
  const [imageUrl, setImageUrl]       = useState("");
  const [scheduledAt, setScheduledAt] = useState("");

  // Sync connectorId once connectors finish loading (useState initialises before fetch resolves)
  useEffect(() => {
    if (!connectorId && eligible.length > 0) {
      setConnectorId(eligible[0].id);
    }
  }, [eligible, connectorId]);

  const selectedConn = eligible.find(c => c.id === connectorId);

  function submit() {
    if (!connectorId) { toast.error("Select a connector"); return; }
    if (!caption.trim()) { toast.error("Caption is required"); return; }
    if (!scheduledAt) { toast.error("Select a date and time"); return; }
    const scheduledUtc = new Date(scheduledAt).toISOString();
    if (new Date(scheduledUtc) <= new Date()) { toast.error("Scheduled time must be in the future"); return; }

    create.mutate({
      connector_id: connectorId,
      platform: selectedConn?.platform ?? "instagram_login",
      caption,
      image_url: imageUrl || undefined,
      scheduled_at: scheduledUtc,
      ig_user_id: selectedConn?.platform_account_id ?? undefined,
    }, { onSuccess: onClose });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 8 }}
        className="relative w-full max-w-md rounded-2xl border bg-card p-6 shadow-2xl"
      >
        <button onClick={onClose} className="absolute right-4 top-4 rounded-lg p-1.5 text-muted-foreground hover:bg-muted transition-colors">
          <X className="size-4" />
        </button>

        <div className="mb-4 flex items-center gap-2">
          <CalendarDays className="size-5 text-primary" />
          <h2 className="text-base font-semibold">Schedule a Post</h2>
        </div>

        <div className="space-y-3">
          {/* Connector */}
          <div>
            <label htmlFor="schedule-account" className="mb-1 block text-xs font-medium">Account</label>
            {eligible.length === 0 ? (
              <p className="rounded-lg bg-amber-500/10 p-3 text-xs text-amber-600">
                No connected Instagram or Facebook accounts found. Add a connector first.
              </p>
            ) : (
              <SelectField
                id="schedule-account"
                value={connectorId} onValueChange={v => setConnectorId(v)}
                options={eligible.map(c => ({
                  value: c.id,
                  label: `${c.name} (${c.platform.replace(/_/g, " ")})`,
                }))}
              />
            )}
          </div>

          {/* Caption */}
          <div>
            <label className="mb-1 block text-xs font-medium">Caption</label>
            <textarea
              value={caption} onChange={e => setCaption(e.target.value)}
              rows={4}
              className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/30 resize-none"
              placeholder="Write your caption…"
            />
            <p className="mt-1 text-right text-[11px] text-muted-foreground">{caption.length} chars</p>
          </div>

          {/* Image URL */}
          <div>
            <label className="mb-1 block text-xs font-medium">Image / Video URL <span className="text-muted-foreground">(optional)</span></label>
            <input
              type="url" value={imageUrl} onChange={e => setImageUrl(e.target.value)}
              className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/30"
              placeholder="https://…"
            />
          </div>

          {/* Date + Time */}
          <div>
            <label className="mb-1 block text-xs font-medium">Schedule Date & Time</label>
            <input
              type="datetime-local"
              value={scheduledAt} onChange={e => setScheduledAt(e.target.value)}
              min={new Date(Date.now() + 60_000).toISOString().slice(0, 16)}
              className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/30"
            />
          </div>

          <Button className="w-full" onClick={submit} disabled={create.isPending || eligible.length === 0}>
            {create.isPending ? <RefreshCw className="mr-2 size-4 animate-spin" /> : <CalendarDays className="mr-2 size-4" />}
            Schedule Post
          </Button>
        </div>
      </motion.div>
    </div>
  );
}

// ── Calendar Month Grid ───────────────────────────────────────────────────────
function CalendarGrid({
  year, month, posts, onSelectPost,
}: {
  year: number;
  month: number;
  posts: ScheduledPost[];
  onSelectPost: (p: ScheduledPost) => void;
}) {
  const cells = useMemo(() => getMonthGrid(year, month), [year, month]);

  // Build date → posts map
  const postsByDate = useMemo(() => {
    const map: Record<string, ScheduledPost[]> = {};
    for (const p of posts) {
      const d = localIsoDate(new Date(p.scheduled_at));
      if (!map[d]) map[d] = [];
      map[d].push(p);
    }
    return map;
  }, [posts]);

  const today = localIsoDate(new Date());

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      {/* Day headers */}
      <div className="grid grid-cols-7 border-b bg-muted/30">
        {DAYS.map(d => (
          <div key={d} className="py-2 text-center text-xs font-semibold uppercase text-muted-foreground">
            {d}
          </div>
        ))}
      </div>

      {/* Cells */}
      <div className="grid grid-cols-7">
        {cells.map((date, idx) => {
          const dateStr = date ? localIsoDate(date) : null;
          const dayPosts = dateStr ? (postsByDate[dateStr] ?? []) : [];
          const isToday = dateStr === today;

          return (
            <div
              key={idx}
              className={`min-h-[90px] border-b border-r p-1.5 last:border-r-0 ${
                !date ? "bg-muted/10" : "hover:bg-muted/20 transition-colors"
              } ${idx % 7 === 6 ? "border-r-0" : ""}`}
            >
              {date && (
                <>
                  <div className={`mb-1 flex size-6 items-center justify-center rounded-full text-xs font-medium ${
                    isToday ? "bg-primary text-primary-foreground" : "text-muted-foreground"
                  }`}>
                    {date.getDate()}
                  </div>
                  <div className="space-y-0.5">
                    {dayPosts.slice(0, 3).map(p => (
                      <button
                        key={p.id}
                        onClick={() => onSelectPost(p)}
                        className={`w-full truncate rounded px-1 py-0.5 text-left text-[10px] font-medium leading-tight transition-opacity hover:opacity-80 ${STATUS_STYLES[p.status] ?? STATUS_STYLES.pending}`}
                      >
                        {p.caption?.slice(0, 24) || "Post"}
                      </button>
                    ))}
                    {dayPosts.length > 3 && (
                      <p className="pl-1 text-[10px] text-muted-foreground">+{dayPosts.length - 3} more</p>
                    )}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Upcoming List ─────────────────────────────────────────────────────────────
function UpcomingList({ posts, onSelect }: { posts: ScheduledPost[]; onSelect: (p: ScheduledPost) => void }) {
  const upcoming = posts
    .filter(p => p.status === "pending" && new Date(p.scheduled_at) > new Date())
    .sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime())
    .slice(0, 10);

  if (upcoming.length === 0) return (
    <p className="py-6 text-center text-sm text-muted-foreground">No upcoming scheduled posts</p>
  );

  return (
    <div className="space-y-2">
      {upcoming.map(p => (
        <motion.button
          key={p.id}
          onClick={() => onSelect(p)}
          whileHover={{ x: 3 }}
          className="flex w-full items-start gap-3 rounded-xl border bg-card p-3 text-left hover:bg-muted/30 transition-colors"
        >
          {p.image_url && (
            <img src={p.image_url} alt="" className="size-10 shrink-0 rounded-lg object-cover" />
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{p.caption || <span className="italic text-muted-foreground">No caption</span>}</p>
            <div className="mt-0.5 flex items-center gap-2">
              <PlatformBadge platform={p.platform} />
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Clock className="size-3" />
                {fmtDateTimeIST(p.scheduled_at, { dateStyle: "medium", timeStyle: "short" })}
              </span>
            </div>
          </div>
          <StatusChip status={p.status} />
        </motion.button>
      ))}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function SchedulePage() {
  const now = new Date();
  const [year, setYear]   = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [showCreate, setShowCreate] = useState(false);
  const [selected, setSelected]     = useState<ScheduledPost | null>(null);

  // Fetch all posts for the displayed month + a buffer
  const monthStart = `${year}-${String(month + 1).padStart(2, "0")}-01`;
  const monthEnd   = `${year}-${String(month + 1).padStart(2, "0")}-31`;

  const { data, isLoading } = useScheduledPosts({ from: monthStart, to: monthEnd });
  const allPosts = data?.posts ?? [];

  function prevMonth() {
    if (month === 0) { setYear(y => y - 1); setMonth(11); }
    else setMonth(m => m - 1);
  }
  function nextMonth() {
    if (month === 11) { setYear(y => y + 1); setMonth(0); }
    else setMonth(m => m + 1);
  }

  // Also fetch upcoming for the list (broader range)
  const { data: upcomingData } = useScheduledPosts({ status: "pending" });
  const upcomingPosts = upcomingData?.posts ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Content Calendar"
        subtitle="Schedule and manage your social media posts"
        action={
          <Button onClick={() => setShowCreate(true)}>
            <Plus className="mr-2 size-4" /> Schedule Post
          </Button>
        }
      />

      {/* Month navigation */}
      <div className="flex items-center gap-3">
        <motion.button
          whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
          onClick={prevMonth}
          className="flex size-8 items-center justify-center rounded-lg border bg-card hover:bg-muted transition-colors"
        >
          <ChevronLeft className="size-4" />
        </motion.button>

        <h2 className="min-w-[160px] text-center text-base font-semibold">
          {MONTHS[month]} {year}
        </h2>

        <motion.button
          whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
          onClick={nextMonth}
          className="flex size-8 items-center justify-center rounded-lg border bg-card hover:bg-muted transition-colors"
        >
          <ChevronRight className="size-4" />
        </motion.button>

        <button
          onClick={() => { setYear(now.getFullYear()); setMonth(now.getMonth()); }}
          className="ml-2 rounded-lg border bg-card px-3 py-1.5 text-xs font-medium hover:bg-muted transition-colors"
        >
          Today
        </button>

        {isLoading && <RefreshCw className="size-3.5 animate-spin text-muted-foreground" />}

        {/* Legend */}
        <div className="ml-auto flex items-center gap-3 text-xs">
          {["pending","published","failed"].map(s => (
            <span key={s} className={`flex items-center gap-1.5 rounded-full px-2 py-0.5 font-medium ${STATUS_STYLES[s]}`}>
              <span className="size-1.5 rounded-full bg-current" />
              {s}
            </span>
          ))}
        </div>
      </div>

      {/* Calendar */}
      <CalendarGrid year={year} month={month} posts={allPosts} onSelectPost={setSelected} />

      {/* Upcoming posts list */}
      <div>
        <h3 className="mb-3 text-sm font-semibold">Upcoming Posts</h3>
        <UpcomingList posts={upcomingPosts} onSelect={setSelected} />
      </div>

      {/* Modals */}
      <AnimatePresence>
        {showCreate && <CreateModal onClose={() => setShowCreate(false)} />}
        {selected && <PostDetailPanel post={selected} onClose={() => setSelected(null)} />}
      </AnimatePresence>
    </div>
  );
}
