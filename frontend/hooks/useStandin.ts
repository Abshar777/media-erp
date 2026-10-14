"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import api from "@/lib/axios";

/** A leader's hand-over of their Leader Desk to a teammate (backend: /api/v1/standin). */
export interface Handover {
  id: string;
  leader_id: string;
  leader_name: string;
  standin_id: string;
  standin_name: string;
  team_ids: string[];
  teams: { id: string; name: string }[];
  can_review: boolean;
  start_date: string;           // IST "YYYY-MM-DD", inclusive
  end_date: string;             // IST "YYYY-MM-DD", inclusive
  note: string;
  state: "active" | "scheduled" | "ended";
}

export interface StandinSettings {
  can_use: boolean;             // leads at least one team
  teams: { id: string; name: string; color?: string | null; member_ids: string[] }[];
  mine: Handover | null;        // the hand-over I made (active or coming up)
  standing_in: Handover[];      // where I stand in for someone
  max_days: number;
}

export function useStandin(enabled = true) {
  return useQuery<StandinSettings>({
    queryKey: ["standin"],
    queryFn: async () => (await api.get("/standin")).data.data,
    enabled,
    staleTime: 60_000,
  });
}

export interface HandoverBody {
  standin_id: string;
  start_date: string;
  end_date: string;
  team_ids?: string[];
  can_review: boolean;
  note?: string;
}

export function useHandOver() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: HandoverBody) => (await api.put("/standin", body)).data,
    onSuccess: async (res) => {
      toast.success(res.message || "Handed over");
      await qc.invalidateQueries({ queryKey: ["standin"] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || "Couldn't hand over"),
  });
}

export function useEndStandin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => (await api.delete("/standin")).data,
    onSuccess: async (res) => {
      toast.success(res.message || "Stand-in ended");
      await qc.invalidateQueries({ queryKey: ["standin"] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || "Couldn't end the stand-in"),
  });
}

/** "Sat 25 Oct" for an IST "YYYY-MM-DD". */
export function standinDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}
