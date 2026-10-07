/** Ad Reports — Meta "Performance overview" numbers entered daily by the team. */

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

export interface AdReport {
  id: string;
  name: string;
  platform: "meta";
  team_id: string;
  team_name: string;
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
  /** Leads for the last 14 days, null = not reported. */
  sparkline: (number | null)[];
  created_by: string;
  created_by_name: string;
  created_at: string;
  updated_at: string;
  can_manage?: boolean;
  can_enter?: boolean;
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

export interface AdSeries {
  range: { from: string; to: string };
  granularity: AdGranularity;
  metrics: AdMetric[];
  totals: AdTotals;
  previous: AdTotals | null;
  reported_days: number;
  points: AdSeriesPoint[];
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
  name: string;
  team_id: string;
  assignees: string[];
  start_date: string;
  end_date?: string | null;
  extra_metrics: AdExtraMetric[];
  reminder_due: string;
  reminder_escalate: string;
}

export interface UpdateAdReportPayload {
  action?: "pause" | "resume" | "end";
  name?: string;
  assignees?: string[];
  end_date?: string;
  clear_end_date?: boolean;
  extra_metrics?: AdExtraMetric[];
  reminder_due?: string;
  reminder_escalate?: string;
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
