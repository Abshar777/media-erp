"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/lib/utils";
import {
  BarChart2,
  BookmarkCheck,
  Check,
  Copy,
  Download,
  Eye,
  GitMerge,
  Link2,
  Loader2,
  MousePointerClick,
  RefreshCw,
  Trash2,
  TrendingUp,
  Users,
  DollarSign,
  X,
  GitBranch,
} from "lucide-react";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";

import PageHeader     from "@/components/shared/PageHeader";
import { DateRangePicker } from "@/components/shared/DateRangePicker";
import { SearchInput }    from "@/components/shared/SearchInput";
import { KpiCard }        from "@/components/reports/KpiCard";
import { SpendTrendChart } from "@/components/reports/SpendTrendChart";
import { PlatformDonut }  from "@/components/reports/PlatformDonut";
import { CampaignBarChart } from "@/components/reports/CampaignBarChart";
import { DataTable }      from "@/components/reports/DataTable";
import { Pagination }     from "@/components/reports/Pagination";
import { ReportBuilder }      from "@/components/reports/ReportBuilder";
import { BlendBuilder }       from "@/components/reports/BlendBuilder";
import { AttributionReport }  from "@/components/reports/AttributionReport";
import { AnomalyPanel }       from "@/components/reports/AnomalyPanel";
import { Button }         from "@/components/ui/button";
import { SelectField }    from "@/components/ui/select-field";

import {
  useOverview,
  useTrend,
  useCampaigns,
  useCustomReport,
  useExportCsv,
  useSavedReports,
  useDeleteSavedReport,
  useShareReport,
  useRevokeShare,
} from "@/hooks/useReports";
import { useFx, convertValue, fmtCurrency, SUPPORTED_CURRENCIES, type Currency } from "@/hooks/useFx";
import { fadeVariants, kpiContainerVariants, listVariants, listItemVariants } from "@/lib/animations";
import type { ReportMetric, CampaignRow, OverviewKpis, SavedReport } from "@/types/report";

// ── helpers ───────────────────────────────────────────────────────────────────
function today()         { return new Date().toISOString().slice(0, 10); }
function daysAgo(n: number) {
  const d = new Date(); d.setDate(d.getDate() - n + 1);
  return d.toISOString().slice(0, 10);
}

// ── KPI config ────────────────────────────────────────────────────────────────
const MONETARY_METRICS = new Set(["spend", "revenue", "cpc"]);
interface KpiConf {
  metric: keyof OverviewKpis;
  label: string;
  icon: LucideIcon;
  color: string;
  bg: string;
}
const KPI_CONF: KpiConf[] = [
  { metric: "spend",       label: "Ad Spend",    icon: DollarSign,        color: "text-amber-500",   bg: "bg-amber-500/10"   },
  { metric: "impressions", label: "Impressions",  icon: Eye,               color: "text-blue-500",    bg: "bg-blue-500/10"    },
  { metric: "clicks",      label: "Clicks",       icon: MousePointerClick, color: "text-sky-500",     bg: "bg-sky-500/10"     },
  { metric: "conversions", label: "Conversions",  icon: Users,             color: "text-emerald-500", bg: "bg-emerald-500/10" },
  { metric: "revenue",     label: "Revenue",      icon: TrendingUp,        color: "text-green-500",   bg: "bg-green-500/10"   },
  { metric: "ctr",         label: "CTR",          icon: BarChart2,         color: "text-violet-500",  bg: "bg-violet-500/10"  },
  { metric: "roas",        label: "ROAS",         icon: TrendingUp,        color: "text-indigo-500",  bg: "bg-indigo-500/10"  },
];

const TREND_OPTIONS: ReportMetric[] = ["spend", "clicks", "impressions", "conversions", "revenue"];

// ── Tabs ─────────────────────────────────────────────────────────────────────
type Tab = "analytics" | "builder" | "saved" | "blend" | "attribution";

const TABS: { id: Tab; label: string; icon: LucideIcon }[] = [
  { id: "analytics",   label: "Analytics",      icon: BarChart2      },
  { id: "builder",     label: "Report Builder", icon: TrendingUp     },
  { id: "saved",       label: "Saved Reports",  icon: BookmarkCheck  },
  { id: "blend",       label: "Data Blend",     icon: GitMerge       },
  { id: "attribution", label: "Attribution",    icon: GitBranch      },
];

