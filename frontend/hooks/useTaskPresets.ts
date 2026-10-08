"use client";

/**
 * Saved tasks — suggestions for the Task name field. Backend: /api/v1/task-presets.
 * `useTaskSuggestions` loads everything for one team in one call; the
 * combobox filters in the browser, so typing never waits on the network.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import api from "@/lib/axios";
import type { TaskPriority } from "@/types/project";

export interface TaskPreset {
  id: string;
  team_id: string | null;          // null = company-wide
  team_name: string;
  title: string;
  description: string;
  priority: TaskPriority | null;
  uses: number;                     // tasks with this name in the last 90 days
  created_by_name: string;
}

export interface TaskSuggestions {
  saved: TaskPreset[];
  company: TaskPreset[];
  recent: { title: string; uses: number }[];
  can_save: boolean;
}

const KEY = ["task-presets"] as const;
type Env<T> = { success: boolean; data: T; message?: string };
const errMsg = (e: unknown, f: string) =>
  (e as { response?: { data?: { message?: string } } })?.response?.data?.message || f;

export function useTaskSuggestions(teamId: string, enabled = true) {
  return useQuery({
    queryKey: [...KEY, "suggest", teamId || "none"],
    queryFn: async () =>
      (await api.get<Env<TaskSuggestions>>("/task-presets/suggest", { params: { team_id: teamId || undefined } })).data.data,
    enabled,
    staleTime: 60_000,
  });
}

/** Management list. `teamId` null = the company list. */
export function useTaskPresets(teamId: string | null) {
  return useQuery({
    queryKey: [...KEY, "list", teamId ?? "company"],
    queryFn: async () =>
      (await api.get<Env<TaskPreset[]>>("/task-presets", { params: { team_id: teamId ?? undefined } })).data.data,
  });
}

export function useSaveTaskPreset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { team_id: string | null; title: string; description?: string; priority?: TaskPriority | null }) =>
      (await api.post<Env<TaskPreset>>("/task-presets", p)).data.data,
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
    onError: (e) => toast.error(errMsg(e, "Could not save it")),
  });
}

export function useUpdateTaskPreset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...p }: { id: string; title?: string; description?: string; priority?: TaskPriority | null; clear_priority?: boolean }) =>
      (await api.patch<Env<TaskPreset>>(`/task-presets/${id}`, p)).data.data,
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
    onError: (e) => toast.error(errMsg(e, "Could not save it")),
  });
}

export function useDeleteTaskPreset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.delete<Env<{ id: string }>>(`/task-presets/${id}`)).data.data,
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
    onError: (e) => toast.error(errMsg(e, "Could not remove it")),
  });
}
