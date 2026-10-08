"use client";

/**
 * "Ad not performing" flags. Keys live under ["ad-reports", "flags"] so that
 * anything refreshing Ad Reports (incl. an expired signed creative link)
 * refreshes these too, and every flag change refreshes the reports' status line.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import api from "@/lib/axios";
import type { AdFlag, AdFlagAction, AdFlagDraft, AdFlagInbox, AdFlagScope } from "@/types/adFlag";

const KEY = ["ad-reports", "flags"] as const;
type Env<T> = { success: boolean; data: T; message?: string };

function errMsg(err: unknown, fallback: string): string {
  return (err as { response?: { data?: { message?: string } } })?.response?.data?.message || fallback;
}

/** Everything the "Ad not performing" dialog needs, loaded when it opens. */
export function useAdFlagDraft(reportId: string, enabled: boolean) {
  return useQuery({
    queryKey: [...KEY, "draft", reportId],
    queryFn: async () => (await api.get<Env<AdFlagDraft>>(`/ad-reports/${reportId}/flag-draft`)).data.data,
    enabled: enabled && !!reportId,
    staleTime: 0,
  });
}

export function useCreateAdFlag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ reportId, ...body }: {
      reportId: string; recipient_id: string; recipient_team_id: string; reasons: string[]; note: string;
    }) => (await api.post<Env<AdFlag>>(`/ad-reports/${reportId}/flags`, body)).data,
    onSuccess: (res) => {
      toast.success(res.message || "Sent");
      qc.invalidateQueries({ queryKey: ["ad-reports"] });
    },
    onError: (e) => toast.error(errMsg(e, "Couldn't send it. Please try again.")),
  });
}

/** Leader Desk → Ads to redo, for one view. */
export function useAdFlagInbox(scope: AdFlagScope = "to_me", enabled = true) {
  return useQuery({
    queryKey: [...KEY, "inbox", scope],
    queryFn: async () => (await api.get<Env<AdFlagInbox>>("/ad-flags/inbox", { params: { scope } })).data.data,
    enabled,
    staleTime: 30_000,
    refetchInterval: 2 * 60_000,
  });
}

export function useAdFlagAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, action, note = "" }: { id: string; action: AdFlagAction; note?: string }) =>
      (await api.patch<Env<AdFlag>>(`/ad-flags/${id}`, { action, note })).data,
    onSuccess: (res) => {
      toast.success(res.message || "Updated");
      qc.invalidateQueries({ queryKey: ["ad-reports"] });
    },
    onError: (e) => {
      toast.error(errMsg(e, "Couldn't update it. Please try again."));
      qc.invalidateQueries({ queryKey: KEY });
    },
  });
}
