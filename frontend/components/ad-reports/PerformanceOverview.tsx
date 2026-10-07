"use client";

/**
 * The Meta Ads Manager "Performance overview" card, fed by daily entries.
 *
 * Behaves like Meta's: the KPI tiles sit above one chart, and clicking a tile
 * switches the chart to that metric (the chosen tile carries the outline).
 * Unreported days are gaps with a hollow marker on the baseline — never a dip
 * to zero — and corrected days carry a ✎ marker, Meta's "Manual edits" idea.
 */
import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowDownRight, ArrowUpRight, Info, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAdSeries } from "@/hooks/useAdReports";
import {
  METRIC_META, addDaysISO, changePct, compactIN, dayLabel, dayLabelW, formatMetric, monthLabel, tilesFor,
  type TileMetric,
} from "@/lib/adReports";
import type { AdGranularity, AdReport, AdSeries, AdSeriesPoint } from "@/types/adReport";

const LINE = "#14b8a6";
type RangeKey = "7" | "14" | "30" | "month" | "life" | "custom";

const RANGES: { key: RangeKey; label: string }[] = [
  { key: "7", label: "Last 7 days" },
  { key: "14", label: "Last 14 days" },
  { key: "30", label: "Last 30 days" },
  { key: "month", label: "This month" },
  { key: "life", label: "Lifetime" },
  { key: "custom", label: "Custom" },
];

function rangeFor(key: RangeKey, report: AdReport, today: string, custom: { from: string; to: string }) {
  const yesterday = addDaysISO(today, -1);
  const lastOwed = report.end_date && report.end_date < yesterday ? report.end_date : yesterday;
  switch (key) {
    case "7": return { from: addDaysISO(lastOwed, -6), to: lastOwed };
    case "14": return { from: addDaysISO(lastOwed, -13), to: lastOwed };
    case "30": return { from: addDaysISO(lastOwed, -29), to: lastOwed };
    case "month": {
      const first = `${today.slice(0, 7)}-01`;
      return { from: first, to: yesterday < first ? first : yesterday };
    }
    case "life": return { from: report.start_date, to: lastOwed < report.start_date ? report.start_date : lastOwed };
    default: return custom;
  }
}

function pointLabel(p: AdSeriesPoint, g: AdGranularity) {
  if (g === "month") return monthLabel(p.from);
  if (g === "week") return `${dayLabel(p.from)}–${dayLabel(p.to)}`;
  return dayLabel(p.from);
}

interface ChartRow {
  label: string;
  value: number | null;
  missingMark: number | null;
  editMark: number | null;
  point: AdSeriesPoint;
}

function ChartTooltip({ active, payload, metric }: { active?: boolean; payload?: { payload: ChartRow }[]; metric: TileMetric }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  const p = row.point;
  return (
    <div className="rounded-lg border bg-card px-3 py-2 text-xs shadow-lg">
      <p className="font-medium">{p.from === p.to ? dayLabelW(p.from) : `${dayLabel(p.from)} – ${dayLabel(p.to)}`}</p>
      {row.value != null ? (
        <p className="text-muted-foreground">
          {METRIC_META[metric].label}: <span className="font-semibold text-foreground">{formatMetric(metric, row.value)}</span>
        </p>
      ) : (
        <p className="text-muted-foreground">{p.missing.length ? "Not reported" : "No numbers"}</p>
      )}
      {p.from !== p.to && p.missing.length > 0 && row.value != null && (
        <p className="text-amber-600 dark:text-amber-400">{p.missing.length} day{p.missing.length > 1 ? "s" : ""} not reported</p>
      )}
      {p.off.length > 0 && <p className="text-muted-foreground">Campaign off: {p.off.map(dayLabel).join(", ")}</p>}
      {p.edited.length > 0 && <p className="text-indigo-600 dark:text-indigo-400">✎ Corrected after entry</p>}
    </div>
  );
}

