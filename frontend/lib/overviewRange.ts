/**
 * Overview date range — "tasks created in this period".
 *
 * Maps a friendly preset to the filters GET /projects already understands
 * (the same ones the Projects page uses): today / this_week / this_month /
 * this_year are server presets; the rest become an IST custom from–to range.
 * "all" sends nothing, so the default request is exactly what it was before.
 */
import type { DateFilterOption } from "@/types/project";

export type RangeKey =
  | "all" | "today" | "yesterday" | "last7" | "this_week" | "this_month" | "last_month" | "this_year" | "custom";

export interface OverviewRange {
  key: RangeKey;
  from?: string;   // YYYY-MM-DD (IST) — custom only
  to?: string;
}

export const RANGE_PRESETS: { key: Exclude<RangeKey, "custom">; label: string }[] = [
  { key: "all", label: "All time" },
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "last7", label: "Last 7 days" },
  { key: "this_week", label: "This week" },
  { key: "this_month", label: "This month" },
  { key: "last_month", label: "Last month" },
  { key: "this_year", label: "This year" },
];

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar day as YYYY-MM-DD — rejects 2026-02-31, 2026-13-01, 0000-00-00. */
export function isRealDay(v: string): boolean {
  if (!ISO.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v && v >= "2000-01-01";
}

export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function lastMonth(todayISO: string): { from: string; to: string } {
  const first = `${todayISO.slice(0, 7)}-01`;
  const to = addDays(first, -1);
  return { from: `${to.slice(0, 7)}-01`, to };
}

/** The filters for GET /projects. Empty object = all time (unchanged request). */
export function rangeToFilters(r: OverviewRange, todayISO: string): { date_filter?: DateFilterOption; date_from?: string; date_to?: string } {
  switch (r.key) {
    case "today": case "this_week": case "this_month": case "this_year":
      return { date_filter: r.key as DateFilterOption };
    case "yesterday": { const y = addDays(todayISO, -1); return { date_filter: "custom", date_from: y, date_to: y }; }
    case "last7": return { date_filter: "custom", date_from: addDays(todayISO, -6), date_to: todayISO };
    case "last_month": { const m = lastMonth(todayISO); return { date_filter: "custom", date_from: m.from, date_to: m.to }; }
    case "custom": return r.from && r.to ? { date_filter: "custom", date_from: r.from, date_to: r.to } : {};
    default: return {};
  }
}

const DAY = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
const DAY_Y = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const fmt = (iso: string, withYear: boolean) =>
  isRealDay(iso) ? (withYear ? DAY_Y : DAY).format(new Date(`${iso}T00:00:00Z`)) : iso;

/** Button label: "All time", "This month", "1 Oct – 8 Oct". */
export function rangeLabel(r: OverviewRange, todayISO: string): string {
  if (r.key !== "custom") return RANGE_PRESETS.find((p) => p.key === r.key)?.label ?? "All time";
  if (!r.from || !r.to) return "All time";
  const year = todayISO.slice(0, 4);
  const withYear = r.from.slice(0, 4) !== year || r.to.slice(0, 4) !== year;
  return r.from === r.to ? fmt(r.from, withYear) : `${fmt(r.from, withYear)} – ${fmt(r.to, withYear)}`;
}

/** Sentence form for the subtitle: "created this month", "created 1 Oct – 8 Oct". */
export function rangePhrase(r: OverviewRange, todayISO: string): string {
  const map: Partial<Record<RangeKey, string>> = {
    today: "today", yesterday: "yesterday", last7: "in the last 7 days", this_week: "this week",
    this_month: "this month", last_month: "last month", this_year: "this year",
  };
  if (r.key === "custom") {
    if (!r.from || !r.to) return "";
    return r.from === r.to ? `on ${rangeLabel(r, todayISO)}` : `between ${rangeLabel(r, todayISO).replace(" – ", " and ")}`;
  }
  return map[r.key] ?? "";
}

// ── URL (?range=this_month | ?from=…&to=…), next to ?member= ────────────────

/**
 * Parse ?range= / ?from=&to=. Anything a hand-edited or stale link can carry is
 * checked here, because a date the server can't parse would silently drop the
 * filter and show all-time numbers under a date heading. Same rules as the
 * picker: real days, From ≤ To, nothing after today (a later To is clamped).
 */
export function parseRange(search: string, todayISO: string): OverviewRange {
  const q = new URLSearchParams(search);
  const from = q.get("from") ?? "";
  let to = q.get("to") ?? "";
  if (isRealDay(from) && isRealDay(to) && from <= todayISO) {
    if (to > todayISO) to = todayISO;
    if (from <= to) return { key: "custom", from, to };
  }
  const key = q.get("range");
  const preset = RANGE_PRESETS.find((p) => p.key === key);
  return preset ? { key: preset.key } : { key: "all" };
}

export function readRangeParams(todayISO: string): OverviewRange {
  if (typeof window === "undefined") return { key: "all" };
  return parseRange(window.location.search, todayISO);
}

export const sameRange = (a: OverviewRange, b: OverviewRange) =>
  a.key === b.key && (a.from ?? "") === (b.from ?? "") && (a.to ?? "") === (b.to ?? "");

/** True when the URL already says exactly `r` (so a rewrite would change nothing). */
export function urlMatchesRange(search: string, r: OverviewRange): boolean {
  const q = new URLSearchParams(search);
  const want = r.key === "custom" ? { range: null, from: r.from ?? null, to: r.to ?? null }
    : { range: r.key === "all" ? null : r.key, from: null, to: null };
  return q.get("range") === want.range && q.get("from") === want.from && q.get("to") === want.to;
}

export function writeRangeParams(r: OverviewRange) {
  // replaceState, like the member filter: a filter is not a page, so Back leaves the Overview.
  const url = new URL(window.location.href);
  for (const k of ["range", "from", "to"]) url.searchParams.delete(k);
  if (r.key === "custom" && r.from && r.to) { url.searchParams.set("from", r.from); url.searchParams.set("to", r.to); }
  else if (r.key !== "all" && r.key !== "custom") url.searchParams.set("range", r.key);
  window.history.replaceState(null, "", url.pathname + url.search + url.hash);
}
