"use client";

import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Plus,
  Trash2,
  Play,
  Loader2,
  GitMerge,
  Download,
} from "lucide-react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { SelectField } from "@/components/ui/select-field";
import { useBlendReport } from "@/hooks/useReports";
import type { BlendSource, BlendData, BlendSeries } from "@/hooks/useReports";
import { DateRangePicker } from "@/components/shared/DateRangePicker";
import { fmtDateOnly } from "@/lib/datetime";

// ── Constants ─────────────────────────────────────────────────────────────────

const PLATFORMS = [
  "google_ads",
  "facebook_ads",
  "instagram_login",
  "linkedin_ads",
  "tiktok_ads",
  "ga4",
  "google_search_console",
];

const ALL_METRICS = [
  { id: "spend",       label: "Spend" },
  { id: "clicks",      label: "Clicks" },
  { id: "impressions", label: "Impressions" },
  { id: "conversions", label: "Conversions" },
  { id: "revenue",     label: "Revenue" },
  { id: "ctr",         label: "CTR" },
  { id: "cpc",         label: "CPC" },
  { id: "roas",        label: "ROAS" },
];

// Distinct palette — 12 colors, cycling when more series
const PALETTE = [
  "#6366f1", "#0ea5e9", "#10b981", "#f59e0b",
  "#ec4899", "#8b5cf6", "#14b8a6", "#f97316",
  "#06b6d4", "#84cc16", "#e11d48", "#7c3aed",
];