export function PerformanceOverview({ report, today, renderBelow }: {
  report: AdReport;
  today: string;
  /** Extra content for the same range (e.g. an account's per-ad table), under the chart. */
  renderBelow?: (series: AdSeries) => React.ReactNode;
}) {
  const [granularity, setGranularity] = useState<AdGranularity>("day");
  const [rangeKey, setRangeKey] = useState<RangeKey>("14");
  const [custom, setCustom] = useState(() => ({ from: addDaysISO(today, -14), to: addDaysISO(today, -1) }));
  const [metric, setMetric] = useState<TileMetric>("leads");

  const { from, to } = rangeFor(rangeKey, report, today, custom);
  const validRange = !!from && !!to && from <= to;
  const { data, isLoading, isFetching } = useAdSeries(validRange ? report.id : null, from, to, granularity);

  const tiles = tilesFor(report.metrics);
  const chosen = tiles.includes(metric) ? metric : "leads";

  const rows: ChartRow[] = useMemo(() => (data?.points ?? []).map((p) => ({
    label: pointLabel(p, granularity),
    value: p.values?.[chosen] ?? null,
    missingMark: !p.values && p.missing.length ? 0 : null,
    editMark: p.edited.length ? 0 : null,
    point: p,
  })), [data, granularity, chosen]);

  const meta = METRIC_META[chosen];
  const selectCls = "h-9 rounded-lg border bg-background px-3 text-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30";

  return (
    <section className="rounded-2xl border bg-card p-4 sm:p-6 delta-shadow">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-base font-semibold">Performance overview</h3>
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label="Group by" value={granularity} onChange={(e) => setGranularity(e.target.value as AdGranularity)} className={selectCls}>
            <option value="day">Day</option>
            <option value="week">Week</option>
            <option value="month">Month</option>
          </select>
          <select aria-label="Date range" value={rangeKey} onChange={(e) => setRangeKey(e.target.value as RangeKey)} className={selectCls}>
            {RANGES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
          </select>
          {rangeKey === "custom" && (
            <div className="flex items-center gap-1.5 text-sm">
              <input type="date" aria-label="From" value={custom.from} max={custom.to}
                onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} className={selectCls} />
              <span className="text-muted-foreground">to</span>
              <input type="date" aria-label="To" value={custom.to} min={custom.from} max={today}
                onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} className={selectCls} />
            </div>
          )}
        </div>
      </div>

      {/* KPI tiles */}
      <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3">
        {tiles.map((m) => {
          const v = data?.totals[m];
          const pct = data ? changePct(data.totals, data.previous, m) : null;
          const flat = pct != null && Math.abs(pct) < 0.5;
          const good = pct == null ? null : METRIC_META[m].lowerIsBetter ? pct < 0 : pct > 0;
          const active = m === chosen;
          return (
            <button
              key={m}
              type="button"
              onClick={() => setMetric(m)}
              aria-pressed={active}
              className={cn(
                "min-w-0 rounded-xl border p-3 text-left transition lg:p-4",
                active ? "border-foreground/70 ring-1 ring-foreground/20" : "border-transparent hover:border-border hover:bg-muted/40",
              )}
            >
              <span className="flex items-center gap-1 text-[13px] font-medium sm:whitespace-nowrap sm:text-sm">
                {METRIC_META[m].label}
                <span title={METRIC_META[m].hint} className="text-muted-foreground"><Info className="size-3.5" /></span>
              </span>
              <span className={cn("mt-1 block whitespace-nowrap text-xl font-semibold tabular-nums tracking-tight sm:text-2xl xl:text-[1.75rem]", isLoading && "animate-pulse text-muted-foreground")}>
                {isLoading ? "—" : formatMetric(m, v)}
              </span>
              <span className="mt-1 flex h-4 items-center gap-0.5 text-xs">
                {pct != null && (
                  <span
                    title="Compared with the previous period of the same length"
                    className={cn("inline-flex items-center gap-0.5 font-medium",
                      flat ? "text-muted-foreground" : good ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400")}
                  >
                    {!flat && (pct >= 0 ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />)}
                    {flat ? "No change" : `${Math.abs(pct).toFixed(0)}%`}
                    <span className="hidden font-normal text-muted-foreground 2xl:inline">&nbsp;vs previous</span>
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>

      {/* Chart */}
      <div className="mt-5">
        <p className="mb-2 text-sm font-semibold">{meta.label}</p>
        {!validRange ? (
          <div className="flex h-60 items-center justify-center text-sm text-muted-foreground">Choose a valid date range.</div>
        ) : isLoading ? (
          <div className="h-60 animate-pulse rounded-xl bg-muted" />
        ) : !data?.reported_days && !rows.some((r) => r.missingMark != null) ? (
          <div className="flex h-60 flex-col items-center justify-center gap-1 text-center text-sm text-muted-foreground">
            <p className="font-medium text-foreground">No numbers in this range yet</p>
            <p>They appear here as soon as the first day is entered.</p>
          </div>
        ) : (
          <div className={cn("transition-opacity", isFetching && "opacity-70")}>
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} className="stroke-border" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={16} />
                <YAxis
                  tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={52} allowDecimals={!!meta.pct}
                  tickFormatter={(v: number) => (meta.money ? `₹${compactIN(v / 100)}` : meta.pct ? `${v}%` : compactIN(v))}
                />
                <Tooltip content={<ChartTooltip metric={chosen} />} />
                <Line type="linear" dataKey="value" stroke={LINE} strokeWidth={2} connectNulls={false}
                  dot={rows.length <= 31 ? { r: 2.5, fill: LINE, strokeWidth: 0 } : false}
                  activeDot={{ r: 4 }} isAnimationActive={false} />
                {/* Baseline markers: hollow = not reported, ✎ = corrected */}
                <Line dataKey="missingMark" stroke="none" isAnimationActive={false} legendType="none" activeDot={false}
                  dot={(props: { cx?: number; cy?: number; index?: number }) =>
                    props.cx == null || rows[props.index ?? 0]?.missingMark == null ? <g key={props.index} /> :
                    <circle key={props.index} cx={props.cx} cy={props.cy} r={4} fill="var(--card)" stroke="currentColor" strokeWidth={1.5} className="text-muted-foreground" />} />
                <Line dataKey="editMark" stroke="none" isAnimationActive={false} legendType="none" activeDot={false}
                  dot={(props: { cx?: number; cy?: number; index?: number }) =>
                    props.cx == null || rows[props.index ?? 0]?.editMark == null ? <g key={props.index} /> :
                    <g key={props.index} transform={`translate(${props.cx - 6},${(props.cy ?? 0) - 6})`} className="text-indigo-600 dark:text-indigo-400">
                      <circle cx={6} cy={6} r={7} fill="var(--card)" />
                      <Pencil x={1} y={1} width={10} height={10} />
                    </g>} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
        {/* Legend */}
        <div className="mt-3 flex flex-wrap items-center justify-center gap-x-5 gap-y-1 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5"><span className="size-3 rounded-sm" style={{ background: LINE }} />{meta.label}</span>
          <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full border-[1.5px] border-muted-foreground" />Not reported</span>
          <span className="flex items-center gap-1.5 text-indigo-600 dark:text-indigo-400"><Pencil className="size-3" />Corrected</span>
          {data && data.reported_days > 0 && (
            <span>{data.reported_days} day{data.reported_days > 1 ? "s" : ""} reported</span>
          )}
        </div>
      </div>
      {data && renderBelow?.(data)}
    </section>
  );
}
