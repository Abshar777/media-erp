"use client";

/**
 * Repeating-task series — list, read one, and manage (pause / resume / stop /
 * edit future copies). Backend: /api/v1/projects/recurring (services/recurrence.py).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import api from "@/lib/axios";
import type { RecurringSeries, UpdateRecurringPayload } from "@/types/project";

const KEY = ["projects", "recurring"] as const;

/** Series the current user can manage. Lives under ["projects"] so task mutations refresh it. */
export function useRecurringList(enabled = true) {
  return useQuery({
    queryKey: KEY,
    queryFn: async () => {
      const { data } = await api.get<{ success: boolean; data: RecurringSeries[] }>("/projects/recurring");
      return data.data;
    },
    enabled,
    staleTime: 15_000,
  });
}

/** One series — used by the strip in the task detail modal. */
export function useRecurringSeries(id: string | null | undefined) {
  return useQuery({
    queryKey: [...KEY, id],
    queryFn: async () => {
      const { data } = await api.get<{ success: boolean; data: RecurringSeries }>(`/projects/recurring/${id}`);
      return data.data;
    },
    enabled: !!id,
    staleTime: 15_000,
    // 404 = not shared with you; the strip then shows just the copy number.
    retry: (n, err: unknown) => (err as { response?: { status?: number } })?.response?.status !== 404 && n < 2,
  });
}

const ACTION_DONE: Record<NonNullable<UpdateRecurringPayload["action"]>, string> = {
  pause: "Repeating task paused",
  resume: "Repeating task resumed",
  stop: "Repeating task stopped",
};

export function useUpdateRecurring() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...payload }: UpdateRecurringPayload & { id: string }) => {
      const { data } = await api.patch<{ success: boolean; data: RecurringSeries }>(
        `/projects/recurring/${id}`,
        payload
      );
      return data.data;
    },
    onSuccess(_s, vars) {
      // Resuming can create today's copy, so refresh tasks as well as series.
      qc.invalidateQueries({ queryKey: ["projects"] });
      toast.success(vars.action ? ACTION_DONE[vars.action] : "Changes saved — they apply to future copies");
    },
    onError(err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg || "Couldn't update the repeating task");
    },
  });
}
