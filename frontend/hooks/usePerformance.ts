// Same-origin (relative) — never reference NEXT_PUBLIC_API_URL here even
// conditionally; next.config.ts proxies /api/v1 to the backend server-side.
"use client";

import { useQuery } from "@tanstack/react-query";
import api from "@/lib/axios";

export interface MemberPerf {
  user_id: string;
  name: string;
  measured: number;                      // tasks with a tracked duration
  completed: number;
  reedits: number;
  avg_seconds: number | null;            // average hands-on time per task
  median_seconds: number | null;
  worst_seconds: number | null;
  avg_turnaround_seconds: number | null; // first start → approved, wall clock
  on_time_rate: number | null;           // % finished by the due date
  rank: number | null;
  ranked: boolean;
}

export interface ApproverPerf {
  user_id: string;
  name: string;
  approvals: number;
  avg_seconds: number | null;            // submitted → approved
  median_seconds: number | null;
  worst_seconds: number | null;
  rank: number | null;
  ranked: boolean;
}

export interface VerifierPerf {
  user_id: string;
  name: string;
  verifications: number;
  signed_off?: number;
  rejected?: number;
  still_waiting?: number;                // outstanding right now
  avg_seconds: number | null;            // delay they add, open ones included
  median_seconds: number | null;
  worst_seconds: number | null;
  rank: number | null;
  ranked: boolean;
}

export interface TeamPerf {
  team_id: string;
  team_name: string;
  members: MemberPerf[];
  approvers: ApproverPerf[];
  verifiers: VerifierPerf[];
}

export interface PerformanceReport {
  teams: TeamPerf[];
  generated_at: string;
  min_sample: number;
  scope: "all" | "led";
}

export interface PerformanceFilters {
  team_id?: string;
  date_from?: string;
  date_to?: string;
}

export function usePerformance(filters: PerformanceFilters = {}) {
  return useQuery<PerformanceReport>({
    queryKey: ["performance", filters],
    queryFn: async () => {
      const { data } = await api.get("/performance", { params: filters });
      return data.data;
    },
    // The report walks every task's history, so it is measured in seconds, not
    // milliseconds. Refetching on every window focus would be punishing.
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  });
}

/** "2h 15m" — compact, never more than two units. */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null) return "—";
  const s = Math.max(0, Math.round(seconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m`;
  return `${s}s`;
}
