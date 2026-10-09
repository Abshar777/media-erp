"use client";

import { useAuthStore } from "@/stores/authStore";
import { useTeams } from "@/hooks/useTeams";

const ELEVATED = ["Super Admin", "Admin", "Coordinator"];

/**
 * `(task) => boolean` — may the current user delete this task?
 * Admin roles, whoever created it, or a leader of its team. Mirrors
 * routers/projects._can_delete_task; the server is the real gate, this only
 * decides whether the trash icon is offered.
 */
export function useCanDeleteTask() {
  const user = useAuthStore((s) => s.user);
  const { data: teams = [] } = useTeams();
  const elevated = ELEVATED.includes(user?.role?.role_name ?? "");
  return (task: { created_by?: string; team_id?: string | null }) =>
    elevated ||
    (!!user?.id && task.created_by === user.id) ||
    (!!task.team_id && teams.some((t) => t.id === task.team_id && t.my_role === "leader"));
}
