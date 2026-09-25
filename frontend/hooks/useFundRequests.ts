"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import api from "@/lib/axios";

export type FundRequestStatus = "pending" | "failed" | "submitted" | "approved" | "rejected";

export interface FundRequest {
  id: string;
  title: string;
  purpose: string;
  platform: string;
  amount_minor: number;
  currency: string;
  period: string; // YYYY-MM
  status: FundRequestStatus;
  requested_by: { id: string; name: string; email: string };
  finance_error: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string;
  created_at: string;
  submitted_at: string | null;
  decided_at: string | null;
}

export interface FundRequestMeta {
  platforms: string[];
  currency: string;
  finance_configured: boolean;
  can_see_all: boolean;
}

export interface NewFundRequest {
  title: string;
  purpose: string;
  platform: string;
  amount: string; // as typed, e.g. "1500.50"
  period: string; // YYYY-MM
}

const KEY = ["fund-requests"] as const;

// The API answers errors as {message} from its own checks and {detail} from
// FastAPI's permission guard; either is worth showing as it is.
export function apiMessage(e: unknown, fallback: string): string {
  const data = (e as { response?: { data?: { message?: string; detail?: unknown } } })?.response?.data;
  if (data?.message) return data.message;
  if (typeof data?.detail === "string") return data.detail;
  return fallback;
}

export function useFundRequestMeta() {
  return useQuery({
    queryKey: [...KEY, "meta"],
    queryFn: async () => {
      const { data } = await api.get("/fund-requests/meta");
      return data.data as FundRequestMeta;
    },
    staleTime: 5 * 60_000,
  });
}

export function useFundRequests(scope: "mine" | "all") {
  return useQuery({
    queryKey: [...KEY, "list", scope],
    queryFn: async () => {
      const { data } = await api.get("/fund-requests", { params: { scope } });
      return data.data as { items: FundRequest[]; meta: { can_see_all: boolean; finance_configured: boolean } };
    },
    // Decisions arrive from finance in the background — keep the list current
    // without anybody having to reload to find out.
    refetchInterval: 60_000,
  });
}

export function useCreateFundRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: NewFundRequest) => {
      const { data } = await api.post("/fund-requests", body);
      return data.data as FundRequest;
    },
    onSuccess: (req) => {
      if (req.status === "submitted") toast.success("Sent to finance for approval");
      else if (req.status === "failed") toast.error(`Finance did not accept it: ${req.finance_error ?? "unknown reason"}`);
      else toast.message("Saved — it will go to finance as soon as finance can be reached");
      qc.invalidateQueries({ queryKey: KEY });
    },
    onError: (e) => toast.error(apiMessage(e, "Could not save the request")),
  });
}

export function useRetryFundRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await api.post(`/fund-requests/${id}/retry`);
      return data.data as FundRequest;
    },
    onSuccess: (req) => {
      if (req.status === "submitted") toast.success("Sent to finance for approval");
      else toast.error(req.finance_error ?? "Finance still could not take it — it will keep trying");
      qc.invalidateQueries({ queryKey: KEY });
    },
    onError: (e) => toast.error(apiMessage(e, "Could not send it again")),
  });
}