function platformLabel(p: string) {
  return p.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function fmtDate(iso: string) {
  return fmtDateOnly(iso, { month: "short", day: "numeric" });
}

function fmtValue(metric: string, v: number) {
  if (["spend", "revenue", "cpc"].includes(metric)) return `$${v.toLocaleString()}`;
  if (metric === "ctr") return `${v.toFixed(2)}%`;
  if (metric === "roas") return `${v.toFixed(2)}×`;
  return v.toLocaleString();
}

// ── Source row ────────────────────────────────────────────────────────────────

interface SourceRowProps {
  source: BlendSource;
  index: number;
  color: string;
  onChange: (src: BlendSource) => void;
  onRemove: () => void;
  canRemove: boolean;
}

function SourceRow({ source, index, color, onChange, onRemove, canRemove }: SourceRowProps) {
  const toggleMetric = (m: string) => {
    const next = source.metrics.includes(m)
      ? source.metrics.filter((x) => x !== m)
      : [...source.metrics, m];
    onChange({ ...source, metrics: next });
  };

  return (
    <div className="rounded-2xl border bg-card p-4 space-y-3">
      <div className="flex items-center gap-3">
        {/* Color swatch */}
        <div className="size-3 rounded-full shrink-0" style={{ background: color }} />

        {/* Platform picker */}
        <SelectField
          aria-label={`Platform for source ${index + 1}`}
          value={source.platform}
          onValueChange={(v) => onChange({ ...source, platform: v })}
          placeholder="Select platform…"
          options={[
            { value: "", label: "Select platform…" },
            ...PLATFORMS.map((p) => ({ value: p, label: platformLabel(p) })),
          ]}
          className="flex-1 rounded-xl"
        />

        {canRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
          >
            <Trash2 className="size-4" />
          </button>
        )}
      </div>

      {/* Metric chips */}
      <div className="flex flex-wrap gap-1.5">
        {ALL_METRICS.map(({ id, label }) => {
          const active = source.metrics.includes(id);
          return (
            <button
              key={id}
              type="button"
              onClick={() => toggleMetric(id)}
              style={active ? { background: color + "22", borderColor: color, color } : undefined}
              className={cn(
                "rounded-lg border px-2.5 py-1 text-xs font-medium transition-all",
                active
                  ? "border-current"
                  : "border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground"
              )}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Blend chart ───────────────────────────────────────────────────────────────

function BlendChart({ result }: { result: BlendData }) {
  const rows = result.dates.map((date, i) => {
    const row: Record<string, unknown> = { date, label: fmtDate(date) };
    result.series.forEach((s) => { row[s.key] = s.data[i]; });
    return row;
  });

  if (!rows.length || !result.series.length) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
        No data for this date range and platform selection
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={rows} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            className="text-muted-foreground"
            interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            className="text-muted-foreground"
            width={48}
            tickFormatter={(v) => {
              if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
              if (v >= 1_000) return `${(v / 1_000).toFixed(0)}k`;
              return String(v);
            }}
          />
          <Tooltip
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              return (
                <div className="rounded-xl border bg-card px-3 py-2.5 shadow-lg text-xs space-y-1.5 min-w-[160px]">
                  <p className="font-semibold text-foreground">{label}</p>
                  {payload.map((entry) => {
                    const series = result.series.find((s) => s.key === entry.dataKey);
                    if (!series) return null;
                    return (
                      <div key={entry.dataKey as string} className="flex items-center justify-between gap-3">
                        <span className="flex items-center gap-1.5 text-muted-foreground">
                          <span className="size-2 rounded-full shrink-0" style={{ background: entry.color }} />
                          {platformLabel(series.platform)} · {series.metric}
                        </span>
                        <span className="font-medium text-foreground tabular-nums">
                          {fmtValue(series.metric, entry.value as number)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              );
            }}
          />
          <Legend
            formatter={(value) => {
              const series = result.series.find((s) => s.key === value);
              if (!series) return value;
              return `${platformLabel(series.platform)} · ${series.metric}`;
            }}
            wrapperStyle={{ fontSize: 11, paddingTop: 12 }}
          />
          {result.series.map((s, i) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              stroke={PALETTE[i % PALETTE.length]}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 0 }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </motion.div>
  );
}

// ── Data table ────────────────────────────────────────────────────────────────

function BlendTable({ result }: { result: BlendData }) {
  const rows = result.dates.map((date, i) => {
    const row: Record<string, unknown> = { date };
    result.series.forEach((s) => { row[s.key] = s.data[i]; });
    return row;
  });

  const handleExport = () => {
    const headers = ["date", ...result.series.map((s) => s.key)];
    const csv = [
      headers.join(","),
      ...rows.map((r) => headers.map((h) => r[h] ?? "").join(",")),
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "blend_report.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <div className="flex justify-end mb-3">
        <Button size="sm" variant="outline" className="gap-2" onClick={handleExport}>
          <Download className="size-3.5" />
          Export CSV
        </Button>
      </div>
      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/30">
              <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Date</th>
              {result.series.map((s, i) => (
                <th key={s.key} className="px-4 py-2.5 text-right text-xs font-medium text-muted-foreground whitespace-nowrap">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="size-2 rounded-full" style={{ background: PALETTE[i % PALETTE.length] }} />
                    {platformLabel(s.platform)} · {s.metric}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                <td className="px-4 py-2.5 text-muted-foreground text-xs">{fmtDate(row.date as string)}</td>
                {result.series.map((s) => (
                  <td key={s.key} className="px-4 py-2.5 text-right tabular-nums">
                    {fmtValue(s.metric, (row[s.key] as number) ?? 0)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

function today()     { return new Date().toISOString().slice(0, 10); }
function daysAgo(n: number) {
  const d = new Date(); d.setDate(d.getDate() - n + 1);
  return d.toISOString().slice(0, 10);
}

type ViewMode = "chart" | "table";

export function BlendBuilder() {
  const [sources, setSources] = useState<BlendSource[]>([
    { platform: "google_ads",   metrics: ["spend"] },
    { platform: "facebook_ads", metrics: ["spend"] },
  ]);
  const [dateFrom, setDateFrom] = useState(daysAgo(30));
  const [dateTo,   setDateTo]   = useState(today());
  const [result,   setResult]   = useState<BlendData | null>(null);
  const [view,     setView]     = useState<ViewMode>("chart");

  const blend = useBlendReport();

  const addSource = () => {
    setSources((prev) => [...prev, { platform: "", metrics: ["spend"] }]);
  };

  const updateSource = (i: number, src: BlendSource) => {
    setSources((prev) => prev.map((s, idx) => (idx === i ? src : s)));
  };

  const removeSource = (i: number) => {
    setSources((prev) => prev.filter((_, idx) => idx !== i));
  };

  const handleRun = async () => {
    const valid = sources.filter((s) => s.platform && s.metrics.length > 0);
    if (!valid.length) return;
    const data = await blend.mutateAsync({ sources: valid, date_from: dateFrom, date_to: dateTo });
    setResult(data);
  };

  const totalSeries = sources.reduce((acc, s) => acc + s.metrics.length, 0);
  const canRun = sources.some((s) => s.platform && s.metrics.length > 0);

  return (
    <div className="space-y-5">
      {/* Date range */}
      <DateRangePicker
        dateFrom={dateFrom}
        dateTo={dateTo}
        onFromChange={setDateFrom}
        onToChange={setDateTo}
      />

      {/* Sources */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">Platform sources</p>
          <span className="text-xs text-muted-foreground">{totalSeries} series selected</span>
        </div>

        <AnimatePresence initial={false}>
          {sources.map((src, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.18 }}
            >
              <SourceRow
                source={src}
                index={i}
                color={PALETTE[i % PALETTE.length]}
                onChange={(s) => updateSource(i, s)}
                onRemove={() => removeSource(i)}
                canRemove={sources.length > 1}
              />
            </motion.div>
          ))}
        </AnimatePresence>

        <button
          type="button"
          onClick={addSource}
          disabled={sources.length >= 6}
          className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed py-2.5 text-sm text-muted-foreground hover:border-primary hover:text-primary transition-colors disabled:opacity-40"
        >
          <Plus className="size-4" />
          Add platform
        </button>
      </div>

      {/* Run */}
      <Button
        className="w-full gap-2"
        disabled={!canRun || blend.isPending}
        onClick={handleRun}
      >
        {blend.isPending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <GitMerge className="size-4" />
        )}
        {blend.isPending ? "Blending…" : "Run blend report"}
      </Button>

      {/* Results */}
      <AnimatePresence>
        {result && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-4 rounded-2xl border bg-card p-5"
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-sm">Blended report</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {result.dates.length} dates · {result.series.length} series
                </p>
              </div>
              <div className="flex items-center gap-1 rounded-xl border bg-muted/40 p-1">
                {(["chart", "table"] as ViewMode[]).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setView(v)}
                    className={cn(
                      "rounded-lg px-3 py-1 text-xs font-medium transition-colors capitalize",
                      view === v
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>

            {view === "chart" ? (
              <BlendChart result={result} />
            ) : (
              <BlendTable result={result} />
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
