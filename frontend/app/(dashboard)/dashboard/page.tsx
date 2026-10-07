"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  AlertTriangle, Calendar, CheckCircle2, Circle,
  ClipboardCheck, Clock, FileClock, Kanban,
  Layers, Loader2, PauseCircle, RotateCcw, Users, X, Zap,
} from "lucide-react";
import Link from "next/link";
import { useTasks } from "@/hooks/useProjects";
import { useTeams } from "@/hooks/useTeams";
import { MemberScopePicker, type ScopeGroup, type ScopeMember } from "@/components/dashboard/MemberScopePicker";
import { AdReportsBanner } from "@/components/ad-reports/AdReportsBanner";
import { useAuthStore } from "@/stores/authStore";
import { BOARD_COLUMNS, isTaskOverdue, assigneeLabel } from "@/types/project";
import type { Task } from "@/types/project";
import { useTaskTimer, formatSeconds } from "@/hooks/useTaskTimer";
import { cn } from "@/lib/utils";
import { fmtDateOnly } from "@/lib/datetime";

// ── Helpers ───────────────────────────────────────────────────────────────────

function today() { return new Date().toISOString().slice(0, 10); }
function daysFromNow(n: number) {
  const d = new Date(); d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

const STATUS_ICON: Record<string, React.ReactNode> = {
  pending:        <Circle        className="size-3.5 text-amber-500" />,
  started:        <Zap           className="size-3.5 text-blue-500" />,
  break:          <Clock         className="size-3.5 text-orange-500" />,
  reedit:         <RotateCcw     className="size-3.5 text-rose-500" />,
  pending_review: <ClipboardCheck className="size-3.5 text-purple-500" />,
  approved:       <CheckCircle2  className="size-3.5 text-green-500" />,
};

const STATUS_BAR_COLOR: Record<string, string> = {
  pending:        "bg-amber-400",
  started:        "bg-blue-500",
  break:          "bg-orange-400",
  reedit:         "bg-rose-500",
  pending_review: "bg-purple-500",
  approved:       "bg-green-500",
};

const PRIORITY_DOT: Record<string, string> = {
  high:   "bg-red-500",
  medium: "bg-amber-400",
  low:    "bg-slate-400",
};

// ── Stat card ─────────────────────────────────────────────────────────────────
function StatCard({
  label, value, icon, color, bg, sub, href,
}: {
  label: string; value: number; icon: React.ReactNode;
  color: string; bg: string; sub?: string; href?: string;
}) {
  const inner = (
    <div className={cn(
      "flex flex-col gap-3 rounded-xl border bg-card p-5 delta-shadow",
      href && "cursor-pointer"
    )}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
        <div className={cn("flex size-8 items-center justify-center rounded-lg", bg)}>{icon}</div>
      </div>
      <div>
        <p className={cn("text-3xl font-bold tabular-nums", color)}>{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </div>
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

// ── Task timer chip ───────────────────────────────────────────────────────────
function TaskTimerChip({ task }: { task: Task }) {
  const { seconds, isRunning, isCompleted, hasTimer, pauseCount } = useTaskTimer(task);
  if (!hasTimer) return null;
  return (
    <div className="flex items-center gap-1.5 shrink-0">
      <div className={cn(
        "flex items-center gap-1 text-[10px] font-medium tabular-nums",
        isRunning   ? "text-blue-500"  :
        isCompleted ? "text-green-600" :
                      "text-muted-foreground"
      )}>
        {isRunning && <span className="size-1.5 rounded-full bg-blue-500 animate-pulse" />}
        <Clock className="size-3" />
        {formatSeconds(seconds)}
      </div>
      {pauseCount > 0 && (
        <div
          className="flex items-center gap-0.5 text-[10px] text-muted-foreground"
          title={`Paused ${pauseCount} time${pauseCount !== 1 ? "s" : ""}`}
        >
          <PauseCircle className="size-3" />
          {pauseCount}
        </div>
      )}
    </div>
  );
}

// ── Task row ──────────────────────────────────────────────────────────────────
function TaskRow({ task }: { task: Task }) {
  const col    = BOARD_COLUMNS.find(c => c.key === task.status);
  const overdue = isTaskOverdue(task);
  return (
    <div className="flex items-center gap-3 py-2.5 border-b last:border-0">
      <div className="shrink-0">{STATUS_ICON[task.status] ?? <Circle className="size-3.5 text-muted-foreground" />}</div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{task.title}</p>
        <div className="flex items-center gap-2 mt-0.5">
          {assigneeLabel(task) && (
            <span className="text-[10px] text-muted-foreground">{assigneeLabel(task)}</span>
          )}
          {col && (
            <span className="text-[10px] font-medium rounded-full px-1.5 py-px"
              style={{ background: `${col.color}20`, color: col.color }}>
              {col.label}
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <TaskTimerChip task={task} />
        <span className={cn("size-2 rounded-full", PRIORITY_DOT[task.priority])} title={task.priority} />
        {task.due_date && (
          <span className={cn("text-[10px] tabular-nums", overdue ? "text-red-500 font-semibold" : "text-muted-foreground")}>
            {fmtDateOnly(task.due_date, { day: "numeric", month: "short" })}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Member scope ──────────────────────────────────────────────────────────────

/** Roles the backend lets browse anyone (see projects._resolve_visibility). */
const ELEVATED_ROLES = new Set(["Super Admin", "Admin", "Coordinator"]);

/** URL query key that carries whose overview is shown. */
const MEMBER_PARAM = "member";

function readMemberParam(): string {
  // Read once on mount. A lazy initializer keeps us clear of useSearchParams'
  // Suspense requirement — the same approach the Projects page uses.
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get(MEMBER_PARAM) ?? "";
}

function writeMemberParam(id: string) {
  // replaceState, not pushState: a scope filter is not a page, so Back should
  // leave the Overview rather than step through every person you looked at.
  // Next.js syncs native history calls with its router.
  const url = new URL(window.location.href);
  if (id) url.searchParams.set(MEMBER_PARAM, id);
  else url.searchParams.delete(MEMBER_PARAM);
  window.history.replaceState(null, "", url.pathname + url.search + url.hash);
}

const firstNameOf = (name: string) => name.trim().split(/\s+/)[0] || name;

// ── Page ──────────────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const user      = useAuthStore(s => s.user);
  const firstName = user?.name?.split(" ")[0] ?? "there";

  const { data: teams = [], isLoading: teamsLoading } = useTeams();

  // ── Who can be browsed ───────────────────────────────────────────────────
  // This must mirror the backend EXACTLY. It honours member_id only for an
  // elevated role or the "Team Leader" role. An Employee-role user who happens
  // to lead a team gets plain "own" visibility, so offering them the picker
  // would show "Viewing Amith" over their own tasks.
  const roleName = user?.role?.role_name ?? "";
  const isElevated = ELEVATED_ROLES.has(roleName);
  const isTeamLeaderRole = roleName === "Team Leader";

  const scopeTeams = useMemo(() => {
    if (isElevated) return teams;
    if (isTeamLeaderRole) return teams.filter(t => t.my_role === "leader");
    return [];
  }, [teams, isElevated, isTeamLeaderRole]);

  // Each person is listed under EVERY team they're in. Deduping across teams
  // ("first team wins") was tried and is wrong: when every member of a team
  // also belongs to a team listed earlier, that team's group comes out empty
  // and vanishes from the picker — and searching by its name finds nothing.
  // The team header above each row makes a repeat obviously the same person,
  // and picking either row selects the same id.
  const memberGroups: ScopeGroup[] = useMemo(() => {
    return scopeTeams
      .map(team => {
        const members: ScopeMember[] = [];
        for (const m of team.members ?? []) {
          if (m.user_id === user?.id) continue;
          members.push({
            id: m.user_id,
            name: m.name || m.email || "Unnamed member",
            designation: m.designation,
            role: m.role,
          });
        }
        members.sort((a, b) => a.name.localeCompare(b.name));
        return { id: team.id, name: team.name, color: team.color, members };
      })
      .filter(g => g.members.length > 0);
  }, [scopeTeams, user?.id]);

  const memberIndex = useMemo(() => {
    const map = new Map<string, ScopeMember>();
    for (const g of memberGroups) for (const m of g.members) map.set(m.id, m);
    return map;
  }, [memberGroups]);

  const canViewMembers = memberGroups.length > 0;

  // ── Selected member (URL-backed) ─────────────────────────────────────────
  const [memberParam, setMemberParam] = useState<string>(readMemberParam);

  const selectMember = useCallback((id: string) => {
    setMemberParam(id);
    writeMemberParam(id);
  }, []);

  // A hand-edited or stale ?member= that isn't one of yours falls back to your
  // own overview. The backend enforces this too; this keeps the UI honest.
  useEffect(() => {
    if (teamsLoading || !memberParam) return;
    if (!memberIndex.has(memberParam)) selectMember("");
  }, [teamsLoading, memberParam, memberIndex, selectMember]);

  const viewingMember = memberParam ? memberIndex.get(memberParam) ?? null : null;

  // Fetch in parallel with teams rather than waiting on them: the common case
  // (a valid id from a shared link) loads faster, and the backend refuses
  // anyone who isn't yours regardless.
  const { data: tasks = [], isLoading: tasksLoading } = useTasks(
    memberParam ? { member_id: memberParam } : {}
  );

  // Never show one person's numbers under another's name: while a ?member= is
  // unresolved (teams still loading, or about to be rejected), show loading.
  const isLoading = tasksLoading || (!!memberParam && !viewingMember);

  const memberTeams = useMemo(
    () => viewingMember
      ? scopeTeams.filter(t => t.members?.some(m => m.user_id === viewingMember.id))
      : [],
    [scopeTeams, viewingMember]
  );

  const hour     = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  // ── Computed stats ────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const now  = today();
    const week = daysFromNow(7);

    const approvedWithTime = tasks.filter(
      t => t.status === "approved" && t.timing?.total_seconds != null
    );
    const avgSeconds = approvedWithTime.length > 0
      ? Math.round(approvedWithTime.reduce((s, t) => s + (t.timing!.total_seconds ?? 0), 0) / approvedWithTime.length)
      : null;

    return {
      total:         tasks.length,
      active:        tasks.filter(t => t.status === "started").length,
      inProgress:    tasks.filter(t => t.status === "started" || t.status === "break").length,
      pendingReview: tasks.filter(t => t.status === "pending_review").length,
      reedit:        tasks.filter(t => t.status === "reedit").length,
      approved:      tasks.filter(t => t.status === "approved").length,
      overdue:       tasks.filter(t => isTaskOverdue(t)).length,
      dueSoon:       tasks.filter(t => t.due_date && t.due_date >= now && t.due_date <= week && t.status !== "approved"),
      avgSeconds,
      avgLabel:      avgSeconds != null ? formatSeconds(avgSeconds) : null,
    };
  }, [tasks]);

  // Pipeline: count per status
  const pipeline = useMemo(() => {
    return BOARD_COLUMNS.map(col => ({
      ...col,
      count: tasks.filter(t => t.status === col.key).length,
    }));
  }, [tasks]);

  // Recent activity (last 8 updated)
  const recentTasks = useMemo(() =>
    [...tasks].sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()).slice(0, 8),
    [tasks]
  );

  // Upcoming deadlines (due in next 7 days, not approved)
  const upcomingDeadlines = useMemo(() =>
    stats.dueSoon.slice().sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? "")).slice(0, 8),
    [stats.dueSoon]
  );

  const totalForBar = Math.max(tasks.length, 1);

  return (
    <div className="space-y-6 pb-6">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      {/* The scope picker sits on the greeting's row: it changes the whole page,
          so it belongs above everything it affects, and sharing the row keeps
          the KPI cards above the fold. Stacks under the greeting on mobile. */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: "easeOut" }}
        className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"
      >
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">
            {greeting}, {firstName} 👋
          </h1>
          {viewingMember ? (
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
              <span>
                Viewing <span className="font-semibold text-foreground">{viewingMember.name}</span>&apos;s overview
              </span>
              {memberTeams.length > 0 && (
                <span className="flex items-center gap-1.5">
                  <span aria-hidden>·</span>
                  {memberTeams.map(t => (
                    <span key={t.id} className="inline-flex items-center gap-1">
                      <span className="size-1.5 rounded-full" style={{ background: t.color || "#6366f1" }} />
                      {t.name}
                    </span>
                  ))}
                </span>
              )}
              <button
                type="button"
                onClick={() => selectMember("")}
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
              >
                <X className="size-3" /> Back to mine
              </button>
            </p>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">
              Here&apos;s what&apos;s happening across your media projects today.
            </p>
          )}
        </div>

        {canViewMembers && (
          <MemberScopePicker
            groups={memberGroups}
            value={viewingMember ? viewingMember.id : ""}
            onChange={selectMember}
            className="sm:shrink-0"
          />
        )}
      </motion.div>

      {/* Only when one of *your* ad reports is waiting for numbers. */}
      {!viewingMember && <AdReportsBanner />}

      {/* ── KPI Cards ──────────────────────────────────────────────────────── */}
      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground py-4">
          <Loader2 className="size-4 animate-spin" /> Loading overview…
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <StatCard label="Total Tasks"     value={stats.total}         icon={<Layers        className="size-4 text-slate-600 dark:text-slate-300" />} color="text-foreground"    bg="bg-slate-100 dark:bg-slate-800"    href="/projects" />
          <StatCard label="In Progress"     value={stats.inProgress}    icon={<Zap           className="size-4 text-blue-600" />}                      color="text-blue-600"      bg="bg-blue-500/10"    href="/projects" />
          <StatCard label="Pending Review"  value={stats.pendingReview} icon={<ClipboardCheck className="size-4 text-purple-600" />}                   color="text-purple-600"    bg="bg-purple-500/10"  href="/leader"   />
          <StatCard label="Approved"        value={stats.approved}      icon={<CheckCircle2  className="size-4 text-green-600" />}                      color="text-green-600"     bg="bg-green-500/10"   href="/projects" />
          <StatCard label="Overdue"         value={stats.overdue}       icon={<AlertTriangle className="size-4 text-red-600" />}                        color={stats.overdue > 0 ? "text-red-600" : "text-foreground"} bg="bg-red-500/10" href="/projects" sub={stats.overdue > 0 ? "Needs attention" : "All on time"} />
          {/* Avg completion time — text card (no numeric value prop) */}
          <div className="flex flex-col gap-3 rounded-xl border bg-card p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Avg Completion</span>
              <div className="flex size-8 items-center justify-center rounded-lg bg-indigo-500/10">
                <Clock className="size-4 text-indigo-600" />
              </div>
            </div>
            <div>
              <p className="text-3xl font-bold text-indigo-600 tabular-nums">
                {stats.avgLabel ?? "—"}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {stats.avgSeconds != null ? `across ${stats.approved} approved task${stats.approved !== 1 ? "s" : ""}` : "No completed tasks yet"}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── Pipeline bar ───────────────────────────────────────────────────── */}
      {!isLoading && tasks.length > 0 && (
        <div className="rounded-xl border bg-card p-5 shadow-sm">
          <p className="text-sm font-semibold mb-4 flex items-center gap-2">
            <Kanban className="size-4 text-primary" /> Task Pipeline
          </p>
          {/* Segmented bar */}
          <div className="flex h-3 w-full rounded-full overflow-hidden gap-0.5 mb-4">
            {pipeline.map(col =>
              col.count > 0 ? (
                <div
                  key={col.key}
                  className={cn("h-full transition-all", STATUS_BAR_COLOR[col.key] ?? "bg-muted")}
                  style={{ width: `${(col.count / totalForBar) * 100}%` }}
                  title={`${col.label}: ${col.count}`}
                />
              ) : null
            )}
          </div>
          {/* Legend */}
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {pipeline.map(col => (
              <div key={col.key} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className={cn("size-2.5 rounded-full shrink-0", STATUS_BAR_COLOR[col.key] ?? "bg-muted")} />
                <span>{col.label}</span>
                <span className="font-semibold text-foreground">{col.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Two-column section ─────────────────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-2">

        {/* Recent Activity */}
        <div className="rounded-xl border bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm font-semibold flex items-center gap-2">
              <FileClock className="size-4 text-primary" /> Recent Activity
            </p>
            <Link href="/projects" className="text-xs text-primary hover:underline">View all →</Link>
          </div>
          {isLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
          ) : recentTasks.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              {viewingMember ? `${firstNameOf(viewingMember.name)} has no tasks yet.` : "No tasks yet."}
            </p>
          ) : (
            <div>{recentTasks.map(t => <TaskRow key={t.id} task={t} />)}</div>
          )}
        </div>

        {/* Upcoming Deadlines */}
        <div className="rounded-xl border bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm font-semibold flex items-center gap-2">
              <Calendar className="size-4 text-primary" /> Upcoming Deadlines
              <span className="text-[10px] text-muted-foreground font-normal">(next 7 days)</span>
            </p>
            <Link href="/projects" className="text-xs text-primary hover:underline">View all →</Link>
          </div>
          {isLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
          ) : upcomingDeadlines.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground gap-2">
              <CheckCircle2 className="size-8 opacity-30" />
              <p className="text-sm">No deadlines in the next 7 days.</p>
            </div>
          ) : (
            <div>{upcomingDeadlines.map(t => <TaskRow key={t.id} task={t} />)}</div>
          )}
        </div>
      </div>

      {/* ── Team summary (shows if user has teams) ─────────────────────────── */}
      {/* Follows the scope: when viewing someone, show the teams you share with
          them, so each card's numbers are that person's work in that team. */}
      {(viewingMember ? memberTeams : teams).length > 0 && (
        <div className="rounded-xl border bg-card p-5 shadow-sm">
          <p className="text-sm font-semibold mb-4 flex items-center gap-2">
            <Users className="size-4 text-primary" />
            {viewingMember ? `${firstNameOf(viewingMember.name)}'s Teams` : "My Teams"}
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {(viewingMember ? memberTeams : teams).slice(0, 6).map(team => {
              const teamTasks   = tasks.filter(t => t.team_id === team.id);
              const teamApproved = teamTasks.filter(t => t.status === "approved").length;
              const teamActive   = teamTasks.filter(t => t.status === "started").length;
              const pct = teamTasks.length > 0 ? Math.round((teamApproved / teamTasks.length) * 100) : 0;
              return (
                <div key={team.id} className="rounded-lg border p-3.5 hover:bg-muted/30 transition-colors">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="size-2.5 rounded-full shrink-0" style={{ background: team.color ?? "#6366f1" }} />
                    <p className="text-sm font-medium truncate">{team.name}</p>
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground mb-2">
                    <span>{teamTasks.length} task{teamTasks.length !== 1 ? "s" : ""}</span>
                    <span>{teamActive} active · {teamApproved} done</span>
                  </div>
                  {/* Completion bar */}
                  <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-green-500 transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-1">{pct}% complete</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Quick links ────────────────────────────────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Projects Board",  href: "/projects", icon: <Kanban        className="size-4" />, desc: "View & manage all tasks" },
          { label: "Leader Desk",     href: "/leader",   icon: <ClipboardCheck className="size-4" />, desc: "Review pending submissions" },
          { label: "Teams",           href: "/teams",    icon: <Users          className="size-4" />, desc: "Manage your teams" },
          { label: "Campaigns",       href: "/campaigns",icon: <Zap            className="size-4" />, desc: "Track media campaigns" },
        ].map(item => (
          <Link key={item.href} href={item.href}
            className="flex items-center gap-3 rounded-xl border bg-card p-4 shadow-sm hover:shadow-md hover:border-primary/30 transition-all group"
          >
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
              {item.icon}
            </div>
            <div>
              <p className="text-sm font-medium">{item.label}</p>
              <p className="text-[11px] text-muted-foreground">{item.desc}</p>
            </div>
          </Link>
        ))}
      </div>

    </div>
  );
}
