/**
 * "Ad not performing" — an ad sent to a team leader (usually the media team's)
 * to recreate. Backend: routers/ad_flags.py, services/ad_flag_service.py.
 */
import type { AdCreative, AdMetric, AdTotals } from "@/types/adReport";

export type AdFlagStatus = "open" | "in_progress" | "done" | "declined" | "withdrawn";
export type AdFlagAction = "start" | "done" | "decline" | "withdraw";

/** The numbers as they were when the ad was flagged: last 7 complete days vs the 7 before. */
export interface AdFlagSnapshot {
  range: { from: string; to: string };
  metrics: AdMetric[];
  currency: string;
  totals: AdTotals;
  previous: AdTotals | null;
  reported_days: number;
  /** Leads for the last 14 days, null = not reported. */
  sparkline: (number | null)[];
}

export interface AdFlag {
  id: string;
  report_id: string;
  report_name: string;
  account_name: string;
  team_name: string;
  status: AdFlagStatus;
  status_label: string;
  active: boolean;
  reasons: { key: string; label: string }[];
  note: string;
  recipient: { id: string; name: string; team_name: string };
  flagged_by: { id: string; name: string };
  resolution_note: string;
  snapshot: AdFlagSnapshot | null;
  /** The ad as it is now — what the media team works from. */
  creatives: AdCreative[];
  history: { action: string; label: string; by_name: string; at: string; note: string }[];
  created_at: string;
  updated_at: string;
  can_act: boolean;
  can_withdraw: boolean;
  can_open_report: boolean;
}

/** On each ad in the report list: its open flag, else one closed in the last 14 days. */
export interface AdFlagSummary {
  id: string;
  status: AdFlagStatus;
  status_label: string;
  active: boolean;
  recipient_name: string;
  recipient_team_name: string;
  flagged_by: string;
  flagged_by_name: string;
  created_at: string;
  updated_at: string;
  resolution_note: string;
}

export interface AdFlagRecipientTeam {
  team_id: string;
  team_name: string;
  color: string;
  /** `email` is set only when two leaders share a name, to tell them apart. */
  leaders: { id: string; name: string; email: string }[];
}

export interface AdFlagDraft {
  recipients: AdFlagRecipientTeam[];
  default: { recipient_id: string; team_id: string } | null;
  reasons: { key: string; label: string }[];
  snapshot: AdFlagSnapshot;
  active_flag: AdFlag | null;
}

/** to_me = sent to me to recreate · sent = what I sent · all = everything (admin roles). */
export type AdFlagScope = "to_me" | "sent" | "all";

export interface AdFlagInbox {
  scope: AdFlagScope;
  /** The views this person may use ("all" only for admin roles). */
  scopes: AdFlagScope[];
  /** Open flags per view. */
  counts: Partial<Record<AdFlagScope, number>>;
  /** Anything open or closed in the last 14 days, per view. */
  recent: Partial<Record<AdFlagScope, number>>;
  active: AdFlag[];
  closed: AdFlag[];
}
