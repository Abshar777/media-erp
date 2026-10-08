"use client";

/**
 * The "report" part of a flag: last 7 complete days vs the 7 before — leads,
 * amount spent, cost per lead — plus the 14-day leads trend. Same numbers and
 * formatting as the Performance overview.
 */
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { changePct, dayLabel, formatMetric, METRIC_META, type TileMetric } from "@/lib/adReports";
import { Sparkline } from "@/components/ad-reports/Sparkline";
import type { AdFlagSnapshot } from "@/types/adFlag";

const TILES: TileMetric[] = ["leads", "spend", "cpl"];

export function FlagNumbers({ snap, compact }: { snap: AdFlagSnapshot | null; compact?: boolean }) {
  if (!snap) return null;
  const label = { leads: "Leads", spend: "Spent", cpl: "Per lead" } as Record<string, string>;
  return (
    <div className="space-y-2">
      <p className="text-[11px] text-muted-foreground">
        Last 7 days · {dayLabel(snap.range.from)} – {dayLabel(snap.range.to)}
        {snap.reported_days < 7 && <> · {snap.reported_days} of 7 days reported</>}
      </p>
      {compact ? (
        // Narrow places (cards, the dialog): one row per number, so money never gets cut off.
        <dl className="divide-y rounded-lg border bg-background/60 text-xs">
          {TILES.map((m) => {
            const pct = changePct(snap.totals, snap.previous, m);
            const better = pct == null ? null : (METRIC_META[m].lowerIsBetter ? pct < 0 : pct > 0);
            return (
              <div key={m} className="flex items-center justify-between gap-2 px-2.5 py-1.5">
                <dt className="text-muted-foreground">{label[m]}</dt>
                <dd className="flex items-center gap-1.5 font-semibold tabular-nums">
                  {formatMetric(m, snap.totals[m])}
                  {pct != null && <Change pct={pct} better={!!better} />}
                </dd>
              </div>
            );
          })}
        </dl>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {TILES.map((m) => {
            const pct = changePct(snap.totals, snap.previous, m);
            const better = pct == null ? null : (METRIC_META[m].lowerIsBetter ? pct < 0 : pct > 0);
            return (
              <div key={m} className="min-w-0 rounded-lg border bg-background/60 px-2.5 py-2">
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label[m]}</p>
                <p className="truncate text-base font-semibold tabular-nums">{formatMetric(m, snap.totals[m])}</p>
                {pct != null && <Change pct={pct} better={!!better} />}
              </div>
            );
          })}
        </div>
      )}
      {snap.sparkline.some((v) => v != null) && (
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          <span>Leads, 14 days</span>
          <Sparkline values={snap.sparkline} className="text-teal-500" />
        </div>
      )}
    </div>
  );
}

function Change({ pct, better }: { pct: number; better: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-[10px] font-medium tabular-nums",
      better ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400")}
      title="vs the 7 days before">
      {pct >= 0 ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
      {Math.abs(pct) >= 1000 ? "999+" : Math.abs(pct).toFixed(0)}%
    </span>
  );
}
