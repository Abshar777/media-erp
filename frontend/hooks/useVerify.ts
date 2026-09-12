"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import api from "@/lib/axios";
import type { Task, TaskVerification } from "@/types/project";

export interface VerificationView {
  task: Task;
  instructions: string;
  /** Null when a Super Admin is observing a task they aren't a verifier on. */
  mine: TaskVerification | null;
  verifications: TaskVerification[];
}

export interface VerifyInboxItem extends Task {
  /** Null when a Super Admin is viewing a task they aren't a verifier on. */
  my_verification: TaskVerification | null;
  awaiting_me: boolean;
}

export interface VerifyInboxMeta {
  awaiting: number;
  company_wide: boolean;
  /** True for a Super Admin — the only role that may look company-wide. */
  can_see_all: boolean;
}

/**
 * Tasks that list you as a verifier. With `everyone`, a Super Admin sees every
 * task under verification company-wide — oversight rather than a queue.
 */
export function useMyVerifications(
  scope: "pending" | "done" | "all" = "pending",
  everyone = false
) {
  return useQuery<{ items: VerifyInboxItem[]; meta: VerifyInboxMeta }>({
    queryKey: ["verify", "inbox", scope, everyone],
    queryFn: async () => {
      const { data } = await api.get<{
        success: boolean; data: VerifyInboxItem[]; meta: VerifyInboxMeta;
      }>("/verify", { params: { scope, ...(everyone ? { everyone: true } : {}) } });
      return { items: data.data, meta: data.meta };
    },
    refetchInterval: 30_000,
    staleTime: 10_000,
  });
}

export function useVerification(taskId: string) {
  return useQuery<VerificationView>({
    queryKey: ["verify", taskId],
    queryFn: async () => {
      const { data } = await api.get<{ success: boolean; data: VerificationView }>(
        `/verify/${taskId}`
      );
      return data.data;
    },
    enabled: !!taskId,
    // A verification is a one-off decision, not a live feed — refetching while
    // someone is mid-way through typing a reason would be actively unhelpful.
    staleTime: 30_000,
    retry: false,
  });
}

export function useSubmitVerification(taskId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { passed: boolean; reason?: string }) => {
      const { data } = await api.post(`/verify/${taskId}`, body);
      return data;
    },
    onSuccess(_d, vars) {
      qc.invalidateQueries({ queryKey: ["verify", taskId] });
      // The task's status may have changed (a rejection sends it to reedit),
      // so the boards and the leader queue are both stale now.
      qc.invalidateQueries({ queryKey: ["projects"] });
      toast.success(vars.passed ? "Verified — thanks" : "Sent back for changes");
    },
    onError(err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        "Could not record your verification";
      toast.error(msg);
    },
  });
}


/**
 * Drop a verifier from a task — the escape hatch when a verification can never
 * complete. Elevated roles only; the server refuses anyone else.
 */
export function useRemoveVerifier(taskId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, reason }: { userId: string; reason: string }) => {
      const { data } = await api.delete(`/verify/${taskId}/verifier/${userId}`, {
        data: { reason },
      });
      return data;
    },
    onSuccess(d) {
      qc.invalidateQueries({ queryKey: ["verify"] });
      qc.invalidateQueries({ queryKey: ["projects"] });
      toast.success(
        d?.data?.all_verified
          ? "Verifier removed — the task can now be approved"
          : "Verifier removed"
      );
    },
    onError(err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        "Could not remove that verifier";
      toast.error(msg);
    },
  });
}