// ── Saved report card ─────────────────────────────────────────────────────────
function SavedReportCard({ report, onDelete }: { report: SavedReport; onDelete: (id: string) => void }) {
  const fmt = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" });
  const CHART_ICONS: Record<string, LucideIcon> = {
    line: TrendingUp, bar: BarChart2, donut: Eye, table: MousePointerClick,
  };
  const ChartIcon = CHART_ICONS[report.chart_type] ?? BarChart2;

  const shareReport = useShareReport();
  const revokeShare = useRevokeShare();
  const [shareUrl, setShareUrl] = useState<string | null>(
    report.share_token ? `${window?.location?.origin ?? ""}/reports/shared/${report.share_token}` : null
  );
  const [copied, setCopied] = useState(false);

  const handleShare = async () => {
    if (shareUrl) {
      // Already shared — just copy
      await handleCopy();
      return;
    }
    const result = await shareReport.mutateAsync(report._id);
    setShareUrl(result.share_url);
  };

  const handleCopy = async () => {
    const url = shareUrl ?? "";
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
    }
  };

  const handleRevoke = async () => {
    await revokeShare.mutateAsync(report._id);
    setShareUrl(null);
  };

  return (
    <motion.div
      variants={listItemVariants}
      className="group rounded-xl border bg-card p-4 shadow-sm hover:shadow-md transition-shadow space-y-3"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <ChartIcon className="size-4" />
          </span>
          <Link
            href={`/reports/${report._id}`}
            className="truncate font-medium text-sm hover:underline underline-offset-2"
          >
            {report.name}
          </Link>
        </div>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            type="button"
            onClick={handleShare}
            disabled={shareReport.isPending}
            className="rounded-md p-1 text-muted-foreground hover:bg-primary/10 hover:text-primary transition-colors"
            title={shareUrl ? "Copy share link" : "Share report"}
          >
            {shareReport.isPending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : copied ? (
              <Check className="size-3.5 text-emerald-500" />
            ) : shareUrl ? (
              <Copy className="size-3.5" />
            ) : (
              <Link2 className="size-3.5" />
            )}
          </button>
          <button
            type="button"
            onClick={() => onDelete(report._id)}
            className="rounded-md p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
            title="Delete report"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      </div>

      {/* Share URL banner */}
      {shareUrl && (
        <div className="flex items-center gap-2 rounded-lg bg-primary/5 border border-primary/20 px-2.5 py-1.5">
          <Link2 className="size-3 shrink-0 text-primary" />
          <span className="flex-1 truncate text-[11px] text-primary">{shareUrl}</span>
          <button
            type="button"
            onClick={handleRevoke}
            disabled={revokeShare.isPending}
            className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-destructive transition-colors"
            title="Revoke share link"
          >
            <X className="size-3" />
          </button>
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {report.metrics.map((m) => (
          <span
            key={m}
            className="rounded-md bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground capitalize"
          >
            {m}
          </span>
        ))}
      </div>

      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span className="capitalize">{report.chart_type} · {report.dimensions.join(", ")}</span>
        <span>{fmt.format(new Date(report.created_at))}</span>
      </div>
    </motion.div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function ReportsPage() {
  const [activeTab, setActiveTab] = useState<Tab>("analytics");

  // ── Analytics tab state ────────────────────────────────────────────────────
  const [dateFrom,  setDateFrom]  = useState(daysAgo(30));
  const [dateTo,    setDateTo]    = useState(today());
  const [currency,  setCurrency]  = useState<Currency>("USD");

  // FX rates (stale 1 h, falls back gracefully)
  const { data: fxData } = useFx("USD");
  const fxRates = fxData?.rates ?? {};
  const [trendMetric, setTrendMetric] = useState<ReportMetric>("spend");
  const [search,  setSearch]  = useState("");
  const [page,    setPage]    = useState(1);
  const [sortBy,  setSortBy]  = useState("spend");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  // ── Data ───────────────────────────────────────────────────────────────────
  const overview  = useOverview(dateFrom, dateTo);
  const trend     = useTrend(trendMetric, "daily", dateFrom, dateTo);
  const campaigns = useCampaigns({ page, limit: 10, search, sort_by: sortBy, sort_dir: sortDir, date_from: dateFrom, date_to: dateTo });
  const exportCsv = useExportCsv();

  // Platform breakdown
  const platformBreakdown = useCustomReport();
  const [platformData, setPlatformData] = useState<{ platform: string; value: number }[]>([]);
  const [prevDates, setPrevDates] = useState({ from: dateFrom, to: dateTo });

  if (prevDates.from !== dateFrom || prevDates.to !== dateTo) {
    setPrevDates({ from: dateFrom, to: dateTo });
    platformBreakdown.mutate(
      { metrics: ["spend"], dimensions: ["platform"], filters: { date_from: dateFrom, date_to: dateTo }, chart_type: "donut" },
      {
        onSuccess(data) {
          const rows = data.data as { platform?: string; spend?: number }[];
          setPlatformData(rows.filter((r) => r.platform && r.spend != null).map((r) => ({ platform: r.platform!, value: r.spend! })));
        },
      }
    );
  }

  // Saved reports
  const savedReports = useSavedReports();
  const deleteReport = useDeleteSavedReport();

  // ── Helpers ────────────────────────────────────────────────────────────────
  function handleSort(col: string) {
    if (col === sortBy) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else { setSortBy(col); setSortDir("desc"); }
    setPage(1);
  }

  const campRows  = campaigns.data?.campaigns ?? [] as CampaignRow[];
  const campTotal = campaigns.data?.total  ?? 0;
  const campPages = campaigns.data?.pages  ?? 0;

  return (
    <div className="space-y-5">
      {/* Header */}
      <PageHeader
        title="Reports"
        subtitle="Marketing performance across all connected platforms"
        action={
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              exportCsv.mutate({
                metrics: ["spend", "clicks", "impressions", "ctr", "roas"],
                dimensions: ["platform", "date"],
                dateFrom,
                dateTo,
              })
            }
            disabled={exportCsv.isPending}
          >
            {exportCsv.isPending
              ? <RefreshCw className="mr-1.5 size-3 animate-spin" />
              : <Download className="mr-1.5 size-3" />}
            Export CSV
          </Button>
        }
      />

      {/* Tab bar */}
      <div className="flex gap-1 rounded-xl border bg-muted/40 p-1 w-fit max-w-full overflow-x-auto">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setActiveTab(id)}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-all",
              activeTab === id
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Icon className="size-3.5" />
            {label}
            {id === "saved" && savedReports.data?.length ? (
              <span className="ml-1 rounded-full bg-primary px-1.5 py-px text-[10px] font-semibold text-primary-foreground">
                {savedReports.data.length}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <AnimatePresence mode="wait">
        {/* ── ANALYTICS TAB ─────────────────────────────────────────── */}
        {activeTab === "analytics" && (
          <motion.div
            key="analytics"
            variants={fadeVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className="space-y-5"
          >
            {/* Date picker + currency selector */}
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex-1">
                <DateRangePicker
                  dateFrom={dateFrom}
                  dateTo={dateTo}
                  onFromChange={(v) => { setDateFrom(v); setPage(1); }}
                  onToChange={(v)   => { setDateTo(v);   setPage(1); }}
                />
              </div>
              <div className="space-y-1 shrink-0">
                <p id="reports-currency-label" className="text-xs text-muted-foreground">Currency</p>
                <SelectField<Currency>
                  aria-labelledby="reports-currency-label"
                  value={currency}
                  onValueChange={(v) => setCurrency(v)}
                  options={SUPPORTED_CURRENCIES.map((c) => ({ value: c, label: c }))}
                  className="w-auto min-w-[6rem] rounded-xl"
                />
              </div>
            </div>

            {/* Anomaly panel */}
            <AnomalyPanel dateFrom={dateFrom} dateTo={dateTo} />

            {/* KPI cards */}
            <motion.div
              variants={kpiContainerVariants}
              initial="initial"
              animate="animate"
              className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
            >
              {KPI_CONF.map((conf) => {
                const raw = overview.data?.kpis[conf.metric];
                // Apply FX conversion for monetary metrics
                const converted = (raw && currency !== "USD" && MONETARY_METRICS.has(conf.metric))
                  ? {
                      value: raw.value !== null ? convertValue(raw.value, currency, fxRates) : null,
                      delta: raw.delta,
                    }
                  : raw;
                return (
                  <KpiCard
                    key={conf.metric}
                    metric={conf.metric}
                    label={currency !== "USD" && MONETARY_METRICS.has(conf.metric)
                      ? `${conf.label} (${currency})`
                      : conf.label}
                    icon={conf.icon}
                    color={conf.color}
                    bg={conf.bg}
                    data={converted}
                    loading={overview.isLoading}
                  />
                );
              })}
            </motion.div>

            {/* Trend + Donut */}
            <div className="grid gap-4 lg:grid-cols-3">
              <div className="lg:col-span-2 min-w-0 rounded-xl border bg-card p-5 shadow-sm">
                <div className="mb-4 flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">Trend</span>
                  <div className="ml-auto flex gap-1">
                    {TREND_OPTIONS.map((m) => (
                      <button
                        key={m}
                        onClick={() => setTrendMetric(m)}
                        className={`rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors ${
                          trendMetric === m
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                </div>
                <SpendTrendChart
                  data={trend.data?.data ?? []}
                  metric={trendMetric}
                  loading={trend.isLoading}
                />
              </div>

              <div className="min-w-0 rounded-xl border bg-card p-5 shadow-sm">
                <p className="mb-4 text-sm font-medium">Spend by Platform</p>
                <PlatformDonut
                  data={platformData}
                  metric="spend"
                  loading={platformBreakdown.isPending}
                />
              </div>
            </div>

            {/* Bar chart */}
            <div className="rounded-xl border bg-card p-5 shadow-sm">
              <p className="mb-4 text-sm font-medium">Top Campaigns by Spend</p>
              <CampaignBarChart
                rows={campRows}
                metric="spend"
                topN={8}
                loading={campaigns.isLoading}
              />
            </div>

            {/* Table */}
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-sm font-medium">All Campaigns</p>
                <SearchInput
                  value={search}
                  onChange={(v) => { setSearch(v); setPage(1); }}
                  placeholder="Search campaigns…"
                  className="w-64"
                />
                {campaigns.isFetching && (
                  <RefreshCw className="size-3.5 animate-spin text-muted-foreground" />
                )}
              </div>
              <DataTable
                rows={campRows}
                sortBy={sortBy}
                sortDir={sortDir}
                onSort={handleSort}
                loading={campaigns.isLoading}
              />
              <Pagination
                page={page}
                pages={campPages}
                total={campTotal}
                limit={10}
                onPage={setPage}
              />
            </div>
          </motion.div>
        )}

        {/* ── BUILDER TAB ───────────────────────────────────────────── */}
        {activeTab === "builder" && (
          <motion.div
            key="builder"
            variants={fadeVariants}
            initial="initial"
            animate="animate"
            exit="exit"
          >
            <ReportBuilder onSaved={() => setActiveTab("saved")} />
          </motion.div>
        )}

        {/* ── SAVED TAB ─────────────────────────────────────────────── */}
        {activeTab === "saved" && (
          <motion.div
            key="saved"
            variants={fadeVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className="space-y-4"
          >
            {savedReports.isLoading && (
              <div className="flex h-40 items-center justify-center text-sm text-muted-foreground gap-2">
                <RefreshCw className="size-4 animate-spin" />
                Loading saved reports…
              </div>
            )}

            {!savedReports.isLoading && !savedReports.data?.length && (
              <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed py-16 text-center">
                <BookmarkCheck className="size-8 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">No saved reports yet.</p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setActiveTab("builder")}
                >
                  Build your first report
                </Button>
              </div>
            )}

            {savedReports.data?.length ? (
              <motion.div
                variants={listVariants}
                initial="initial"
                animate="animate"
                className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
              >
                {savedReports.data.map((r) => (
                  <SavedReportCard
                    key={r._id}
                    report={r}
                    onDelete={(id) => deleteReport.mutate(id)}
                  />
                ))}
              </motion.div>
            ) : null}
          </motion.div>
        )}

        {/* ── BLEND TAB ─────────────────────────────────────────────── */}
        {activeTab === "blend" && (
          <motion.div
            key="blend"
            variants={fadeVariants}
            initial="initial"
            animate="animate"
            exit="exit"
          >
            <BlendBuilder />
          </motion.div>
        )}

        {/* ── ATTRIBUTION TAB ───────────────────────────────────────── */}
        {activeTab === "attribution" && (
          <motion.div
            key="attribution"
            variants={fadeVariants}
            initial="initial"
            animate="animate"
            exit="exit"
          >
            <AttributionReport />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

