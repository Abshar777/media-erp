/**
 * Ad Reports helpers — Indian-format money and counts, metric labels, and the
 * small date maths the page needs. Money arrives as integer paise.
 */
import type { AdComputedMetric, AdMetric, AdTotals } from "@/types/adReport";

const INR = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const INR0 = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const COUNT = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const PCT = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });

/** 1620032 → "₹16,200.32"; 16200300000 → "₹16,20,03,000.00" (Indian grouping). */
export function formatINR(paise: number | null | undefined, opts: { whole?: boolean } = {}): string {
  if (paise == null || !Number.isFinite(paise)) return "—";
  return (opts.whole ? INR0 : INR).format(paise / 100);
}

export function formatCount(n: number | null | undefined): string {
  return n == null || !Number.isFinite(n) ? "—" : COUNT.format(n);
}

/** Compact axis label: 1,500 → "1.5K", 2,50,000 → "2.5L", 1,20,00,000 → "1.2Cr". */
export function compactIN(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e7) return `${+(n / 1e7).toFixed(1)}Cr`;
  if (a >= 1e5) return `${+(n / 1e5).toFixed(1)}L`;
  if (a >= 1e3) return `${+(n / 1e3).toFixed(1)}K`;
  return `${+n.toFixed(1)}`;
}

export type TileMetric = AdMetric | AdComputedMetric;

export const METRIC_META: Record<TileMetric, { label: string; hint: string; money?: boolean; pct?: boolean; lowerIsBetter?: boolean }> = {
  leads:       { label: "Leads (Form)",  hint: "Leads collected through instant forms, as shown in Ads Manager." },
  spend:       { label: "Amount spent",  hint: "Total spent on this campaign, as shown in Ads Manager.", money: true, lowerIsBetter: true },
  impressions: { label: "Impressions",   hint: "Times the ads were on screen." },
  reach:       { label: "Reach",         hint: "People who saw the ads at least once." },
  clicks:      { label: "Link clicks",   hint: "Clicks on links in the ads." },
  cpl:         { label: "Per lead (form)", hint: "Amount spent ÷ leads — calculated, never typed.", money: true, lowerIsBetter: true },
  ctr:         { label: "CTR",           hint: "Link clicks ÷ impressions — calculated.", pct: true },
  cpm:         { label: "CPM",           hint: "Cost per 1,000 impressions — calculated.", money: true, lowerIsBetter: true },
  cpc:         { label: "CPC",           hint: "Cost per link click — calculated.", money: true, lowerIsBetter: true },
};

/** Tiles in Meta's order: Leads, Per lead, Amount spent, then any extras. */
export function tilesFor(metrics: AdMetric[]): TileMetric[] {
  const t: TileMetric[] = ["leads", "cpl", "spend"];
  if (metrics.includes("impressions")) t.push("impressions");
  if (metrics.includes("reach")) t.push("reach");
  if (metrics.includes("clicks")) t.push("clicks");
  if (metrics.includes("clicks") && metrics.includes("impressions")) t.push("ctr");
  if (metrics.includes("impressions")) t.push("cpm");
  if (metrics.includes("clicks")) t.push("cpc");
  return t;
}

export function formatMetric(m: TileMetric, v: number | null | undefined): string {
  const meta = METRIC_META[m];
  if (v == null) return "—";
  if (meta.money) return formatINR(v);
  if (meta.pct) return `${PCT.format(v)}%`;
  return formatCount(v);
}

/** % change vs the previous period; null when there's nothing to compare. */
export function changePct(t: AdTotals, prev: AdTotals | null, m: TileMetric): number | null {
  const a = t[m], b = prev?.[m];
  if (a == null || b == null || b === 0) return null;
  return ((a - b) / b) * 100;
}

// ── Dates (IST calendar days as YYYY-MM-DD) ─────────────────────────────────

export function addDaysISO(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const DAY_FMT = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
const DAY_W_FMT = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const MONTH_FMT = new Intl.DateTimeFormat("en-IN", { month: "short", year: "numeric", timeZone: "UTC" });

export const dayLabel = (iso: string) => DAY_FMT.format(new Date(`${iso}T00:00:00Z`));
export const dayLabelW = (iso: string) => DAY_W_FMT.format(new Date(`${iso}T00:00:00Z`));
export const monthLabel = (iso: string) => MONTH_FMT.format(new Date(`${iso.slice(0, 7)}-01T00:00:00Z`));

export function missingPhrase(missing: string[]): string {
  const shown = missing.slice(0, 3).map(dayLabel).join(", ");
  return missing.length > 3 ? `${shown} +${missing.length - 3} more` : shown;
}

/** Strip grouping commas a person may type ("2,732.52"); returns "" for blank. */
export function cleanMoney(s: string): string {
  return s.replace(/[,\s₹]/g, "");
}
