"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import api from "@/lib/axios";

/** A team leader's auto-approve switch (backend: /api/v1/auto-approve). */
export interface AutoApproveSettings {
  enabled: boolean;
  delay_minutes: number;
  enabled_since: string | null;
  can_use: boolean;                       // leads at least one team
  teams: { id: string; name: string; color?: string | null }[];
  max_delay_minutes: number;
}

export function useAutoApprove(enabled = true) {
  return useQuery<AutoApproveSettings>({
    queryKey: ["auto-approve"],
    queryFn: async () => (await api.get("/auto-approve")).data.data,
    enabled,
    staleTime: 60_000,
  });
}

export function useSaveAutoApprove() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { enabled: boolean; delay_minutes: number }) =>
      (await api.put("/auto-approve", body)).data,
    onSuccess: (res) => {
      qc.setQueryData<AutoApproveSettings>(["auto-approve"], (prev) => (prev ? { ...prev, ...res.data } : prev));
      // Turning off removes this leader's timers from waiting work — refresh the cards.
      if (!res.data?.enabled) qc.invalidateQueries({ queryKey: ["projects"] });
      toast.success(res.message || "Saved");
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || "Couldn't save auto-approve"),
  });
}

/** Stop / resume auto-approval for one task waiting in review. */
export function useHoldAutoApprove() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ taskId, hold }: { taskId: string; hold: boolean }) =>
      (await api.post(`/auto-approve/hold/${taskId}`, { hold })).data,
    onSuccess: async (res) => {
      await qc.invalidateQueries({ queryKey: ["projects"] });
      toast.success(res.message || "Updated");
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || "Couldn't change auto-approval"),
  });
}

/** "30 min", "1 h", "1 h 30 min", "Instantly". */
export function delayLabel(min: number): string {
  if (!min) return "Instantly";
  const h = Math.floor(min / 60), m = min % 60;
  return [h ? `${h} h` : "", m ? `${m} min` : ""].filter(Boolean).join(" ");
}
