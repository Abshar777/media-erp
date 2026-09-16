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
import {
  Trophy, Clock, Users, ShieldCheck, Stamp, Loader2, AlertCircle, Info,
} from "lucide-react";
import { useTeams } from "@/hooks/useTeams";
import { useAuthStore } from "@/stores/authStore";
import {
  usePerformance, formatDuration,
  type MemberPerf, type ApproverPerf, type VerifierPerf, type TeamPerf,
} from "@/hooks/usePerformance";
import { cn } from "@/lib/utils";

const RANGES = [
  { id: "",      label: "All time" },
  { id: "30",    label: "Last 30 days" },
  { id: "90",    label: "Last 90 days" },
  { id: "365",   label: "Last year" },
] as const;

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
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
function Row({ ranked, children }: { ranked: boolean; children: React.ReactNode }) {
  return (
    <tr className={cn("border-t transition-colors hover:bg-muted/40", !ranked && "opacity-60")}>
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

function MemberTable({ rows }: { rows: MemberPerf[] }) {
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
            <Row key={m.user_id} ranked={m.ranked}>
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

function ApproverTable({ rows }: { rows: ApproverPerf[] }) {
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
            <Row key={a.user_id} ranked={a.ranked}>
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

function VerifierTable({ rows }: { rows: VerifierPerf[] }) {
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
            <Row key={v.user_id} ranked={v.ranked}>
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

function TeamBlock({ team }: { team: TeamPerf }) {
  return (
    <section className="rounded-2xl border bg-card p-4">
      <h2 className="mb-4 flex items-center gap-2 text-base font-bold tracking-tight">
        <Users className="size-4 text-primary" />
        {team.team_name}
      </h2>

      <div className="space-y-5">
        <div>
          <SectionTitle
            icon={Clock}
            title="Members"
            hint="time actually spent on a task, from the task timer"
          />
          <MemberTable rows={team.members} />
        </div>

        <div>
          <SectionTitle
            icon={Stamp}
            title="Approvers"
            hint="how long a submitted task waits for their sign-off"
          />
          <ApproverTable rows={team.approvers} />
        </div>

        <div>
          <SectionTitle
            icon={ShieldCheck}
            title="Verifiers"
            hint="delay they add before responding — work still open counts"
          />
          <VerifierTable rows={team.verifiers} />
        </div>
      </div>
    </section>
  );
}

export default function PerformancePage() {
  const [teamId, setTeamId] = useState("");
  const [range, setRange] = useState<(typeof RANGES)[number]["id"]>("");

  const filters = useMemo(() => ({
    ...(teamId ? { team_id: teamId } : {}),
    ...(range ? { date_from: daysAgo(Number(range)) } : {}),
  }), [teamId, range]);

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

        {data && (
          <span className="ml-auto flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Info className="size-3.5" />
            Ranked from {data.min_sample} or more; thinner samples are listed but not ranked.
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
        <div className="space-y-5">
          {data.teams.map((t) => (
            <TeamBlock key={t.team_id || "none"} team={t} />
          ))}
        </div>
      )}
    </div>
  );
}
