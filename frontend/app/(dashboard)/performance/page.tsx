"use client";

/**
 * Performance report — where time goes, team by team.
 *
 * Three tables per team, because the delay in a task rarely belongs to one
 * person: the member doing it, the approver signing it off, and the verifiers
 * asked to check it each hold it for a while. Ranking each separately is what
 * makes it clear which of the three is actually the bottleneck.
 */

import { useState, useMemo } from "react";
import { createPortal } from "react-dom";
import {
  Trophy, Clock, Users, ShieldCheck, Stamp, Loader2, AlertCircle, Info, X,
  Search, ArrowUpDown, RotateCcw,
} from "lucide-react";
import { useTeams } from "@/hooks/useTeams";
import { useAuthStore } from "@/stores/authStore";
import {
  usePerformance, usePerformanceTasks, formatDuration,
  type MemberPerf, type ApproverPerf, type VerifierPerf, type TeamPerf, type PerfRole,
} from "@/hooks/usePerformance";
import { cn } from "@/lib/utils";

const RANGES = [
  { id: "",      label: "All time" },
  { id: "30",    label: "Last 30 days" },
  { id: "90",    label: "Last 90 days" },
  { id: "365",   label: "Last year" },
  { id: "custom", label: "Custom" },
] as const;

const SECTIONS = [
  { id: "all",       label: "Everything" },
  { id: "member",    label: "Members" },
  { id: "approver",  label: "Approvers" },
  { id: "verifier",  label: "Verifiers" },
] as const;
type SectionId = (typeof SECTIONS)[number]["id"];

const SORTS = [
  { id: "fastest", label: "Fastest first" },
  { id: "slowest", label: "Slowest first" },
  { id: "volume",  label: "Most tasks" },
  { id: "name",    label: "Name (A–Z)" },
] as const;
type SortId = (typeof SORTS)[number]["id"];

/** How many measurements a row is built from, whichever table it is in. */
function sampleCount(r: MemberPerf | ApproverPerf | VerifierPerf): number {
  return (r as MemberPerf).completed
    ?? (r as ApproverPerf).approvals
    ?? (r as VerifierPerf).verifications
    ?? 0;
}

/**
 * Search, sort and thin-sample filtering, applied to any of the three tables.
 *
 * Sorting here rather than re-fetching keeps the rank badges meaningful: rank
 * is assigned by the server against the whole team, so re-ordering the rows on
 * screen shows "3rd fastest" next to a row sitting fourth in a by-volume sort,
 * which is the honest reading — the medal belongs to the person, not the row
 * position.
 */
function teamHasMatches(
  team: TeamPerf, search: string, rankedOnly: boolean, section: SectionId
): boolean {
  const check = (rows: (MemberPerf | ApproverPerf | VerifierPerf)[], id: SectionId) =>
    (section === "all" || section === id) &&
    applyRowFilters(rows, search, "fastest", rankedOnly).length > 0;
  return (
    check(team.members, "member") ||
    check(team.approvers, "approver") ||
    check(team.verifiers, "verifier")
  );
}

