"use client";

/**
 * Ad Reports — the Meta Ads Manager "Performance overview", filled in daily.
 *
 * Left: one card per report with today's status (missing first). Right: the
 * chosen report — Meta-style KPI tiles + chart, the day-by-day history, and
 * the "Update numbers" button. Leaders also get a "who has updated" strip.
 *
 * URL: ?report=<id> selects a report; &entry=1 opens the entry form (that's
 * where a reminder notification lands). Written with history.replaceState,
 * which Next 16 syncs into useSearchParams — so a reminder clicked while this
 * page is already open still switches report and opens the form.
 */
import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  BarChart3, BellRing, CalendarRange, Flag, Loader2, Pause, PencilLine, Play, Plus, Settings2, Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { istTodayKey } from "@/lib/datetime";
import { useAdEntries, useAdReports, useAdToday, useRemindAdReport, useUpdateAdReport } from "@/hooks/useAdReports";
import { dayLabel, formatCount, formatINR, missingPhrase } from "@/lib/adReports";
import { PerformanceOverview } from "@/components/ad-reports/PerformanceOverview";
import { EntryModal } from "@/components/ad-reports/EntryModal";
import { ReportFormModal } from "@/components/ad-reports/ReportFormModal";
import { StatusChip } from "@/components/ad-reports/StatusChip";
import { Sparkline } from "@/components/ad-reports/Sparkline";
import type { AdReport } from "@/types/adReport";

function readParams() {
  if (typeof window === "undefined") return { report: null as string | null, entry: false };
  const q = new URLSearchParams(window.location.search);
  return { report: q.get("report"), entry: q.get("entry") === "1" };
}

function writeParams(report: string | null) {
  const url = new URL(window.location.href);
  if (report) url.searchParams.set("report", report);
  else url.searchParams.delete("report");
  url.searchParams.delete("entry");
  window.history.replaceState(window.history.state, "", url.toString());
}

// ── Left rail card ───────────────────────────────────────────────────────────

