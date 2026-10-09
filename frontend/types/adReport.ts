/** Ad Reports — Meta "Performance overview" numbers entered daily by the team. */

import type { AdFlagSummary } from "@/types/adFlag";

export type AdExtraMetric = "impressions" | "reach" | "clicks";
export type AdMetric = "leads" | "spend" | AdExtraMetric;
export type AdComputedMetric = "cpl" | "ctr" | "cpm" | "cpc";
export type AdDayStatus = "updated" | "due" | "missing" | "paused" | "ended" | "not_started";
export type AdReportStatus = "active" | "paused" | "ended";
export type AdGranularity = "day" | "week" | "month";

/** Raw values. `spend` is integer paise. */
export type AdValues = Partial<Record<AdMetric, number>>;
/** Summed values + computed metrics (cpl/cpm/cpc in paise, ctr in percent); null = undefined. */
export type AdTotals = Partial<Record<AdMetric | AdComputedMetric, number | null>>;

/** An uploaded ad (image / video / PDF). `url` is a short-lived signed link. */
export interface AdCreative {
  id: string;
  url: string;
  key: string;
  filename: string;
  content_type: string;
  size: number;
  uploaded_by: string;
  uploaded_by_name: string;
  uploaded_at: string;
}

export type AdReportKind = "ad" | "account";

/** Present on accounts: a summary of the ads inside. */
export interface AdAccountSummary {
  ads: number;
  active_ads: number;
  missing_ads: number;
  rollup_status: AdDayStatus;
  metrics: AdMetric[];
  start: string;
}

export interface AdReport {
  id: string;
  /** "account" = a Meta ad account; its numbers are its ads added up. */
  kind: AdReportKind;
  /** Ads: the account it belongs to (shares a team with it), if any. */
  account_id: string | null;
  account_name: string;
  /** Accounts: e.g. "act_1234567890". */
  ad_account_ref: string;
  account: AdAccountSummary | null;
  name: string;
  platform: "meta";
  /** The main team (= team_ids[0]). */
  team_id: string;
  team_name: string;
  /** Every team on it, main team first. Leaders of any of them manage it. */
  team_ids: string[];
  teams: { id: string; name: string }[];
  /** Owner first. Ads: they enter the numbers and get reminders.
   *  Accounts (optional): they see and can update every ad inside it. */
  assignees: { id: string; name: string }[];
  start_date: string;
  end_date: string | null;
  metrics: AdMetric[];
  extra_metrics: AdExtraMetric[];
  currency: string;
  reminder_due: string;
  reminder_escalate: string;
  status: AdReportStatus;
  day_status: AdDayStatus;
  /** Owed days (up to yesterday) with no numbers yet, oldest first. */
  missing: string[];
  /** The ad itself; the first one is the cover shown on cards and the header. */
  creatives: AdCreative[];
  /** Leads for the last 14 days, null = not reported. */
  sparkline: (number | null)[];
  created_by: string;
  created_by_name: string;
  created_at: string;
  updated_at: string;
  can_manage?: boolean;
  can_enter?: boolean;
  /** Ads: an open "Ad not performing" flag, else one closed in the last 14 days. */
  flag?: AdFlagSummary | null;
}

export interface AdEntry {
  date: string;
  values: AdValues;
  campaign_off: boolean;
  note: string;
  entered_by: string;
  entered_by_name: string;
  entered_at: string;
  updated_at: string;
  edits: { by: string; by_name: string; at: string; old: AdValues; new: AdValues }[];
}

export interface AdSeriesPoint {
  key: string;
  from: string;
  to: string;
  values: AdTotals | null;
  reported_days: number;
  missing: string[];
  edited: string[];
  off: string[];
}

/** One ad inside an account, totalled for the chosen range. */
export interface AdBreakdownRow {
  id: string;
  name: string;
  status: AdReportStatus;
  day_status: AdDayStatus;
  missing: string[];
  owners: string[];
  totals: AdTotals;
  cover: AdCreative | null;
}

export interface AdSeries {
  range: { from: string; to: string };
  granularity: AdGranularity;
  metrics: AdMetric[];
  totals: AdTotals;
  previous: AdTotals | null;
  reported_days: number;
  points: AdSeriesPoint[];
  /** Accounts only. */
  breakdown?: AdBreakdownRow[];
}

export interface AdToday {
  visible: boolean;
  can_create: boolean;
  my_due: { id: string; name: string; missing: string[] }[];
  my_due_count: number;
  team: null | {
    active: number;
    updated: number;
    missing: { id: string; name: string; owners: string[]; missing_count: number; oldest: string }[];
  };
}

export interface CreateAdReportPayload {
  kind?: AdReportKind;
  name: string;
  /** Main team first. */
  team_ids: string[];
  assignees?: string[];
  start_date?: string;
  account_id?: string | null;
  ad_account_ref?: string;
  end_date?: string | null;
  extra_metrics?: AdExtraMetric[];
  reminder_due?: string;
  reminder_escalate?: string;
}

export interface UpdateAdReportPayload {
  action?: "pause" | "resume" | "end";
  name?: string;
  account_id?: string;
  clear_account?: boolean;
  ad_account_ref?: string;
  team_ids?: string[];
  assignees?: string[];
  end_date?: string;
  clear_end_date?: boolean;
  extra_metrics?: AdExtraMetric[];
  reminder_due?: string;
  reminder_escalate?: string;
}

/** DELETE /ad-reports/{id} — undo with the batch id. */
export interface AdDeleteResult {
  batch: string;
  name: string;
  kind: AdReportKind;
  reports: number;
  entries: number;
  detached: number;
}

export interface AdEntryPayload {
  leads?: number | null;
  spend?: string | null;
  impressions?: number | null;
  reach?: number | null;
  clicks?: number | null;
  campaign_off: boolean;
  note: string;
}
