"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowDown, ArrowUp, ArrowUpDown, Download, FileSpreadsheet,
  FileText, Loader2, PauseCircle, PlayCircle, RefreshCw, Wallet, X,
} from "lucide-react";
import { toast } from "sonner";

import PageHeader from "@/components/shared/PageHeader";
import { SearchInput } from "@/components/shared/SearchInput";
import { DateRangePicker } from "@/components/shared/DateRangePicker";
import { Pagination } from "@/components/reports/Pagination";
import { Button } from "@/components/ui/button";
import { SelectField } from "@/components/ui/select-field";
import { useCampaigns, useExportCsv } from "@/hooks/useReports";
import { usePauseCampaign, useResumeCampaign, useUpdateCampaignBudget, useWriteConnectors } from "@/hooks/useCampaignWrite";
import { useCreateBudgetGoal } from "@/hooks/useBudget";
import { useExport } from "@/hooks/useExport";
import { fadeVariants } from "@/lib/animations";
import type { CampaignRow } from "@/types/report";

// ── Platform filter options ───────────────────────────────────────────────────
const PLATFORMS = [
  { value: "",             label: "All platforms"  },
  { value: "google_ads",   label: "Google Ads"     },
  { value: "facebook_ads", label: "Facebook Ads"   },
  { value: "linkedin_ads", label: "LinkedIn Ads"   },
  { value: "ga4",          label: "GA4"            },
  { value: "tiktok_ads",   label: "TikTok Ads"     },
];

function today()      { return new Date().toISOString().slice(0, 10); }
function daysAgo(n: number) {
  const d = new Date(); d.setDate(d.getDate() - n + 1);
  return d.toISOString().slice(0, 10);
}

// ── Metric formatter ──────────────────────────────────────────────────────────
function fmt(key: string, val: number): string {
  if (key === "spend" || key === "revenue")
    return `$${val.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  if (key === "ctr") return `${val.toFixed(2)}%`;
  if (key === "cpc") return `$${val.toFixed(2)}`;
  if (key === "roas") return `${val.toFixed(2)}×`;
  if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(1)}M`;
  if (val >= 1_000)     return `${(val / 1_000).toFixed(1)}K`;
  return val.toLocaleString();
}