function ReportCard({ r, active, onClick }: { r: AdReport; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "true" : undefined}
      className={cn(
        "w-full rounded-xl border p-3 text-left transition",
        active ? "border-primary/50 bg-primary/5 ring-1 ring-primary/20" : "bg-card hover:bg-muted/50",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="line-clamp-2 text-sm font-semibold leading-snug">{r.name}</p>
        <StatusChip status={r.day_status} className="shrink-0" />
      </div>
      <div className="mt-2 flex items-end justify-between gap-2">
        <div className="min-w-0 text-xs text-muted-foreground">
          <p className="truncate">{r.assignees.map((a) => a.name).join(" · ") || "—"}</p>
          <p className="truncate">{r.team_name}</p>
        </div>
        <Sparkline values={r.sparkline} className="shrink-0 text-teal-500" />
      </div>
      {r.missing.length > 0 && r.status === "active" && (
        <p className="mt-1.5 truncate text-[11px] text-red-600 dark:text-red-400">Missing {missingPhrase(r.missing)}</p>
      )}
    </button>
  );
}

// ── Leader strip ─────────────────────────────────────────────────────────────

function LeaderStrip({ onOpen }: { onOpen: (id: string) => void }) {
  const { data } = useAdToday();
  const remind = useRemindAdReport();
  const team = data?.team;
  if (!team || team.active === 0) return null;
  const allIn = team.missing.length === 0;
  return (
    <div className={cn(
      "flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border px-4 py-3 text-sm",
      allIn ? "border-emerald-500/30 bg-emerald-500/5" : "border-amber-500/30 bg-amber-500/5",
    )}>
      <span className="flex items-center gap-2 font-medium">
        <Users className="size-4 text-muted-foreground" />
        Today: {team.updated} of {team.active} up to date
      </span>
      {allIn ? (
        <span className="text-emerald-700 dark:text-emerald-400">Everyone has entered their numbers.</span>
      ) : (
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-muted-foreground">Missing:</span>
          {team.missing.slice(0, 4).map((m) => (
            <span key={m.id} className="inline-flex items-center gap-1.5">
              <button type="button" onClick={() => onOpen(m.id)} className="font-medium hover:underline">
                {m.owners.join(" & ") || "—"}
              </button>
              <span className="text-muted-foreground">({m.name}{m.missing_count > 1 ? ` · ${m.missing_count} days` : ""})</span>
              <button
                type="button"
                onClick={() => remind.mutate(m.id)}
                disabled={remind.isPending}
                className="inline-flex items-center gap-1 rounded-md border bg-background px-1.5 py-0.5 text-[11px] font-medium hover:bg-muted disabled:opacity-50"
              >
                <BellRing className="size-3" /> Remind
              </button>
            </span>
          ))}
          {team.missing.length > 4 && <span className="text-muted-foreground">+{team.missing.length - 4} more</span>}
        </span>
      )}
    </div>
  );
}

// ── Entry history ────────────────────────────────────────────────────────────

function History({ report, today, onEdit }: { report: AdReport; today: string; onEdit: (d: string) => void }) {
  const { data: rows = [], isLoading } = useAdEntries(report.id);
  const canEditDay = (d: string) =>
    !!report.can_enter && (report.can_manage || (report.status !== "ended" && d >= dayAgo(today, 7)));
  return (
    <section className="rounded-2xl border bg-card p-4 sm:p-6 delta-shadow">
      <h3 className="mb-3 text-base font-semibold">Day by day <span className="text-xs font-normal text-muted-foreground">· last 30 days</span></h3>
      {isLoading ? (
        <div className="h-24 animate-pulse rounded-xl bg-muted" />
      ) : rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">No numbers entered yet.</p>
      ) : (
        <div className="-mx-2 overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="px-2 py-1.5 font-medium">Day</th>
                <th className="px-2 py-1.5 text-right font-medium">Leads</th>
                <th className="px-2 py-1.5 text-right font-medium">Spent</th>
                <th className="px-2 py-1.5 text-right font-medium">Per lead</th>
                <th className="px-2 py-1.5 font-medium">Entered by</th>
                <th className="px-2 py-1.5" />
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => {
                const leads = e.values.leads ?? 0, spend = e.values.spend ?? 0;
                return (
                  <tr key={e.date} className="border-t">
                    <td className="px-2 py-2 font-medium">
                      {dayLabel(e.date)}
                      {e.campaign_off && <span className="ml-1.5 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">off</span>}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">{formatCount(leads)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{formatINR(spend)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{leads ? formatINR(spend / leads) : "—"}</td>
                    <td className="px-2 py-2 text-xs text-muted-foreground">
                      {e.entered_by_name}
                      {e.edits.length > 0 && (
                        <span className="ml-1 text-indigo-600 dark:text-indigo-400"
                          title={e.edits.map((x) => `${x.by_name}: ${formatCount(x.old.leads)} → ${formatCount(x.new.leads)} leads, ${formatINR(x.old.spend)} → ${formatINR(x.new.spend)}`).join("\n")}>
                          ✎ corrected
                        </span>
                      )}
                      {e.note && <span className="ml-1" title={e.note}>· 📝</span>}
                    </td>
                    <td className="px-2 py-2 text-right">
                      {canEditDay(e.date) && (
                        <button type="button" onClick={() => onEdit(e.date)} className="text-xs font-medium text-primary hover:underline">Edit</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function dayAgo(today: string, n: number) {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

// ── Report header + actions ──────────────────────────────────────────────────

function ReportHeader({ r, onEntry, onEdit }: { r: AdReport; onEntry: () => void; onEdit: () => void }) {
  const update = useUpdateAdReport();
  const remind = useRemindAdReport();
  const [confirmEnd, setConfirmEnd] = useState(false);
  useEffect(() => setConfirmEnd(false), [r.id]);
  const canUpdate = r.can_enter && (r.status !== "ended" || r.can_manage);
  const btn = "inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition hover:bg-muted disabled:opacity-50";
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold leading-tight">{r.name}</h2>
          <StatusChip status={r.day_status} />
        </div>
        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          <span>{r.team_name}</span>
          <span>Updated by {r.assignees.map((a, i) => `${a.name}${i ? " (backup)" : ""}`).join(", ")}</span>
          <span className="inline-flex items-center gap-1"><CalendarRange className="size-3" />
            {dayLabel(r.start_date)} → {r.end_date ? dayLabel(r.end_date) : "until ended"}</span>
          <span>Reminders {r.reminder_due} · {r.reminder_escalate}</span>
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {r.can_manage && r.status === "active" && r.missing.length > 0 && (
          <button type="button" className={btn} disabled={remind.isPending} onClick={() => remind.mutate(r.id)}>
            <BellRing className="size-4" /> Remind
          </button>
        )}
        {r.can_manage && r.status !== "ended" && (
          <>
            <button type="button" className={btn} onClick={onEdit}><Settings2 className="size-4" /> Edit</button>
            <button type="button" className={btn} disabled={update.isPending}
              onClick={() => update.mutate({ id: r.id, action: r.status === "paused" ? "resume" : "pause" })}>
              {r.status === "paused" ? <><Play className="size-4" /> Resume</> : <><Pause className="size-4" /> Pause</>}
            </button>
            {confirmEnd ? (
              <span className="inline-flex items-center gap-1.5 text-xs">
                End for good?
                <button type="button" className="rounded-md px-2 py-1 font-medium hover:bg-muted" onClick={() => setConfirmEnd(false)}>Cancel</button>
                <button type="button" className="rounded-md border border-red-500/40 px-2 py-1 font-medium text-red-600 hover:bg-red-500/10 dark:text-red-400"
                  onClick={() => update.mutate({ id: r.id, action: "end" })}>End report</button>
              </span>
            ) : (
              <button type="button" className={btn} onClick={() => setConfirmEnd(true)}><Flag className="size-4" /> End</button>
            )}
          </>
        )}
        {canUpdate && (
          <button type="button" onClick={onEntry}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:opacity-90">
            <PencilLine className="size-4" /> Update numbers
            {r.missing.length > 0 && r.status === "active" && (
              <span className="rounded-full bg-primary-foreground/20 px-1.5 text-[11px] tabular-nums">{r.missing.length}</span>
            )}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function AdReportsPage() {
  return (
    <Suspense fallback={<div className="flex h-64 items-center justify-center"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>}>
      <AdReportsInner />
    </Suspense>
  );
}

function AdReportsInner() {
  const today = istTodayKey();
  const params = useSearchParams();
  const [initial] = useState(readParams);
  const [selectedId, setSelectedId] = useState<string | null>(initial.report);
  const [entryOpen, setEntryOpen] = useState(initial.entry);
  const [entryDay, setEntryDay] = useState<string | null>(null);
  const [form, setForm] = useState<"new" | "edit" | null>(null);
  const [scope, setScope] = useState<"all" | "mine">("all");

  // A notification link (or Back/Forward) changed the URL while we're mounted.
  const paramReport = params.get("report");
  const paramEntry = params.get("entry") === "1";
  useEffect(() => {
    if (paramReport) setSelectedId(paramReport);
    if (paramEntry) { setEntryDay(null); setEntryOpen(true); }
  }, [paramReport, paramEntry]);

  const { data: todayInfo } = useAdToday();
  const canCreate = !!todayInfo?.can_create;
  const { data: reports = [], isLoading, isFetching } = useAdReports(scope);

  const selected = useMemo(
    () => reports.find((r) => r.id === selectedId) ?? null,
    [reports, selectedId],
  );

  // Fall back to the first report when nothing (or an unknown id) is selected.
  // Not while refetching: a report created a moment ago isn't in the list yet.
  useEffect(() => {
    if (isLoading || isFetching) return;
    if (!selected && reports.length) {
      if (selectedId && entryOpen) setEntryOpen(false);   // stale deep link: don't open a form for another report
      setSelectedId(reports[0].id);
      writeParams(reports[0].id);
    }
  }, [isLoading, isFetching, reports, selected, selectedId, entryOpen]);

  const choose = (id: string) => { setSelectedId(id); writeParams(id); };
  const closeEntry = () => { setEntryOpen(false); setEntryDay(null); if (selectedId) writeParams(selectedId); };

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <BarChart3 className="size-6 text-primary" /> Ad Reports
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Meta campaign numbers, entered daily by the team — Leads, Amount spent and Cost per lead.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canCreate && (
            <div className="flex gap-0.5 rounded-lg border bg-background p-0.5" role="group" aria-label="Show">
              {(["all", "mine"] as const).map((s) => (
                <button key={s} type="button" aria-pressed={scope === s} onClick={() => setScope(s)}
                  className={cn("rounded-md px-3 py-1.5 text-xs font-medium transition",
                    scope === s ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")}>
                  {s === "all" ? "Team" : "Mine"}
                </button>
              ))}
            </div>
          )}
          {canCreate && (
            <button type="button" onClick={() => setForm("new")}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90">
              <Plus className="size-4" /> New report
            </button>
          )}
        </div>
      </div>

      {canCreate && <LeaderStrip onOpen={choose} />}

      {isLoading ? (
        <div className="flex h-64 items-center justify-center"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>
      ) : reports.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed py-16 text-center">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary"><BarChart3 className="size-6" /></div>
          <div>
            <p className="font-semibold">{scope === "mine" ? "No reports assigned to you" : "No ad reports yet"}</p>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              {canCreate
                ? "Create one per Meta campaign, choose who updates it, and the numbers will build into a chart day by day."
                : "When your team leader assigns you a campaign, it will appear here."}
            </p>
          </div>
          {canCreate && (
            <button type="button" onClick={() => setForm("new")}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90">
              <Plus className="size-4" /> New report
            </button>
          )}
          {!canCreate && <Link href="/dashboard" className="text-sm font-medium text-primary hover:underline">Back to Overview</Link>}
        </div>
      ) : (
        <div className="grid gap-5 xl:grid-cols-[280px_minmax(0,1fr)]">
          {/* Rail — a dropdown below xl, where the overview needs the width */}
          <div className="xl:hidden">
            <select aria-label="Choose a report" value={selected?.id ?? ""} onChange={(e) => choose(e.target.value)}
              className="h-10 w-full rounded-lg border bg-background px-3 text-sm">
              {reports.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}{r.day_status === "missing" ? " — missing" : r.day_status === "due" ? " — due" : ""}
                </option>
              ))}
            </select>
          </div>
          <aside className="hidden max-h-[calc(100vh-12rem)] space-y-2 overflow-y-auto pr-1 xl:block" aria-label="Reports">
            {reports.map((r) => (
              <ReportCard key={r.id} r={r} active={r.id === selected?.id} onClick={() => choose(r.id)} />
            ))}
          </aside>

          {selected && (
            <div className="min-w-0 space-y-5">
              <ReportHeader r={selected} onEntry={() => { setEntryDay(null); setEntryOpen(true); }} onEdit={() => setForm("edit")} />
              <PerformanceOverview key={selected.id} report={selected} today={today} />
              <History report={selected} today={today} onEdit={(d) => { setEntryDay(d); setEntryOpen(true); }} />
            </div>
          )}
        </div>
      )}

      {selected && (
        <EntryModal report={selected} open={entryOpen && !!selected.can_enter} onClose={closeEntry} today={today} initialDate={entryDay} />
      )}
      <ReportFormModal
        open={form !== null}
        onClose={() => setForm(null)}
        today={today}
        report={form === "edit" ? selected : null}
        onCreated={(id) => choose(id)}
      />
    </div>
  );
}
