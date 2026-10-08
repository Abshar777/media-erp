"use client";

import { Suspense, useState, useMemo, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { AnimatePresence } from "framer-motion";
import {
  ClipboardCheck, CheckCircle2, RotateCcw, Inbox, UserPlus,
  Search,
  Loader2, Calendar, Crown, ChevronDown, Paperclip,
  MessageSquare, Eye, AlertTriangle, TrendingDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  useLeaderQueue,
  useUpdateTask,
  type LeaderTeam,
  type LeaderQueueFilters,
} from "@/hooks/useProjects";
import { TaskDetailModal } from "@/components/projects/TaskDetailModal";
import { AdFlagCard } from "@/components/leader/AdFlagCard";
import { useAdFlagInbox } from "@/hooks/useAdFlags";
import type { AdFlagScope } from "@/types/adFlag";

const AD_SCOPE_LABEL: Record<AdFlagScope, string> = { to_me: "Sent to me", sent: "Sent by me", all: "All" };
const AD_SCOPE_HINT: Record<AdFlagScope, string> = {
  to_me: "Marketing flagged these ads as not performing. Watch the ad, check the numbers, then recreate it.",
  sent: "Ads you marked as not performing — and which leader has each one now.",
  all: "Every ad marked as not performing, across all teams.",
};
const AD_SCOPE_EMPTY: Record<AdFlagScope, string> = {
  to_me: "When marketing marks an ad as not performing and sends it to you, it shows up here.",
  sent: "Ads you mark as not performing (on an ad's report) show up here, with who has them.",
  all: "No ad has been marked as not performing in the last 14 days.",
};
import { ApproveRouteModal, ReeditModal } from "@/components/projects/ReviewActionModals";
import { useAuthStore } from "@/stores/authStore";
import type { Task } from "@/types/project";
import { PRIORITY_META, isTaskOverdue, assigneeLabel, TASK_SCOPES } from "@/types/project";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { fmtDateOnly } from "@/lib/datetime";

type Tab = "review" | "assign" | "reedit" | "ads";
const TABS: Tab[] = ["review", "assign", "reedit", "ads"];

/**
 * ?tab=ads&flag=<id> — where an "Ad not performing" notification lands.
 * Read through useSearchParams (in its own Suspense boundary, so the page stays
 * static): on an in-app navigation the page renders before window.location
 * changes, so reading it once on mount would see the previous page's URL.
 */
function DeskUrl({ onChange }: { onChange: (tab: Tab | null, flag: string) => void }) {
  const q = useSearchParams();
  const t = q.get("tab") as Tab | null;
  const flag = q.get("flag") ?? "";
  useEffect(() => { onChange(t && TABS.includes(t) ? t : null, flag); }, [t, flag, onChange]);
  return null;
}

// ── Review card ───────────────────────────────────────────────────────────────

function ReviewCard({
  task, teamName, onReedit, onApprove,
}: {
  task: Task;
  teamName: string;
  onReedit: (t: Task) => void;
  onApprove: (t: Task) => void;
}) {
  const [detailOpen, setDetailOpen] = useState(false);
  const pri = PRIORITY_META[task.priority];
  const overdue = isTaskOverdue(task);
  const attachmentCount = task.attachments?.length ?? 0;

  return (
    <>
      <div className="rounded-xl border bg-card shadow-sm overflow-hidden flex flex-col">
        <button
          type="button"
          onClick={() => setDetailOpen(true)}
          className="flex-1 text-left px-4 pt-4 pb-3 hover:bg-muted/20 transition-colors group/card"
        >
          <div className="flex items-start justify-between gap-3 mb-1.5">
            <p className="text-sm font-semibold leading-snug flex-1 group-hover/card:text-primary transition-colors">
              {task.title}
            </p>
            <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold shrink-0", pri.color)}>
              {pri.label}
            </span>
          </div>

          {task.description && (
            <p className="text-xs text-muted-foreground line-clamp-2 mb-2">{task.description}</p>
          )}

          {task.caption && (
            <div className="mb-2 rounded-md border border-purple-400/30 bg-purple-500/5 px-2.5 py-1.5">
              <p className="text-[10px] font-semibold text-purple-600 dark:text-purple-400 flex items-center gap-1 mb-0.5">
                <MessageSquare className="size-3" /> Submission Note
              </p>
              <p className="text-xs text-foreground/80 line-clamp-2">{task.caption}</p>
            </div>
          )}

          <div className="flex items-center flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            {assigneeLabel(task) && (
              <span className="flex items-center gap-1">
                <span className="flex size-4 items-center justify-center rounded-full bg-primary/10 text-primary font-bold text-[9px]">
                  {assigneeLabel(task)[0]?.toUpperCase()}
                </span>
                {assigneeLabel(task)}
              </span>
            )}
            {teamName ? (
              <span className="rounded-full bg-muted px-2 py-0.5">{teamName}</span>
            ) : (
              /* Personal work has no team board and therefore no team leader,
                 so it lands on the admins' desk — say so rather than leaving a
                 gap where every other card shows a team. */
              <span className="rounded-full bg-muted/60 px-2 py-0.5 italic text-muted-foreground/70">
                No team
              </span>
            )}
            {task.due_date && (
              <span className={cn("flex items-center gap-0.5", overdue && "text-red-500 font-semibold")}>
                <Calendar className="size-3" />
                {fmtDateOnly(task.due_date, { day: "numeric", month: "short" })}
              </span>
            )}
            {attachmentCount > 0 && (
              <span className="flex items-center gap-0.5">
                <Paperclip className="size-3" /> {attachmentCount}
              </span>
            )}
          </div>
        </button>

        <div className="border-t px-4 py-3 flex gap-2">
          <Button
            size="sm" variant="outline"
            onClick={() => setDetailOpen(true)}
            className="gap-1.5 text-muted-foreground hover:text-foreground"
          >
            <Eye className="size-3.5" /> View
          </Button>
          <Button
            size="sm"
            className="flex-1 bg-green-600 hover:bg-green-700 text-white"
            onClick={() => onApprove(task)}
          >
            <CheckCircle2 className="size-4 mr-1.5" /> Approve
          </Button>
          <Button
            size="sm" variant="outline"
            className="flex-1 border-rose-400/40 text-rose-600 hover:bg-rose-500/10"
            onClick={() => onReedit(task)}
          >
            <RotateCcw className="size-4 mr-1.5" /> Reedit
          </Button>
        </div>
      </div>

      {detailOpen && (
        <TaskDetailModal
          task={task}
          teamName={teamName}
          readOnly
          onClose={() => setDetailOpen(false)}
        />
      )}
    </>
  );
}