// ── Budget Goal Modal ─────────────────────────────────────────────────────────
interface BudgetModalProps {
  campaign: CampaignRow;
  onClose: () => void;
}
function BudgetModal({ campaign, onClose }: BudgetModalProps) {
  const { data: writeConnectors = [] } = useWriteConnectors();
  const createGoal = useCreateBudgetGoal();
  const updateBudget = useUpdateCampaignBudget();

  const [budget, setBudget]         = useState("");
  const [threshold, setThreshold]   = useState("80");
  const [connectorId, setConnectorId] = useState(writeConnectors[0]?.id ?? "");
  const [tab, setTab]               = useState<"goal"|"live">("goal");

  const fbConnectors = writeConnectors.filter(c => c.platform === "facebook_ads");

  function handleSaveGoal() {
    const val = parseFloat(budget);
    if (!val || val <= 0) { toast.error("Enter a valid budget"); return; }
    createGoal.mutate({
      campaign_id: campaign.campaign_id,
      campaign_name: campaign.campaign_name,
      platform: campaign.platform,
      connector_id: connectorId || fbConnectors[0]?.id || "",
      total_budget: val,
      alert_threshold_pct: parseInt(threshold) || 80,
      period: "monthly",
    }, { onSuccess: onClose });
  }

  function handleLiveBudget() {
    const val = parseFloat(budget);
    if (!val || val <= 0) { toast.error("Enter a valid budget"); return; }
    if (!connectorId) { toast.error("Select a connector"); return; }
    updateBudget.mutate({
      campaignId: campaign.campaign_id,
      connectorId,
      dailyBudget: val,
    }, { onSuccess: onClose });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 8 }}
        className="relative w-full max-w-md rounded-2xl border bg-card p-6 shadow-2xl"
      >
        <button
          onClick={onClose}
          className="absolute right-4 top-4 rounded-lg p-1.5 text-muted-foreground hover:bg-muted transition-colors"
        >
          <X className="size-4" />
        </button>

        <div className="mb-1 flex items-center gap-2">
          <Wallet className="size-5 text-primary" />
          <h2 className="text-base font-semibold">Budget Settings</h2>
        </div>
        <p className="mb-4 text-xs text-muted-foreground truncate">{campaign.campaign_name}</p>

        {/* Tab switcher */}
        <div className="mb-4 flex gap-1 rounded-lg bg-muted p-1">
          {(["goal", "live"] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 rounded-md py-1.5 text-xs font-medium transition-colors ${
                tab === t ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"
              }`}
            >
              {t === "goal" ? "Track Budget" : "Update Live Budget"}
            </button>
          ))}
        </div>

        {tab === "goal" ? (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">Set a monthly budget goal to track pacing and receive alerts.</p>
            <div>
              <label className="mb-1 block text-xs font-medium">Monthly Budget (USD)</label>
              <input
                type="number" min="0" step="0.01" value={budget}
                onChange={e => setBudget(e.target.value)}
                className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/30"
                placeholder="500.00"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Alert at (% of budget)</label>
              <input
                type="number" min="1" max="100" value={threshold}
                onChange={e => setThreshold(e.target.value)}
                className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/30"
              />
            </div>
            <Button className="w-full" onClick={handleSaveGoal} disabled={createGoal.isPending}>
              {createGoal.isPending ? "Saving…" : "Save Budget Goal"}
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {campaign.platform !== "facebook_ads" ? (
              <p className="rounded-lg bg-amber-500/10 p-3 text-xs text-amber-600">
                Live budget updates are only supported for Facebook Ads campaigns.
              </p>
            ) : fbConnectors.length === 0 ? (
              <p className="rounded-lg bg-amber-500/10 p-3 text-xs text-amber-600">
                No Facebook Ads connector with write access found. Add one in Connectors.
              </p>
            ) : (
              <>
                <p className="text-xs text-muted-foreground">Update the campaign daily budget directly in Facebook Ads.</p>
                {fbConnectors.length > 1 && (
                  <div>
                    <label htmlFor="budget-connector" className="mb-1 block text-xs font-medium">Connector</label>
                    <SelectField
                      id="budget-connector"
                      value={connectorId} onValueChange={v => setConnectorId(v)}
                      options={fbConnectors.map(c => ({ value: c.id, label: c.name }))}
                    />
                  </div>
                )}
                <div>
                  <label className="mb-1 block text-xs font-medium">New Daily Budget (USD)</label>
                  <input
                    type="number" min="0" step="0.01" value={budget}
                    onChange={e => setBudget(e.target.value)}
                    className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/30"
                    placeholder="50.00"
                  />
                </div>
                <Button className="w-full" onClick={handleLiveBudget} disabled={updateBudget.isPending}>
                  {updateBudget.isPending ? "Updating…" : "Update Facebook Budget"}
                </Button>
              </>
            )}
          </div>
        )}
      </motion.div>
    </div>
  );
}

// ── Campaign Table ────────────────────────────────────────────────────────────
const COLS = [
  { key: "campaign_name", label: "Campaign",  sortable: true,  align: "left"  },
  { key: "platform",      label: "Platform",  sortable: true,  align: "left"  },
  { key: "spend",         label: "Spend",     sortable: true,  align: "right" },
  { key: "impressions",   label: "Impr.",     sortable: true,  align: "right" },
  { key: "clicks",        label: "Clicks",    sortable: true,  align: "right" },
  { key: "ctr",           label: "CTR",       sortable: true,  align: "right" },
  { key: "cpc",           label: "CPC",       sortable: true,  align: "right" },
  { key: "conversions",   label: "Conv.",     sortable: true,  align: "right" },
  { key: "revenue",       label: "Revenue",   sortable: true,  align: "right" },
  { key: "roas",          label: "ROAS",      sortable: true,  align: "right" },
  { key: "actions",       label: "Actions",   sortable: false, align: "right" },
];

interface TableProps {
  rows: CampaignRow[];
  loading: boolean;
  sortBy: string;
  sortDir: "asc"|"desc";
  onSort: (col: string) => void;
  onBudget: (row: CampaignRow) => void;
}

function CampaignTable({ rows, loading, sortBy, sortDir, onSort, onBudget }: TableProps) {
  const pause  = usePauseCampaign();
  const resume = useResumeCampaign();
  const [pendingId, setPendingId] = useState<string|null>(null);

  function SortIcon({ col }: { col: string }) {
    if (col !== sortBy) return <ArrowUpDown className="ml-1 inline size-3 opacity-30" />;
    return sortDir === "asc"
      ? <ArrowUp className="ml-1 inline size-3 text-primary" />
      : <ArrowDown className="ml-1 inline size-3 text-primary" />;
  }

  function handlePause(row: CampaignRow) {
    if (row.platform !== "facebook_ads") { toast.error("Pause/resume only works for Facebook Ads"); return; }
    setPendingId(row.campaign_id);
    pause.mutate(row.campaign_id, { onSettled: () => setPendingId(null) });
  }
  function handleResume(row: CampaignRow) {
    if (row.platform !== "facebook_ads") { toast.error("Pause/resume only works for Facebook Ads"); return; }
    setPendingId(row.campaign_id);
    resume.mutate(row.campaign_id, { onSettled: () => setPendingId(null) });
  }

  return (
    <div className="w-full overflow-x-auto rounded-xl border bg-card">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/30">
            {COLS.map(col => (
              <th
                key={col.key}
                onClick={() => col.sortable && col.key !== "actions" && onSort(col.key)}
                className={`select-none whitespace-nowrap px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground transition-colors ${
                  col.sortable && col.key !== "actions" ? "cursor-pointer hover:text-foreground" : ""
                } ${col.align === "right" ? "text-right" : "text-left"}`}
              >
                {col.label}
                {col.sortable && col.key !== "actions" && <SortIcon col={col.key} />}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            Array.from({ length: 6 }).map((_, i) => (
              <tr key={i}>
                {COLS.map(c => (
                  <td key={c.key} className="px-4 py-3">
                    <div className="h-3.5 animate-pulse rounded-md bg-muted" style={{ width: c.key === "campaign_name" ? "75%" : "55%" }} />
                  </td>
                ))}
              </tr>
            ))
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={COLS.length} className="py-14 text-center text-sm text-muted-foreground">
                No campaigns found — sync a connector to see data
              </td>
            </tr>
          ) : (
            <AnimatePresence mode="wait">
              {rows.map((row, i) => (
                <motion.tr
                  key={`${row.campaign_id}-${i}`}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="border-b last:border-0 hover:bg-muted/30 transition-colors"
                >
                  <td className="max-w-[200px] truncate px-4 py-3 font-medium" title={row.campaign_name}>
                    {row.campaign_name}
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs font-medium capitalize">
                      {row.platform.replace(/_/g, " ")}
                    </span>
                  </td>
                  {(["spend","impressions","clicks","ctr","cpc","conversions","revenue","roas"] as const).map(k => (
                    <td key={k} className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                      {fmt(k, row[k])}
                    </td>
                  ))}
                  {/* Actions */}
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1.5">
                      {/* Pause / Resume — only for facebook_ads */}
                      {row.platform === "facebook_ads" && (
                        <>
                          <motion.button
                            whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}
                            onClick={() => handlePause(row)}
                            disabled={pendingId === row.campaign_id}
                            title="Pause campaign"
                            className="rounded-md p-1.5 text-amber-500 hover:bg-amber-500/10 disabled:opacity-40 transition-colors"
                          >
                            {pendingId === row.campaign_id
                              ? <RefreshCw className="size-3.5 animate-spin" />
                              : <PauseCircle className="size-3.5" />}
                          </motion.button>
                          <motion.button
                            whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}
                            onClick={() => handleResume(row)}
                            disabled={pendingId === row.campaign_id}
                            title="Resume campaign"
                            className="rounded-md p-1.5 text-emerald-500 hover:bg-emerald-500/10 disabled:opacity-40 transition-colors"
                          >
                            <PlayCircle className="size-3.5" />
                          </motion.button>
                        </>
                      )}
                      {/* Budget */}
                      <motion.button
                        whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}
                        onClick={() => onBudget(row)}
                        title="Set budget"
                        className="rounded-md p-1.5 text-blue-500 hover:bg-blue-500/10 transition-colors"
                      >
                        <Wallet className="size-3.5" />
                      </motion.button>
                    </div>
                  </td>
                </motion.tr>
              ))}
            </AnimatePresence>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function CampaignsPage() {
  const [search,   setSearch]   = useState("");
  const [platform, setPlatform] = useState("");
  const [dateFrom, setDateFrom] = useState(daysAgo(30));
  const [dateTo,   setDateTo]   = useState(today());

  const [page,    setPage]    = useState(1);
  const [limit,   setLimit]   = useState(20);
  const [sortBy,  setSortBy]  = useState("spend");
  const [sortDir, setSortDir] = useState<"asc"|"desc">("desc");

  const [budgetRow, setBudgetRow] = useState<CampaignRow|null>(null);

  const campaigns = useCampaigns({
    page, limit,
    search:    search   || undefined,
    platform:  platform || undefined,
    sort_by:   sortBy,
    sort_dir:  sortDir,
    date_from: dateFrom || undefined,
    date_to:   dateTo   || undefined,
  });

  const exportCsv = useExportCsv();
  const { exportExcel, exportPdf } = useExport();
  const [exporting, setExporting] = useState<"excel"|"pdf"|null>(null);

  async function handleExcel() {
    setExporting("excel");
    try { await exportExcel({ platform: platform || undefined, date_from: dateFrom, date_to: dateTo }); }
    catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Export failed"); }
    finally { setExporting(null); }
  }
  async function handlePdf() {
    setExporting("pdf");
    try { await exportPdf({ platform: platform || undefined, date_from: dateFrom, date_to: dateTo }); }
    catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Export failed"); }
    finally { setExporting(null); }
  }

  const rows  = campaigns.data?.campaigns ?? [];
  const total = campaigns.data?.total ?? 0;
  const pages = campaigns.data?.pages ?? 0;

  function handleSort(col: string) {
    if (col === sortBy) setSortDir(d => d === "desc" ? "asc" : "desc");
    else { setSortBy(col); setSortDir("desc"); }
    setPage(1);
  }

  return (
    <motion.div variants={fadeVariants} initial="initial" animate="animate" className="space-y-5">
      <PageHeader
        title="Campaigns"
        subtitle={`${total.toLocaleString()} campaigns across all platforms`}
        action={
          <div className="flex items-center gap-2">
            <Button
              size="sm" variant="outline"
              onClick={() => exportCsv.mutate({
                metrics: ["spend","clicks","impressions","ctr","cpc","conversions","revenue","roas"],
                dimensions: ["campaign","platform"],
                platform: platform || null, dateFrom, dateTo,
              })}
              disabled={exportCsv.isPending}
            >
              {exportCsv.isPending ? <Loader2 className="mr-1.5 size-3 animate-spin" /> : <Download className="mr-1.5 size-3" />}
              CSV
            </Button>
            <Button size="sm" variant="outline" onClick={handleExcel} disabled={exporting === "excel"}>
              {exporting === "excel" ? <Loader2 className="mr-1.5 size-3 animate-spin" /> : <FileSpreadsheet className="mr-1.5 size-3" />}
              Excel
            </Button>
            <Button size="sm" variant="outline" onClick={handlePdf} disabled={exporting === "pdf"}>
              {exporting === "pdf" ? <Loader2 className="mr-1.5 size-3 animate-spin" /> : <FileText className="mr-1.5 size-3" />}
              PDF
            </Button>
          </div>
        }
      />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <SearchInput value={search} onChange={v => { setSearch(v); setPage(1); }} placeholder="Search campaigns…" className="w-56" />
        <SelectField
          aria-label="Platform"
          size="sm"
          value={platform} onValueChange={v => { setPlatform(v); setPage(1); }}
          options={PLATFORMS}
          className="w-auto min-w-[9rem]"
        />
        <SelectField<number>
          aria-label="Rows per page"
          size="sm"
          value={limit} onValueChange={v => { setLimit(v); setPage(1); }}
          options={[10,20,50,100].map(n => ({ value: n, label: `${n} / page` }))}
          className="w-auto min-w-[7rem]"
        />
        {campaigns.isFetching && <RefreshCw className="size-3.5 animate-spin text-muted-foreground" />}
        <div className="ml-auto">
          <DateRangePicker
            dateFrom={dateFrom} dateTo={dateTo}
            onFromChange={v => { setDateFrom(v); setPage(1); }}
            onToChange={v   => { setDateTo(v);   setPage(1); }}
          />
        </div>
      </div>

      {/* Helper note for actions */}
      <p className="text-xs text-muted-foreground">
        ⏸ Pause / ▶ Resume buttons work for <strong>Facebook Ads</strong> campaigns.{" "}
        💰 Budget icon sets tracking goals (all platforms) or live budget (Facebook Ads).
      </p>

      <CampaignTable
        rows={rows} loading={campaigns.isLoading}
        sortBy={sortBy} sortDir={sortDir}
        onSort={handleSort}
        onBudget={row => setBudgetRow(row)}
      />

      <Pagination page={page} pages={pages} total={total} limit={limit} onPage={setPage} />

      <AnimatePresence>
        {budgetRow && <BudgetModal campaign={budgetRow} onClose={() => setBudgetRow(null)} />}
      </AnimatePresence>
    </motion.div>
  );
}
