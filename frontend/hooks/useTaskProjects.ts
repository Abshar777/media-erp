"use client";

/**
 * Task projects — the optional "Project" (ad account) on a task, and managing
 * its list (admin roles). Backend: /api/v1/task-projects
 * (services/task_project_service.py). Keys live under ["task-projects"].
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import api from "@/lib/axios";
import { useAuthStore } from "@/stores/authStore";
import { useTeams } from "@/hooks/useTeams";

export type ProjectPlatform = "meta" | "google" | "snapchat" | "other";

export interface TaskProject {
  id: string;
  name: string;
  platform: ProjectPlatform | string;
  /** Display group (the list is shown in groups, in order). */
  group: number;
}

/** A row in the manager: archived ones too, with how many tasks use it. */
export interface ManagedProject extends TaskProject {
  active: boolean;
  tasks: number;
}

const KEY = ["task-projects"] as const;
type Env<T> = { success: boolean; data: T; message?: string };

function errMsg(err: unknown, fallback: string): string {
  return (err as { response?: { data?: { message?: string } } })?.response?.data?.message || fallback;
}

const ELEVATED = ["Super Admin", "Admin", "Coordinator"];

/**
 * May this person manage the Project list? Admin roles, and anyone who leads a
 * team (by membership — mirrors task_project_service.can_manage).
 */
export function useCanManageProjects(): boolean {
  const role = useAuthStore((s) => s.user?.role?.role_name ?? "");
  const { data: teams = [] } = useTeams();
  return ELEVATED.includes(role) || teams.some((t) => t.my_role === "leader");
}

export function useTaskProjects(enabled = true) {
  return useQuery({
    queryKey: [...KEY],
    queryFn: async () => (await api.get<Env<TaskProject[]>>("/task-projects")).data.data,
    enabled,
    staleTime: 10 * 60_000,
  });
}

export function useManagedProjects(enabled = true) {
  return useQuery({
    queryKey: [...KEY, "manage"],
    queryFn: async () =>
      (await api.get<Env<ManagedProject[]>>("/task-projects", { params: { manage: 1 } })).data.data,
    enabled,
    staleTime: 15_000,
  });
}

/** Everything that changes the list refreshes the picker too; a rename also refreshes tasks. */
function useListMutation<V, R>(fn: (v: V) => Promise<R>, opts: { ok?: (r: R, v: V) => string | null; fail: string; tasks?: boolean }) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (r, v) => {
      qc.invalidateQueries({ queryKey: KEY });
      if (opts.tasks) qc.invalidateQueries({ queryKey: ["projects"] });
      const msg = opts.ok?.(r, v);
      if (msg) toast.success(msg);
    },
    onError: (e) => toast.error(errMsg(e, opts.fail)),
  });
}

export function useCreateProject() {
  return useListMutation(
    async (p: { name: string; platform: ProjectPlatform; group?: number | null }) =>
      (await api.post<Env<ManagedProject>>("/task-projects", p)).data.data,
    { ok: (r) => `“${r.name}” added`, fail: "Could not add the project" },
  );
}

export function useUpdateProject() {
  return useListMutation(
    async ({ id, ...p }: { id: string; name?: string; platform?: ProjectPlatform; group?: number; active?: boolean }) =>
      (await api.patch<Env<ManagedProject>>(`/task-projects/${id}`, p)).data.data,
    {
      ok: (r, v) => (v.active === true ? `“${r.name}” restored` : v.active === false ? `“${r.name}” deleted` : "Project updated"),
      fail: "Could not update the project",
      tasks: true,
    },
  );
}

export function useReorderProjects() {
  return useListMutation(
    async (ids: string[]) => (await api.put<Env<ManagedProject[]>>("/task-projects/order", { ids })).data.data,
    { fail: "Could not save the order" },
  );
}
