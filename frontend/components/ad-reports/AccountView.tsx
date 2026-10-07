"use client";

/**
 * An ad account: Meta's top level, holding the ads underneath it.
 *
 * Nothing is typed for an account — its Performance overview is its ads added
 * up (the backend rolls them up, ratios included), and below the chart a table
 * breaks the same range down ad by ad, so a leader sees which ad is spending
 * and which is bringing leads. Click an ad to open it.
 */
import { useEffect, useState } from "react";
import { Building2, CalendarRange, Flag, Hash, Megaphone, Plus, Settings2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useUpdateAdReport } from "@/hooks/useAdReports";
import { dayLabel, formatCount, formatINR } from "@/lib/adReports";
import { PerformanceOverview } from "./PerformanceOverview";
import { StatusChip } from "./StatusChip";
import { CreativeThumb } from "./CreativeShowcase";
import type { AdBreakdownRow, AdReport, AdSeries } from "@/types/adReport";

interface Props {
  account: AdReport;
  today: string;
  onOpenAd: (id: string) => void;
  onAddAd: () => void;
  onEdit: () => void;
}

export function AccountView({ account, today, onOpenAd, onAddAd, onEdit }: Props) {
  const a = account.account;
  const empty = !a || a.ads === 0;
  return (
    <div className="min-w-0 space-y-5">
      <AccountHero account={account} onAddAd={onAddAd} onEdit={onEdit} />
      {empty ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed px-6 py-14 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary"><Megaphone className="size-6" /></span>
          <div>
            <p className="font-semibold">No ads in this account yet</p>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              Add the ads that run from this Meta ad account. Their daily numbers add up here automatically.
            </p>
          </div>
          {account.can_manage && account.status !== "ended" && (
            <button type="button" onClick={onAddAd}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90">
              <Plus className="size-4" /> Add an ad
            </button>
          )}
        </div>
      ) : (
        <PerformanceOverview
          key={account.id}
          report={account}
          today={today}
          renderBelow={(s) => <Breakdown series={s} onOpenAd={onOpenAd} />}
        />
      )}
    </div>
  );
}

