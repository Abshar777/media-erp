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
  AdCreative,
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
