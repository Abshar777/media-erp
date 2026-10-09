"use client";

/**
 * Ad Reports — Meta-style numbers entered daily. Backend: /api/v1/ad-reports
 * (routers/ad_reports.py). Keys live under ["ad-reports"] — "performance" is
 * the task-turnaround report.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import api from "@/lib/axios";
import type {
  AdCreative, AdDeleteResult,
  AdEntry, AdEntryPayload, AdGranularity, AdReport, AdSeries, AdToday,
  CreateAdReportPayload, UpdateAdReportPayload,
} from "@/types/adReport";

const KEY = ["ad-reports"] as const;
type Env<T> = { success: boolean; data: T; message?: string };

function errMsg(err: unknown, fallback: string): string {
  return (err as { response?: { data?: { message?: string } } })?.response?.data?.message || fallback;
}

/** Sidebar badge, Overview banner and the leader strip. Cheap; refreshed every 5 min. */
export function useAdToday(enabled = true) {
  return useQuery({
    queryKey: [...KEY, "today"],
    queryFn: async () => (await api.get<Env<AdToday>>("/ad-reports/today")).data.data,
    enabled,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });
}

export function useAdReports(scope: "all" | "mine" = "all") {
  return useQuery({
    queryKey: [...KEY, "list", scope],
    queryFn: async () => (await api.get<Env<AdReport[]>>("/ad-reports", { params: { scope } })).data.data,
    staleTime: 30_000,
  });
}

export function useAdSeries(id: string | null, from: string, to: string, granularity: AdGranularity) {
  return useQuery({
    queryKey: [...KEY, "series", id, from, to, granularity],
    queryFn: async () =>
      (await api.get<Env<AdSeries>>(`/ad-reports/${id}/series`, { params: { from, to, granularity } })).data.data,
    enabled: !!id,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
}

export function useAdEntries(id: string | null, from?: string, to?: string, enabled = true) {
  return useQuery({
    queryKey: [...KEY, "entries", id, from, to],
    queryFn: async () =>
      (await api.get<Env<AdEntry[]>>(`/ad-reports/${id}/entries`, { params: { from, to } })).data.data,
    enabled: !!id && enabled,
    staleTime: 15_000,
  });
}

export function useCreateAdReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: CreateAdReportPayload) => (await api.post<Env<AdReport>>("/ad-reports", p)).data.data,
    onSuccess: (r) => {
      toast.success(r.kind === "account" ? "Ad account created" : "Ad report created");
      qc.invalidateQueries({ queryKey: KEY });
    },
    onError: (e) => toast.error(errMsg(e, "Could not create the report")),
  });
}

export function useUpdateAdReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...p }: UpdateAdReportPayload & { id: string }) =>
      (await api.patch<Env<AdReport>>(`/ad-reports/${id}`, p)).data,
    onSuccess: (res) => { toast.success(res.message || "Report updated"); qc.invalidateQueries({ queryKey: KEY }); },
    onError: (e) => toast.error(errMsg(e, "Could not update the report")),
  });
}

/**
 * Delete an ad or an account (with_ads: its ads too). The toast offers Undo,
 * which puts everything back with the same ids. `onDeleted` runs first so the
 * page can move off the report before the list refreshes.
 */
export function useDeleteAdReport() {
  const qc = useQueryClient();
  const restore = useMutation({
    mutationFn: async (batch: string) =>
      (await api.post<Env<{ report_id: string; name: string }>>(`/ad-reports/deleted/${batch}/restore`)).data.data,
    // Awaited, so the caller's onSuccess (re-select it) runs once the list has it again —
    // otherwise the page's "nothing selected → first report" fallback wins the race.
    onSuccess: async (r) => { toast.success(`Restored “${r.name}”`); await qc.invalidateQueries({ queryKey: KEY }); },
    onError: (e) => toast.error(errMsg(e, "Could not bring it back")),
  });
  return useMutation({
    mutationFn: async ({ id, withAds = false }: { id: string; withAds?: boolean; onRestored?: (id: string) => void }) =>
      (await api.delete<Env<AdDeleteResult>>(`/ad-reports/${id}`, { params: withAds ? { with_ads: true } : undefined })).data.data,
    onSuccess: (r, vars) => {
      // Off the list at once, so the page moves to another report without a flash.
      qc.setQueriesData<AdReport[]>({ queryKey: [...KEY, "list"] }, (old) =>
        old?.filter((x) => x.id !== vars.id && !(vars.withAds && x.account_id === vars.id)));
      // Refresh everything (flags live under this key too) except the gone report's own
      // series / entries, which would only 404 while the page moves off it.
      qc.invalidateQueries({ queryKey: KEY, predicate: (q) => !q.queryKey.includes(vars.id) });
      const extra = r.reports > 1 ? ` and ${r.reports - 1} ad${r.reports > 2 ? "s" : ""}` : "";
      toast.success(`Deleted “${r.name}”${extra}`, {
        duration: 10_000,
        action: {
          label: "Undo",
          // mutateAsync, not mutate's callbacks: those are skipped when the dialog that
          // started it has unmounted (the page may have moved to an account meanwhile).
          onClick: () => { restore.mutateAsync(r.batch).then((x) => vars.onRestored?.(x.report_id), () => {}); },
        },
      });
    },
    onError: (e) => toast.error(errMsg(e, "Could not delete it")),
  });
}

export function useSaveAdEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, date, ...p }: AdEntryPayload & { id: string; date: string }) =>
      (await api.put<Env<{ missing: string[]; day_status: string; report_status: string }>>(
        `/ad-reports/${id}/entries/${date}`, p)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useRemindAdReport() {
  return useMutation({
    mutationFn: async (id: string) => (await api.post<Env<{ notified: number }>>(`/ad-reports/${id}/remind`)).data,
    onSuccess: () => toast.success("Reminder sent"),
    onError: (e) => toast.error(errMsg(e, "Could not send the reminder")),
  });
}

/** Register a file already uploaded to R2 (lib/directUpload) as a creative. */
export function useAddCreative() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...file }: { id: string; key: string; filename: string; size: number; content_type: string }) =>
      (await api.post<Env<AdCreative[]>>(`/ad-reports/${id}/creatives`, file)).data.data,
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useSetCover() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, creativeId }: { id: string; creativeId: string }) =>
      (await api.post<Env<AdCreative[]>>(`/ad-reports/${id}/creatives/${creativeId}/cover`)).data.data,
    onSuccess: () => { toast.success("Cover updated"); qc.invalidateQueries({ queryKey: KEY }); },
    onError: (e) => toast.error(errMsg(e, "Could not change the cover")),
  });
}

export function useRemoveCreative() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, creativeId }: { id: string; creativeId: string }) =>
      (await api.delete<Env<AdCreative[]>>(`/ad-reports/${id}/creatives/${creativeId}`)).data.data,
    onSuccess: () => { toast.success("Creative removed"); qc.invalidateQueries({ queryKey: KEY }); },
    onError: (e) => toast.error(errMsg(e, "Could not remove it")),
  });
}

export { errMsg as adErrorMessage };