// ── Assign card ───────────────────────────────────────────────────────────────

function AssignCard({
  task, team, onReedit,
}: {
  task: Task;
  team?: LeaderTeam;
  onReedit: (t: Task) => void;
}) {
  const update = useUpdateTask();
  const [memberId, setMemberId] = useState("");
  const [detailOpen, setDetailOpen] = useState(false);
  const pri = PRIORITY_META[task.priority];
  const myId = useAuthStore((s) => s.user)?.id ?? "";

  async function assign() {
    if (!memberId) return;
    const m = team?.members.find((x) => x.id === memberId);
    const name = m?.name ?? "";
    await update.mutateAsync({
      id: task.id,
      payload: { assigned_to: memberId, assigned_to_name: name },
    });
    // A leader may assign work to themselves — say so explicitly.
    toast.success(memberId === myId ? `Assigned to you — "${task.title}"` : `Assigned to ${name}`);
    setMemberId("");
  }

  return (
    <>
      <div className="rounded-xl border bg-card shadow-sm overflow-hidden flex flex-col">
        <button
          type="button"
          onClick={() => setDetailOpen(true)}
          className="flex-1 text-left px-4 pt-4 pb-3 hover:bg-muted/20 transition-colors group/card"
        >
          <div className="flex items-start justify-between gap-3 mb-1.5">
            <p className="text-sm font-semibold leading-snug flex-1 group-hover/card:text-primary transition-colors">
              {task.title}
            </p>
            <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold shrink-0", pri.color)}>
              {pri.label}
            </span>
          </div>
          {task.description && (
            <p className="text-xs text-muted-foreground line-clamp-2 mb-2">{task.description}</p>
          )}
          {task.former_team_name && (
            <div className="mb-2 rounded-md border border-amber-400/30 bg-amber-500/5 px-2.5 py-1.5 text-xs text-amber-700 dark:text-amber-400">
              Routed from <span className="font-semibold">{task.former_team_name}</span>
              {task.former_assigned_to_name && (
                <> · worked by <span className="font-semibold">{task.former_assigned_to_name}</span></>
              )}
            </div>
          )}
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            {team?.name && <span className="rounded-full bg-muted px-2 py-0.5">{team.name}</span>}
            {assigneeLabel(task)
              ? <span>Assigned: {assigneeLabel(task)}</span>
              : <span className="italic text-muted-foreground/60">Unassigned</span>
            }
          </div>
        </button>

        <div className="border-t px-4 py-3 flex gap-2 flex-wrap">
          <Button
            size="sm" variant="outline"
            onClick={() => setDetailOpen(true)}
            className="gap-1.5 text-muted-foreground hover:text-foreground"
          >
            <Eye className="size-3.5" /> View
          </Button>
          <Button
            size="sm" variant="outline"
            className="border-rose-400/40 text-rose-600 hover:bg-rose-500/10"
            onClick={() => onReedit(task)}
          >
            <RotateCcw className="size-3.5 mr-1" /> Reedit
          </Button>
          <div className="flex flex-1 gap-2 min-w-0">
            <select
              value={memberId}
              onChange={(e) => setMemberId(e.target.value)}
              className="flex-1 min-w-0 rounded-lg border bg-background px-3 py-1.5 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
            >
              <option value="">Assign to…</option>
              {team?.members.map((m) => (
                <option key={m.id} value={m.id}>{m.name}{m.role === "leader" ? " (leader)" : ""}</option>
              ))}
            </select>
            <Button size="sm" onClick={assign} disabled={!memberId || update.isPending}>
              {update.isPending ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
            </Button>
          </div>
        </div>
      </div>

      {detailOpen && (
        <TaskDetailModal
          task={task}
          teamName={team?.name}
          readOnly
          onClose={() => setDetailOpen(false)}
        />
      )}
    </>
  );
}

// ── Reedit card ───────────────────────────────────────────────────────────────

function ReeditCard({ task, team }: { task: Task; team?: LeaderTeam }) {
  const update = useUpdateTask();
  const [memberId, setMemberId] = useState(task.assigned_to || "");
  const [detailOpen, setDetailOpen] = useState(false);
  const pri = PRIORITY_META[task.priority];

  function assign() {
    if (!memberId) return;
    const m = team?.members.find((x) => x.id === memberId);
    update.mutate({
      id: task.id,
      payload: { assigned_to: memberId, assigned_to_name: m?.name ?? "", status: "started" },
    });
    toast.success("Task assigned and started");
  }

  return (
    <>
      <div className="rounded-xl border border-rose-200 dark:border-rose-900/40 bg-card shadow-sm overflow-hidden flex flex-col">
        {/* Red top stripe */}
        <div className="h-1 bg-gradient-to-r from-rose-500 to-orange-400" />

        <button
          type="button"
          onClick={() => setDetailOpen(true)}
          className="flex-1 text-left px-4 pt-3 pb-3 hover:bg-muted/20 transition-colors group/card"
        >
          <div className="flex items-start justify-between gap-3 mb-1.5">
            <p className="text-sm font-semibold leading-snug flex-1 group-hover/card:text-primary transition-colors">
              {task.title}
            </p>
            <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold shrink-0", pri.color)}>
              {pri.label}
            </span>
          </div>

          {/* Reedit reason — most prominent element */}
          {task.reedit_reason && (
            <div className="mb-2 rounded-md border border-rose-400/30 bg-rose-500/5 px-2.5 py-2">
              <p className="text-[10px] font-semibold text-rose-600 dark:text-rose-400 flex items-center gap-1 mb-1">
                <AlertTriangle className="size-3" /> Reedit Reason
              </p>
              <p className="text-xs text-foreground/80 leading-relaxed">{task.reedit_reason}</p>
            </div>
          )}

          {task.former_team_name && (
            <div className="mb-2 rounded-md border border-amber-400/30 bg-amber-500/5 px-2.5 py-1.5 text-xs text-amber-700 dark:text-amber-400">
              Returned by <span className="font-semibold">{task.former_team_name}</span>
              {task.former_assigned_to_name && (
                <> · originally worked by <span className="font-semibold">{task.former_assigned_to_name}</span></>
              )}
            </div>
          )}

          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            {team?.name && <span className="rounded-full bg-muted px-2 py-0.5">{team.name}</span>}
          </div>
        </button>

        <div className="border-t px-4 py-3 flex gap-2">
          <Button
            size="sm" variant="outline"
            onClick={() => setDetailOpen(true)}
            className="gap-1.5 text-muted-foreground hover:text-foreground"
          >
            <Eye className="size-3.5" /> View
          </Button>
          <select
            value={memberId}
            onChange={(e) => setMemberId(e.target.value)}
            className="flex-1 rounded-lg border bg-background px-3 py-1.5 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
          >
            <option value="">Assign to…</option>
            {team?.members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}{m.role === "leader" ? " (leader)" : ""}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            onClick={assign}
            disabled={!memberId || update.isPending}
            className="bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            {update.isPending ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
          </Button>
        </div>
      </div>

      {detailOpen && (
        <TaskDetailModal
          task={task}
          teamName={team?.name}
          readOnly
          onClose={() => setDetailOpen(false)}
        />
      )}
    </>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

const DATE_CHIPS: { value: string; label: string }[] = [
  { value: "",           label: "All Time" },
  { value: "today",      label: "Today" },
  { value: "this_week",  label: "This Week" },
  { value: "this_month", label: "This Month" },
  { value: "this_year",  label: "This Year" },
];

export default function LeaderPage() {
  const [qFilters, setQFilters] = useState<LeaderQueueFilters>({
    search: "", priority: "", date_filter: "", assigned: "", scope: "",
  });
  // Debounced so a search doesn't refire the query on every keystroke.
  const [searchInput, setSearchInput] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setQFilters((f) => ({ ...f, search: searchInput })), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const { data, isLoading } = useLeaderQueue(undefined, qFilters);
  const filtersActive = !!(
    qFilters.search || qFilters.priority || qFilters.date_filter ||
    qFilters.assigned || qFilters.scope
  );
  const [tab, setTab] = useState<Tab>("review");
  const [flagParam, setFlagParam] = useState("");
  const onDeskUrl = useMemo(() => (t: Tab | null, flag: string) => {
    if (t) setTab(t);
    setFlagParam(flag);
  }, []);
  // Three views: sent to me / sent by me / all (admin roles). The desk opens on
  // the one that has something — a sender or an admin usually has nothing
  // "sent to me", and an empty tab looked like the ad never arrived.
  const [adScope, setAdScope] = useState<AdFlagScope>("to_me");
  const [adScopeSettled, setAdScopeSettled] = useState(false);
  const { data: adFlags, isFetching: adsFetching } = useAdFlagInbox(adScope);
  useEffect(() => {
    if (adScopeSettled || !adFlags) return;
    setAdScopeSettled(true);
    if ((adFlags.recent.to_me ?? 0) > 0) return;
    const next = (["sent", "all"] as AdFlagScope[]).find((sc) => adFlags.scopes.includes(sc) && (adFlags.recent[sc] ?? 0) > 0);
    if (next) setAdScope(next);
  }, [adFlags, adScopeSettled]);
  const pickAdScope = (sc: AdFlagScope) => { setAdScopeSettled(true); setAdScope(sc); };
  const adsActive = adFlags?.scope === adScope ? adFlags.active : [];
  const adsClosed = adFlags?.scope === adScope ? adFlags.closed : [];
  // Bring the flag a notification pointed at into view once it has loaded.
  useEffect(() => {
    if (!flagParam || !adFlags || tab !== "ads") return;
    document.getElementById(`flag-${flagParam}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [flagParam, adFlags, tab]);
  const [reeditTask, setReeditTask] = useState<Task | null>(null);
  const [approveTask, setApproveTask] = useState<Task | null>(null);
  const [selectedTeamId, setSelectedTeamId] = useState("");

  const teamsById = useMemo(() => {
    const m = new Map<string, LeaderTeam>();
    (data?.teams ?? []).forEach((t) => m.set(t.id, t));
    return m;
  }, [data]);

  const teamsList = data?.teams ?? [];

  const review = useMemo(() => {
    const all = data?.review ?? [];
    if (!selectedTeamId) return all;
    return all.filter((t) => t.team_id === selectedTeamId);
  }, [data, selectedTeamId]);

  const incoming = data?.incoming ?? [];
  const reeditList = data?.reedit ?? [];

  const urlWatcher = <Suspense fallback={null}><DeskUrl onChange={onDeskUrl} /></Suspense>;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data?.is_leader) {
    return (
      <div className="flex flex-col items-center justify-center py-32 gap-3 text-center">
        <Crown className="size-10 text-muted-foreground/30" />
        <p className="font-semibold">Leader Desk</p>
        <p className="text-sm text-muted-foreground max-w-sm">
          This area is for team leaders and admins. You don&apos;t lead any team yet.
        </p>
      </div>
    );
  }

  const tabs: { id: Tab; icon: React.ReactNode; label: string; count: number; danger?: boolean }[] = [
    { id: "review", icon: <ClipboardCheck className="size-4" />, label: "Pending Reviews", count: review.length },
    { id: "assign", icon: <Inbox className="size-4" />, label: "Assign Work",     count: incoming.length },
    { id: "reedit", icon: <RotateCcw className="size-4" />, label: "Reedit",       count: reeditList.length, danger: true },
    // The badge counts what's waiting on *you*.
    { id: "ads",    icon: <TrendingDown className="size-4" />, label: "Ads to redo", count: adFlags?.counts.to_me ?? 0, danger: true },
  ];

  return (
    <div className="flex flex-col gap-5 pb-6">
      {urlWatcher}
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <ClipboardCheck className="size-6 text-primary" /> Leader Desk
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Review your team&apos;s submissions and distribute new work.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-xl bg-muted/50 p-1 border w-fit max-w-full overflow-x-auto">
        {tabs.map(({ id, icon, label, count, danger }) => (
          <button
            key={id} onClick={() => setTab(id)}
            className={cn(
              "flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-all sm:px-4",
              tab === id ? "bg-card text-foreground shadow-sm border" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {icon} {label}
            {count > 0 && (
              <span className={cn(
                "flex h-5 min-w-5 px-1 items-center justify-center rounded-full text-[10px] font-bold",
                danger && count > 0
                  ? tab === id ? "bg-rose-500/20 text-rose-600" : "bg-rose-500/15 text-rose-500"
                  : tab === id ? "bg-primary/15 text-primary" : "bg-muted-foreground/15"
              )}>
                {count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Filters — applied server-side across the three task desks, so a search
          or date range means the same thing whichever of them you are on.
          (Ads to redo is a short list of its own; the filters don't apply.) */}
      {tab !== "ads" && (
      <div className="flex flex-col gap-3 rounded-xl border bg-card p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search tasks…"
              className="w-full rounded-lg border bg-background pl-9 pr-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
            />
          </div>

          <select
            value={qFilters.priority ?? ""}
            onChange={(e) => setQFilters((f) => ({ ...f, priority: e.target.value }))}
            className="rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
          >
            <option value="">All Priorities</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>

          {/* Only meaningful on Assign Work, and only while "Assigned to me" is
              off — that scope already means assigned, so offering
              "Unassigned only" alongside it just contradicts itself. */}
          {tab === "assign" && qFilters.scope !== "assigned_to_me" && (
            <select
              value={qFilters.assigned ?? ""}
              onChange={(e) => setQFilters((f) => ({ ...f, assigned: e.target.value }))}
              className="rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
            >
              <option value="">Unassigned only</option>
              <option value="assigned">Already assigned</option>
              <option value="all">All work</option>
            </select>
          )}

          {filtersActive && (
            <button
              type="button"
              onClick={() => { setSearchInput(""); setQFilters({ search: "", priority: "", date_filter: "", assigned: "", scope: "" }); }}
              className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
            >
              Clear filters
            </button>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          {TASK_SCOPES.map((sc) => {
            const active = qFilters.scope === sc.value;
            return (
              <button
                key={sc.value}
                type="button"
                onClick={() =>
                  setQFilters((f) => {
                    const next = active ? "" : sc.value;
                    return {
                      ...f,
                      scope: next,
                      // "Assigned to me" implies assigned; keeping the
                      // unassigned-only default would return nothing.
                      assigned: next === "assigned_to_me" ? "all" : f.assigned,
                    };
                  })
                }
                className={cn(
                  "rounded-full px-3.5 py-1.5 text-xs font-medium border transition-colors",
                  active
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background hover:bg-muted text-muted-foreground border-border"
                )}
              >
                {sc.label}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap gap-1.5">
          {DATE_CHIPS.map((d) => (
            <button
              key={d.value || "all"}
              type="button"
              onClick={() => setQFilters((f) => ({ ...f, date_filter: d.value }))}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                (qFilters.date_filter ?? "") === d.value
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted/60 text-muted-foreground hover:bg-muted"
              )}
            >
              {d.label}
            </button>
          ))}
        </div>
      </div>
      )}

      {/* Team filter (review tab) */}
      {tab === "review" && teamsList.length > 1 && (
        <div className="flex items-center gap-2.5">
          <span className="text-sm text-muted-foreground shrink-0">Team</span>
          <div className="relative">
            <select
              value={selectedTeamId}
              onChange={(e) => setSelectedTeamId(e.target.value)}
              className="appearance-none rounded-lg border bg-card px-3 py-1.5 pr-8 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30 cursor-pointer"
            >
              <option value="">All teams</option>
              {teamsList.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          </div>
          {selectedTeamId && (
            <button
              onClick={() => setSelectedTeamId("")}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Clear
            </button>
          )}
        </div>
      )}

      {/* Review tab */}
      {tab === "review" && (
        review.length === 0 ? (
          <Empty
            icon={<CheckCircle2 className="size-10" />}
            title="No pending reviews"
            sub="Submissions from your team will appear here."
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {review.map((t) => (
              <ReviewCard
                key={t.id}
                task={t}
                teamName={teamsById.get(t.team_id || "")?.name ?? ""}
                onReedit={setReeditTask}
                onApprove={setApproveTask}
              />
            ))}
          </div>
        )
      )}

      {/* Assign tab */}
      {tab === "assign" && (
        incoming.length === 0 ? (
          <Empty
            icon={<Inbox className="size-10" />}
            title="No new work to assign"
            sub="New unassigned tasks in your teams show up here."
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {incoming.map((t) => (
              <AssignCard key={t.id} task={t} team={teamsById.get(t.team_id || "")} onReedit={setReeditTask} />
            ))}
          </div>
        )
      )}

      {/* Reedit tab */}
      {tab === "reedit" && (
        reeditList.length === 0 ? (
          <Empty
            icon={<RotateCcw className="size-10" />}
            title="No reedit tasks"
            sub="Tasks returned for revision will appear here with the reedit reason."
          />
        ) : (
          <>
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-rose-500/5 border border-rose-400/20 text-xs text-rose-600 dark:text-rose-400">
              <AlertTriangle className="size-3.5 shrink-0" />
              These tasks were returned for revision. Read the reason, then assign to an employee to fix.
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {reeditList.map((t) => (
                <ReeditCard key={t.id} task={t} team={teamsById.get(t.team_id || "")} />
              ))}
            </div>
          </>
        )
      )}

      {/* Ads to redo — ads marked as not performing: sent to me / by me / all */}
      {tab === "ads" && (
        <>
          {adFlags && adFlags.scopes.length > 1 && (
            <div className="flex w-fit max-w-full gap-1 overflow-x-auto rounded-lg border bg-muted/40 p-1" role="group" aria-label="Which ads">
              {adFlags.scopes.map((sc) => {
                const n = adFlags.counts[sc] ?? 0;
                return (
                  <button key={sc} type="button" aria-pressed={adScope === sc} onClick={() => pickAdScope(sc)}
                    className={cn("flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition",
                      adScope === sc ? "bg-card text-foreground shadow-sm border" : "text-muted-foreground hover:text-foreground")}>
                    {AD_SCOPE_LABEL[sc]}
                    {n > 0 && <span className="rounded-full bg-red-500/15 px-1.5 text-[10px] font-bold text-red-600 dark:text-red-400">{n}</span>}
                  </button>
                );
              })}
            </div>
          )}

          {!adFlags || (adsFetching && adFlags.scope !== adScope) ? (
            <div className="flex justify-center py-16"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>
          ) : adsActive.length === 0 && adsClosed.length === 0 ? (
            <Empty icon={<TrendingDown className="size-10" />} title="No ads to redo" sub={AD_SCOPE_EMPTY[adScope]} />
          ) : (
            <>
              {adsActive.length > 0 && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/5 border border-red-400/20 text-xs text-red-600 dark:text-red-400">
                  <TrendingDown className="size-3.5 shrink-0" />
                  {AD_SCOPE_HINT[adScope]}
                </div>
              )}
              {adsActive.length > 0 ? (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {adsActive.map((f) => <AdFlagCard key={f.id} flag={f} highlight={f.id === flagParam} />)}
                </div>
              ) : (
                <p className="rounded-xl border bg-card px-4 py-6 text-center text-sm text-muted-foreground">Nothing open — all caught up.</p>
              )}
              {adsClosed.length > 0 && (
                <details className="group rounded-xl border bg-card"
                  {...(adsClosed.some((f) => f.id === flagParam) ? { open: true } : {})}>
                  <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium">
                    <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
                    Recently closed <span className="text-xs font-normal text-muted-foreground">({adsClosed.length}, last 14 days)</span>
                  </summary>
                  <div className="grid grid-cols-1 gap-4 border-t p-4 sm:grid-cols-2 lg:grid-cols-3">
                    {adsClosed.map((f) => <AdFlagCard key={f.id} flag={f} highlight={f.id === flagParam} />)}
                  </div>
                </details>
              )}
            </>
          )}
        </>
      )}

      <AnimatePresence>
        {reeditTask && <ReeditModal task={reeditTask} onClose={() => setReeditTask(null)} />}
        {approveTask && (
          <ApproveRouteModal task={approveTask} onClose={() => setApproveTask(null)} />
        )}
      </AnimatePresence>
    </div>
  );
}

function Empty({ icon, title, sub }: { icon: React.ReactNode; title: string; sub: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 gap-3 rounded-2xl border bg-card text-muted-foreground/60">
      {icon}
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="text-xs">{sub}</p>
    </div>
  );
}