function applyRowFilters<T extends MemberPerf | ApproverPerf | VerifierPerf>(
  rows: T[], search: string, sort: SortId, rankedOnly: boolean
): T[] {
  const q = search.trim().toLowerCase();
  let out = rows;
  if (q) out = out.filter((r) => r.name.toLowerCase().includes(q));
  if (rankedOnly) out = out.filter((r) => r.ranked);

  const copy = [...out];
  copy.sort((a, b) => {
    if (sort === "name") return a.name.localeCompare(b.name);
    if (sort === "volume") return sampleCount(b) - sampleCount(a);
    const av = a.avg_seconds, bv = b.avg_seconds;
    // Rows with nothing measured sink to the bottom either way — they are not
    // "infinitely fast".
    if (av == null) return 1;
    if (bv == null) return -1;
    return sort === "slowest" ? bv - av : av - bv;
  });
  return copy;
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

interface DrillTarget {
  userId: string;
  name: string;
  role: PerfRole;
  teamId: string;
  teamName: string;
}

const ROLE_COPY: Record<PerfRole, { title: string; column: string; blurb: string }> = {
  member:   { title: "Tasks completed", column: "Time on task",
              blurb: "Shift time spent on each task, slowest first." },
  approver: { title: "Tasks approved",  column: "Waited for approval",
              blurb: "How long each task sat waiting for this sign-off." },
  verifier: { title: "Tasks verified",  column: "Delay added",
              blurb: "How long each task waited on this verification." },
};

/**
 * The tasks behind one row of the report.
 *
 * Re-derived server-side from the same definitions the report uses, so the
 * rows here always add up to the number that was clicked — a drill-down that
 * disagreed with its own headline would undermine both.
 */
function DrillDownModal({ target, dateFrom, onClose }: {
  target: DrillTarget;
  dateFrom?: string;
  onClose: () => void;
}) {
  const { data, isLoading, error } = usePerformanceTasks({
    user_id: target.userId,
    role: target.role,
    ...(target.teamId ? { team_id: target.teamId } : {}),
    ...(dateFrom ? { date_from: dateFrom } : {}),
  });
  const copy = ROLE_COPY[target.role];
  const [q, setQ] = useState("");
  if (typeof document === "undefined") return null;

  const all = data?.items ?? [];
  const items = q.trim()
    ? all.filter((t) => t.title.toLowerCase().includes(q.trim().toLowerCase()))
    : all;

  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b px-4 py-3">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold">
              {target.name} · {copy.title}
            </h3>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {target.teamName} · {copy.blurb}
            </p>
          </div>
          <button onClick={onClose} className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted" aria-label="Close">
            <X className="size-4" />
          </button>
        </div>

        {/* A hundred-row drill-down needs a way to find one task in it. */}
        {all.length > 8 && (
          <div className="relative border-b px-4 py-2">
            <Search className="pointer-events-none absolute left-6 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search these tasks…"
              className="w-full rounded-lg border bg-background py-1.5 pl-8 pr-3 text-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30"
            />
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-auto">
          {isLoading ? (
            <div className="flex justify-center py-16"><Loader2 className="size-5 animate-spin text-muted-foreground/50" /></div>
          ) : error ? (
            <p className="py-16 text-center text-sm text-muted-foreground">Couldn&apos;t load these tasks.</p>
          ) : !all.length ? (
            <p className="py-16 text-center text-sm text-muted-foreground">No tasks in this period.</p>
          ) : !items.length ? (
            <p className="py-16 text-center text-sm text-muted-foreground">
              No task here matches &ldquo;{q}&rdquo;.
            </p>
          ) : (
            <table className="w-full min-w-[560px] text-sm">
              <thead className="sticky top-0 bg-muted/80 text-[11px] uppercase tracking-wide text-muted-foreground backdrop-blur">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Task</th>
                  <th className="px-3 py-2 text-right font-medium">{copy.column}</th>
                  {target.role === "member" && <th className="px-3 py-2 text-right font-medium">Turnaround</th>}
                  {target.role === "member" && <th className="px-3 py-2 text-right font-medium">On time</th>}
                  {target.role === "verifier" && <th className="px-3 py-2 text-right font-medium">Verdict</th>}
                  <th className="px-3 py-2 text-right font-medium">When</th>
                </tr>
              </thead>
              <tbody>
                {items.map((t) => (
                  <tr key={`${t.task_id}-${t.at ?? "open"}`} className="border-t hover:bg-muted/40">
                    <td className="max-w-[260px] px-3 py-2">
                      <span className="block truncate font-medium">{t.title || "Untitled"}</span>
                      {t.assigned_to_name && target.role !== "member" && (
                        <span className="text-[11px] text-muted-foreground">{t.assigned_to_name}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">
                      {formatDuration(t.seconds)}
                    </td>
                    {target.role === "member" && (
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                        {formatDuration(t.turnaround_seconds)}
                      </td>
                    )}
                    {target.role === "member" && (
                      <td className="px-3 py-2 text-right">
                        {t.on_time == null ? <span className="text-muted-foreground">—</span>
                          : t.on_time ? <span className="text-green-600 dark:text-green-400">Yes</span>
                          : <span className="text-rose-600 dark:text-rose-400">No</span>}
                      </td>
                    )}
                    {target.role === "verifier" && (
                      <td className="px-3 py-2 text-right text-xs">
                        {t.verdict === "passed" ? <span className="text-green-600 dark:text-green-400">Verified</span>
                          : t.verdict === "rejected" ? <span className="text-rose-600 dark:text-rose-400">Changes</span>
                          : <span className="text-amber-600 dark:text-amber-400">Waiting</span>}
                      </td>
                    )}
                    <td className="px-3 py-2 text-right text-[11px] text-muted-foreground">
                      {t.at ? new Date(t.at).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "open"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {all.length > 0 && (
          <div className="border-t px-4 py-2 text-[11px] text-muted-foreground">
            {items.length === all.length
              ? `${all.length} task${all.length !== 1 ? "s" : ""}`
              : `${items.length} of ${all.length} tasks`}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

/** Medal for the top three, plain number below that. */
function RankBadge({ rank }: { rank: number | null }) {
  if (rank == null) {
    return <span className="text-[11px] text-muted-foreground/60">—</span>;
  }
  const medal = rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : null;
  return (
    <span
      className={cn(
        "inline-flex size-6 items-center justify-center rounded-full text-[11px] font-bold",
        medal ? "text-sm" : "bg-muted text-muted-foreground"
      )}
    >
      {medal ?? rank}
    </span>
  );
}

/** Greys out anyone whose sample is too thin to rank. */
function Row({ ranked, onClick, children }: {
  ranked: boolean; onClick?: () => void; children: React.ReactNode;
}) {
  return (
    <tr
      onClick={onClick}
      title={onClick ? "See the tasks behind this" : undefined}
      className={cn(
        "border-t transition-colors hover:bg-muted/40",
        !ranked && "opacity-60",
        onClick && "cursor-pointer"
      )}
    >
      {children}
    </tr>
  );
}

function SectionTitle({
  icon: Icon, title, hint,
}: { icon: typeof Clock; title: string; hint: string }) {
  return (
    <div className="mb-2 flex items-baseline gap-2">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold">
        <Icon className="size-3.5 text-primary" />
        {title}
      </h3>
      <span className="text-[11px] text-muted-foreground">{hint}</span>
    </div>
  );
}

function Empty({ what }: { what: string }) {
  return (
    <p className="rounded-lg border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
      No {what} recorded in this period.
    </p>
  );
}

function MemberTable({ rows, onOpen }: {
  rows: MemberPerf[]; onOpen?: (r: MemberPerf) => void;
}) {
  if (!rows.length) return <Empty what="completed work" />;
  return (
    <div className="overflow-x-auto rounded-xl border">
      <table className="w-full min-w-[620px] text-sm">
        <thead className="bg-muted/50 text-[11px] uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left font-medium">#</th>
            <th className="px-3 py-2 text-left font-medium">Member</th>
            <th className="px-3 py-2 text-right font-medium">Avg per task</th>
            <th className="px-3 py-2 text-right font-medium">Median</th>
            <th className="px-3 py-2 text-right font-medium">Turnaround</th>
            <th className="px-3 py-2 text-right font-medium">Done</th>
            <th className="px-3 py-2 text-right font-medium">On time</th>
            <th className="px-3 py-2 text-right font-medium">Sent back</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => (
            <Row key={m.user_id} ranked={m.ranked} onClick={onOpen && (() => onOpen(m))}>
              <td className="px-3 py-2"><RankBadge rank={m.rank} /></td>
              <td className="px-3 py-2 font-medium">{m.name}</td>
              <td className="px-3 py-2 text-right font-semibold tabular-nums">
                {formatDuration(m.avg_seconds)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                {formatDuration(m.median_seconds)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                {formatDuration(m.avg_turnaround_seconds)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{m.completed}</td>
              <td className="px-3 py-2 text-right tabular-nums">
                {m.on_time_rate == null ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  <span className={cn(
                    "font-medium",
                    m.on_time_rate >= 80 ? "text-green-600 dark:text-green-400"
                      : m.on_time_rate >= 50 ? "text-amber-600 dark:text-amber-400"
                      : "text-rose-600 dark:text-rose-400"
                  )}>
                    {m.on_time_rate}%
                  </span>
                )}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {m.reedits > 0
                  ? <span className="text-rose-600 dark:text-rose-400">{m.reedits}</span>
                  : <span className="text-muted-foreground">0</span>}
              </td>
            </Row>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ApproverTable({ rows, onOpen }: {
  rows: ApproverPerf[]; onOpen?: (r: ApproverPerf) => void;
}) {
  if (!rows.length) return <Empty what="approvals" />;
  return (
    <div className="overflow-x-auto rounded-xl border">
      <table className="w-full min-w-[520px] text-sm">
        <thead className="bg-muted/50 text-[11px] uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left font-medium">#</th>
            <th className="px-3 py-2 text-left font-medium">Approver</th>
            <th className="px-3 py-2 text-right font-medium">Avg to approve</th>
            <th className="px-3 py-2 text-right font-medium">Median</th>
            <th className="px-3 py-2 text-right font-medium">Slowest</th>
            <th className="px-3 py-2 text-right font-medium">Approvals</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => (
            <Row key={a.user_id} ranked={a.ranked} onClick={onOpen && (() => onOpen(a))}>
              <td className="px-3 py-2"><RankBadge rank={a.rank} /></td>
              <td className="px-3 py-2 font-medium">{a.name}</td>
              <td className="px-3 py-2 text-right font-semibold tabular-nums">
                {formatDuration(a.avg_seconds)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                {formatDuration(a.median_seconds)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                {formatDuration(a.worst_seconds)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{a.approvals}</td>
            </Row>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function VerifierTable({ rows, onOpen }: {
  rows: VerifierPerf[]; onOpen?: (r: VerifierPerf) => void;
}) {
  if (!rows.length) return <Empty what="verifications" />;
  return (
    <div className="overflow-x-auto rounded-xl border">
      <table className="w-full min-w-[560px] text-sm">
        <thead className="bg-muted/50 text-[11px] uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left font-medium">#</th>
            <th className="px-3 py-2 text-left font-medium">Verifier</th>
            <th className="px-3 py-2 text-right font-medium">Avg delay added</th>
            <th className="px-3 py-2 text-right font-medium">Longest</th>
            <th className="px-3 py-2 text-right font-medium">Signed off</th>
            <th className="px-3 py-2 text-right font-medium">Still waiting</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((v) => (
            <Row key={v.user_id} ranked={v.ranked} onClick={onOpen && (() => onOpen(v))}>
              <td className="px-3 py-2"><RankBadge rank={v.rank} /></td>
              <td className="px-3 py-2 font-medium">{v.name}</td>
              <td className="px-3 py-2 text-right font-semibold tabular-nums">
                {formatDuration(v.avg_seconds)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                {formatDuration(v.worst_seconds)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{v.signed_off ?? 0}</td>
              <td className="px-3 py-2 text-right tabular-nums">
                {v.still_waiting
                  ? <span className="font-medium text-amber-600 dark:text-amber-400">{v.still_waiting}</span>
                  : <span className="text-muted-foreground">0</span>}
              </td>
            </Row>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TeamBlock({ team, onOpen, search, sort, rankedOnly, section }: {
  team: TeamPerf;
  onOpen: (t: DrillTarget) => void;
  search: string;
  sort: SortId;
  rankedOnly: boolean;
  section: SectionId;
}) {
  const open = (role: PerfRole) => (r: { user_id: string; name: string }) =>
    onOpen({ userId: r.user_id, name: r.name, role, teamId: team.team_id, teamName: team.team_name });

  const members   = applyRowFilters(team.members,   search, sort, rankedOnly);
  const approvers = applyRowFilters(team.approvers, search, sort, rankedOnly);
  const verifiers = applyRowFilters(team.verifiers, search, sort, rankedOnly);
  const show = (id: SectionId) => section === "all" || section === id;

  // A team with nothing matching the search is noise — the caller drops it.
  if (!members.length && !approvers.length && !verifiers.length) return null;

  return (
    <section className="rounded-2xl border bg-card p-4">
      <h2 className="mb-4 flex items-center gap-2 text-base font-bold tracking-tight">
        <Users className="size-4 text-primary" />
        {team.team_name}
      </h2>

      <div className="space-y-5">
        {show("member") && (
          <div>
            <SectionTitle
              icon={Clock}
              title="Members"
              hint="time actually spent on a task, from the task timer"
            />
            <MemberTable rows={members} onOpen={open("member")} />
          </div>
        )}

        {show("approver") && (
          <div>
            <SectionTitle
              icon={Stamp}
              title="Approvers"
              hint="how long a submitted task waits for their sign-off"
            />
            <ApproverTable rows={approvers} onOpen={open("approver")} />
          </div>
        )}

        {show("verifier") && (
          <div>
            <SectionTitle
              icon={ShieldCheck}
              title="Verifiers"
              hint="delay they add before responding — work still open counts"
            />
            <VerifierTable rows={verifiers} onOpen={open("verifier")} />
          </div>
        )}
      </div>
    </section>
  );
}

export default function PerformancePage() {
  const [teamId, setTeamId] = useState("");
  const [range, setRange] = useState<(typeof RANGES)[number]["id"]>("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortId>("fastest");
  const [rankedOnly, setRankedOnly] = useState(false);
  const [section, setSection] = useState<SectionId>("all");
  const [drill, setDrill] = useState<DrillTarget | null>(null);

  // Only the team and the dates reach the server — everything else reshapes
  // rows already in hand, so typing in the search box costs no round trip.
  const filters = useMemo(() => ({
    ...(teamId ? { team_id: teamId } : {}),
    ...(range === "custom"
      ? { ...(from ? { date_from: from } : {}), ...(to ? { date_to: to } : {}) }
      : range ? { date_from: daysAgo(Number(range)) } : {}),
  }), [teamId, range, from, to]);

  const dirty = !!(teamId || range || search || rankedOnly || section !== "all" || sort !== "fastest");
  function resetAll() {
    setTeamId(""); setRange(""); setFrom(""); setTo("");
    setSearch(""); setSort("fastest"); setRankedOnly(false); setSection("all");
  }

  const { data, isLoading, error } = usePerformance(filters);
  const { data: allTeams = [] } = useTeams();
  const me = useAuthStore((s) => s.user);

  // Offering a team the server will refuse is a dead end, so a leader only
  // gets the teams they lead. Elevated roles see the report for every team.
  const isElevated = ["Super Admin", "Admin", "Coordinator"]
    .includes(me?.role?.role_name ?? "");
  const teams = isElevated
    ? allTeams
    : allTeams.filter((t) => t.my_role === "leader");

  const forbidden = (error as { response?: { status?: number } })?.response?.status === 403;

  return (
    <div className="flex flex-col gap-5 pb-8">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight">
          <Trophy className="size-5 text-primary" /> Performance
        </h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          How long work takes at each step — doing it, verifying it, approving it.
          Counted in shift hours, so nights, Sundays and holidays don&apos;t inflate a wait.
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-muted/20 px-3 py-2.5">
        <select
          value={teamId}
          onChange={(e) => setTeamId(e.target.value)}
          className="min-w-[160px] rounded-lg border bg-background px-3 py-1.5 text-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30"
        >
          <option value="">All teams</option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>

        <div className="flex gap-1 rounded-lg border bg-background p-0.5">
          {RANGES.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setRange(r.id)}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                range === r.id
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {r.label}
            </button>
          ))}
        </div>

        {range === "custom" && (
          <div className="flex items-center gap-1.5">
            <input
              type="date"
              value={from}
              max={to || undefined}
              onChange={(e) => setFrom(e.target.value)}
              className="rounded-lg border bg-background px-2 py-1.5 text-xs outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
            />
            <span className="text-xs text-muted-foreground">to</span>
            <input
              type="date"
              value={to}
              min={from || undefined}
              onChange={(e) => setTo(e.target.value)}
              className="rounded-lg border bg-background px-2 py-1.5 text-xs outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
            />
          </div>
        )}

        {/* Search a person */}
        <div className="relative min-w-[180px] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search a person…"
            className="w-full rounded-lg border bg-background py-1.5 pl-8 pr-7 text-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              aria-label="Clear search"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>

        {/* Which of the three tables to show */}
        <select
          value={section}
          onChange={(e) => setSection(e.target.value as SectionId)}
          className="rounded-lg border bg-background px-2.5 py-1.5 text-xs outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30"
        >
          {SECTIONS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
        </select>

        {/* Sort */}
        <div className="flex items-center gap-1.5">
          <ArrowUpDown className="size-3.5 text-muted-foreground" />
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortId)}
            className="rounded-lg border bg-background px-2.5 py-1.5 text-xs outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30"
          >
            {SORTS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
          </select>
        </div>

        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={rankedOnly}
            onChange={(e) => setRankedOnly(e.target.checked)}
            className="size-3.5 accent-[var(--primary)]"
          />
          Ranked only
        </label>

        {dirty && (
          <button
            type="button"
            onClick={resetAll}
            className="flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            <RotateCcw className="size-3" /> Reset
          </button>
        )}

        {data && (
          <span className="flex w-full items-center gap-1.5 text-[11px] text-muted-foreground">
            <Info className="size-3.5 shrink-0" />
            Shift hours only ({data.shift.start}–{data.shift.end} IST, {data.shift.days_off.join(", ")} off
            {data.shift.holidays > 0 ? `, ${data.shift.holidays} holidays` : ""}).
            Ranked from {data.min_sample}+. Click a row for its tasks.
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : forbidden ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed py-16 text-center">
          <AlertCircle className="size-6 text-muted-foreground" />
          <p className="text-sm font-medium">This report is for team leaders and admins</p>
          <p className="max-w-sm text-xs text-muted-foreground">
            It ranks named colleagues against each other, so it is limited to the
            people who manage the work. Ask your team leader for a copy.
          </p>
        </div>
      ) : error ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed py-16 text-center">
          <AlertCircle className="size-6 text-rose-500" />
          <p className="text-sm font-medium">Couldn&apos;t build the report</p>
          <p className="text-xs text-muted-foreground">Please try again in a moment.</p>
        </div>
      ) : !data?.teams.length ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed py-16 text-center">
          <Trophy className="size-6 text-muted-foreground" />
          <p className="text-sm font-medium">Nothing to report yet</p>
          <p className="text-xs text-muted-foreground">
            Once tasks are completed and approved, the timings show up here.
          </p>
        </div>
      ) : (
        (() => {
          // Decided from the data, not from the rendered elements: a JSX
          // element is truthy whether or not the component returns null, so
          // filtering the array of <TeamBlock/> would never drop anything and
          // a search with no hits would show a blank page and no explanation.
          const visible = data.teams.filter((t) =>
            teamHasMatches(t, search, rankedOnly, section)
          );

          if (!visible.length) {
            return (
              <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed py-16 text-center">
                <Search className="size-6 text-muted-foreground" />
                <p className="text-sm font-medium">Nothing matches those filters</p>
                <p className="text-xs text-muted-foreground">
                  {search ? <>No one called &ldquo;{search}&rdquo; in this period.</> : "Try widening the period or clearing a filter."}
                </p>
                <button
                  type="button"
                  onClick={resetAll}
                  className="mt-1 flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                >
                  <RotateCcw className="size-3" /> Reset filters
                </button>
              </div>
            );
          }
          return (
            <div className="space-y-5">
              {visible.map((t) => (
                <TeamBlock
                  key={t.team_id || "none"}
                  team={t}
                  onOpen={setDrill}
                  search={search}
                  sort={sort}
                  rankedOnly={rankedOnly}
                  section={section}
                />
              ))}
            </div>
          );
        })()
      )}

      {drill && (
        <DrillDownModal
          target={drill}
          dateFrom={range ? daysAgo(Number(range)) : undefined}
          onClose={() => setDrill(null)}
        />
      )}
    </div>
  );
}
