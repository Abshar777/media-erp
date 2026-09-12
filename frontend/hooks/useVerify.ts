"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import api from "@/lib/axios";
import type { Task, TaskVerification } from "@/types/project";

export interface VerificationView {
  task: Task;
  instructions: string;
  mine: TaskVerification;
  verifications: TaskVerification[];
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