function AccountHero({ account, onAddAd, onEdit }: { account: AdReport; onAddAd: () => void; onEdit: () => void }) {
  const update = useUpdateAdReport();
  const [confirmEnd, setConfirmEnd] = useState(false);
  useEffect(() => setConfirmEnd(false), [account.id]);
  const a = account.account;
  const manage = account.can_manage && account.status !== "ended";
  const btn = "inline-flex h-9 items-center gap-1.5 rounded-lg border bg-background px-3 text-sm font-medium transition hover:bg-muted disabled:opacity-50";
  const facts: { label: string; value: React.ReactNode; icon?: React.ElementType }[] = [
    { label: "Team", value: account.team_name || "—" },
    { label: "Ad account ID", value: account.ad_account_ref || <span className="text-muted-foreground">Not set</span>, icon: Hash },
    { label: "Ads", value: a ? <>{a.ads} <span className="font-normal text-muted-foreground">· {a.active_ads} active{a.missing_ads ? ` · ${a.missing_ads} missing` : ""}</span></> : "—" },
    { label: "Since", value: account.start_date ? dayLabel(account.start_date) : "—", icon: CalendarRange },
  ];
  return (
    <section className="relative overflow-hidden rounded-2xl border bg-card p-4 delta-shadow sm:p-5">
      {/* A soft brand wash makes an account read as a "parent" at a glance. */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-20 bg-gradient-to-r from-blue-500/10 via-indigo-500/5 to-transparent" />
      <div className="relative flex flex-col gap-4 sm:flex-row sm:items-start">
        <span className="flex size-16 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-600 text-white shadow-sm">
          <Building2 className="size-7" />
        </span>
        <div className="min-w-0 flex-1 space-y-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-md bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-blue-700 dark:text-blue-400">Ad account</span>
              <StatusChip status={account.day_status} />
            </div>
            <h2 className="mt-1.5 text-xl font-semibold leading-tight tracking-tight sm:text-2xl">{account.name}</h2>
            <p className="mt-1 text-xs text-muted-foreground">Numbers here are the ads below, added up — nothing is typed for the account itself.</p>
          </div>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm lg:grid-cols-4">
            {facts.map((f) => (
              <div key={f.label} className="min-w-0">
                <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{f.label}</dt>
                <dd className="mt-0.5 break-words font-medium leading-snug">{f.value}</dd>
              </div>
            ))}
          </dl>
          {manage && (
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={onAddAd}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:opacity-90">
                <Plus className="size-4" /> Add ad
              </button>
              <button type="button" className={btn} onClick={onEdit}><Settings2 className="size-4" /> Edit</button>
              {confirmEnd ? (
                <span className="inline-flex items-center gap-1.5 text-xs">
                  End this account? Its ads keep running.
                  <button type="button" className="rounded-md px-2 py-1 font-medium hover:bg-muted" onClick={() => setConfirmEnd(false)}>Cancel</button>
                  <button type="button" className="rounded-md border border-red-500/40 px-2 py-1 font-medium text-red-600 hover:bg-red-500/10 dark:text-red-400"
                    onClick={() => update.mutate({ id: account.id, action: "end" })}>End account</button>
                </span>
              ) : (
                <button type="button" className={btn} onClick={() => setConfirmEnd(true)}><Flag className="size-4" /> End</button>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function Breakdown({ series, onOpenAd }: { series: AdSeries; onOpenAd: (id: string) => void }) {
  const rows: AdBreakdownRow[] = series.breakdown ?? [];
  if (!rows.length) return null;
  const totalSpend = rows.reduce((n, r) => n + (r.totals.spend ?? 0), 0);
  const sorted = [...rows].sort((x, y) => (y.totals.spend ?? 0) - (x.totals.spend ?? 0));
  return (
    <div className="mt-6 border-t pt-5">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h4 className="text-sm font-semibold">Ads in this account</h4>
        <span className="text-xs text-muted-foreground">Same range as above · sorted by spend</span>
      </div>
      <div className="-mx-2 overflow-x-auto">
        <table className="w-full min-w-[620px] text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th className="px-2 py-1.5 font-medium">Ad</th>
              <th className="px-2 py-1.5 font-medium">Today</th>
              <th className="px-2 py-1.5 text-right font-medium">Leads</th>
              <th className="px-2 py-1.5 text-right font-medium">Spent</th>
              <th className="px-2 py-1.5 text-right font-medium">Per lead</th>
              <th className="w-36 px-2 py-1.5 font-medium">Share of spend</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => {
              const spend = r.totals.spend ?? 0;
              const share = totalSpend ? Math.round((spend / totalSpend) * 100) : 0;
              return (
                <tr key={r.id} onClick={() => onOpenAd(r.id)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpenAd(r.id); } }}
                  tabIndex={0} role="link" aria-label={`Open ${r.name}`}
                  className="cursor-pointer border-t outline-none transition hover:bg-muted/50 focus-visible:bg-muted/60">
                  <td className="px-2 py-2">
                    <div className="flex items-center gap-2.5">
                      <CreativeThumb creative={r.cover ?? undefined} className="size-9" />
                      <div className="min-w-0">
                        <p className="truncate font-medium">{r.name}</p>
                        <p className="truncate text-xs text-muted-foreground">{r.owners.join(" · ") || "—"}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-2 py-2"><StatusChip status={r.day_status} /></td>
                  <td className="px-2 py-2 text-right tabular-nums">{r.totals.leads == null ? "—" : formatCount(r.totals.leads)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{r.totals.spend == null ? "—" : formatINR(spend)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{r.totals.cpl == null ? "—" : formatINR(r.totals.cpl)}</td>
                  <td className="px-2 py-2">
                    <div className="flex items-center gap-2">
                      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                        <span className={cn("block h-full rounded-full bg-teal-500")} style={{ width: `${share}%` }} />
                      </span>
                      <span className="w-8 text-right text-xs tabular-nums text-muted-foreground">{share}%</span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
