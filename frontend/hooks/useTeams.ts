"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import api from "@/lib/axios";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TeamMember {
  user_id: string;
  role: "leader" | "member";
  joined_at: string;
  name: string;
  email: string;
  designation: string;
  avatar?: string;
}

export interface Team {
  id: string;
  name: string;
  description: string;
  color: string;
  status?: "active" | "inactive";
  created_by: string;
  members: TeamMember[];
  member_count: number;
  task_count?: number;
  done_count?: number;
  my_role?: "leader" | "member" | "admin";
  created_at: string;
  updated_at: string;
}

export interface AssignableUser {
  id: string;
  name: string;
  email: string;
  designation: string;
  avatar?: string;
  status: string;
  role_name?: string;   // system role name e.g. "Employee", "Team Leader"
}

export interface MemberReport {
  user: {
    id: string;
    name: string;
    email: string;
    designation: string;
    avatar?: string;
    status: string;
  };
  member_since: string | null;
  team_name: string;
  tasks: {
    total: number;
    completed: number;
    completion_pct: number;
    by_status: Record<string, number>;
    by_priority: Record<string, number>;
    recent: Array<{
      id: string;
      title: string;
      status: string;
      priority: string;
      due_date: string | null;
      updated_at: string | null;
    }>;
  };
}

export type ReportPeriod = "daily" | "weekly" | "monthly" | "custom";

export interface TeamReport {
  team_id: string;
  team_name: string;
  period: ReportPeriod;
  date_from: string;
  date_to: string;
  summary: {
    created: number;
    completed: number;
    completion_pct: number;
    active: number;
    members: number;
  };
  by_status: Record<string, number>;
  by_priority: Record<string, number>;
  timeseries: Array<{ date: string; created: number; completed: number }>;
  members: Array<{
    user_id: string;
    name: string;
    role: "leader" | "member";
    avatar?: string;
    assigned: number;
    completed: number;
  }>;
}

export interface MemberActivity {
  user: {
    id: string;
    name: string;
    email: string;
    designation: string;
    avatar?: string;
    status: string;
  };
  team_id: string;
  team_name: string;
  period: ReportPeriod;
  date_from: string;
  date_to: string;
  summary: {
    created: number;
    completed: number;
    completion_pct: number;
    active: number;
  };
  by_status: Record<string, number>;
  by_priority: Record<string, number>;
  timeseries: Array<{ date: string; created: number; completed: number }>;
  recent: Array<{
    id: string;
    title: string;
    status: string;
    priority: string;
    due_date: string | null;
    updated_at: string | null;
  }>;
}

// ── Query keys ────────────────────────────────────────────────────────────────

const QK = {
  list: ["teams"] as const,
  detail: (id: string) => ["teams", id] as const,
  report: (teamId: string, userId: string) => ["teams", teamId, "members", userId, "report"] as const,
  teamReport: (teamId: string, period: string, from: string, to: string) =>
    ["teams", teamId, "report", period, from, to] as const,
  memberActivity: (teamId: string, userId: string, period: string, from: string, to: string) =>
    ["teams", teamId, "members", userId, "activity", period, from, to] as const,
};

// ── Hooks ─────────────────────────────────────────────────────────────────────

export function useTeams() {
  return useQuery({
    queryKey: QK.list,
    queryFn: async () => {
      const { data } = await api.get<{ success: boolean; data: Team[] }>("/teams");
      return data.data;
    },
  });
}

/** Returns ALL teams (id + name + color only) for any authenticated user.
 *  Used in routing dropdowns where every team must be visible. */
export function useAllTeams() {
  return useQuery({
    queryKey: ["teams", "all"],
    queryFn: async () => {
      const { data } = await api.get<{ success: boolean; data: { id: string; name: string; color: string }[] }>("/teams/all");
      return data.data;
    },
    staleTime: 30_000,
  });
}

export function useTeam(teamId: string) {
  return useQuery({
    queryKey: QK.detail(teamId),
    queryFn: async () => {
      const { data } = await api.get<{ success: boolean; data: Team }>(`/teams/${teamId}`);
      return data.data;
    },
    enabled: !!teamId,
  });
}

export function useAssignableUsers() {
  return useQuery({
    queryKey: ["teams", "assignable-users"],
    queryFn: async () => {
      const { data } = await api.get<{ success: boolean; data: AssignableUser[] }>(
        "/teams/users"
      );
      return data.data;
    },
    staleTime: 60_000,
  });
}

export function useMemberReport(teamId: string, userId: string) {
  return useQuery({
    queryKey: QK.report(teamId, userId),
    queryFn: async () => {
      const { data } = await api.get<{ success: boolean; data: MemberReport }>(
        `/teams/${teamId}/members/${userId}/report`
      );
      return data.data;
    },
    enabled: !!(teamId && userId),
  });
}

export function useTeamReport(
  teamId: string,
  period: ReportPeriod,
  dateFrom?: string,
  dateTo?: string,
) {
  return useQuery({
    queryKey: QK.teamReport(teamId, period, dateFrom ?? "", dateTo ?? ""),
    queryFn: async () => {
      const params: Record<string, string> = { period };
      if (period === "custom" && dateFrom && dateTo) {
        params.date_from = dateFrom;
        params.date_to = dateTo;
      }
      const { data } = await api.get<{ success: boolean; data: TeamReport }>(
        `/teams/${teamId}/report`,
        { params },
      );
      return data.data;
    },
    enabled: !!teamId && (period !== "custom" || !!(dateFrom && dateTo)),
    staleTime: 30_000,
  });
}

export function useMemberActivity(
  teamId: string,
  userId: string,
  period: ReportPeriod,
  dateFrom?: string,
  dateTo?: string,
) {
  return useQuery({
    queryKey: QK.memberActivity(teamId, userId, period, dateFrom ?? "", dateTo ?? ""),
    queryFn: async () => {
      const params: Record<string, string> = { period };
      if (period === "custom" && dateFrom && dateTo) {
        params.date_from = dateFrom;
        params.date_to = dateTo;
      }
      const { data } = await api.get<{ success: boolean; data: MemberActivity }>(
        `/teams/${teamId}/members/${userId}/activity`,
        { params },
      );
      return data.data;
    },
    enabled: !!(teamId && userId) && (period !== "custom" || !!(dateFrom && dateTo)),
    staleTime: 30_000,
  });
}

export function useCreateTeam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      name: string;
      description?: string;
      color?: string;
      status?: "active" | "inactive";
      leader_ids?: string[];
      member_ids?: string[];
    }) => {
      const { data } = await api.post<{ success: boolean; data: Team }>("/teams", payload);
      return data.data;
    },
    onSuccess() {
      qc.invalidateQueries({ queryKey: QK.list });
      toast.success("Team created");
    },
    onError() {
      toast.error("Failed to create team");
    },
  });
}

export function useUpdateTeam(teamId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      name?: string;
      description?: string;
      color?: string;
      // Backend UpdateTeamRequest accepts this too; it was missing here, so
      // the Teams-list edit modal couldn't change a team's active state.
      status?: "active" | "inactive";
      // Full roster replacement — omit to leave membership untouched.
      leader_ids?: string[];
      member_ids?: string[];
    }) => {
      const { data } = await api.put<{ success: boolean; data: Team }>(`/teams/${teamId}`, payload);
      return data.data;
    },
    onSuccess() {
      qc.invalidateQueries({ queryKey: QK.list });
      qc.invalidateQueries({ queryKey: QK.detail(teamId) });
      // useAllTeams powers the routing/approver pickers — a rename or a team
      // going inactive must show up there too.
      qc.invalidateQueries({ queryKey: ["teams", "all"] });
      toast.success("Team updated");
    },
    onError() {
      toast.error("Failed to update team");
    },
  });
}

export function useDeleteTeam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (teamId: string) => {
      await api.delete(`/teams/${teamId}`);
    },
    onSuccess() {
      qc.invalidateQueries({ queryKey: QK.list });
      toast.success("Team deleted");
    },
    onError() {
      toast.error("Failed to delete team");
    },
  });
}

export function useAddTeamMember(teamId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { user_id: string; role: "member" | "leader" }) => {
      const { data } = await api.post(`/teams/${teamId}/members`, payload);
      return data;
    },
    // No per-item toast — callers may add several at once and show a summary.
    onSuccess() {
      qc.invalidateQueries({ queryKey: QK.detail(teamId) });
      qc.invalidateQueries({ queryKey: QK.list });
    },
  });
}

export function useRemoveTeamMember(teamId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (userId: string) => {
      await api.delete(`/teams/${teamId}/members/${userId}`);
    },
    onSuccess() {
      qc.invalidateQueries({ queryKey: QK.detail(teamId) });
      toast.success("Member removed");
    },
    onError(err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
        || "Failed to remove member";
      toast.error(msg);
    },
  });
}

export function useUpdateMemberRole(teamId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: "member" | "leader" }) => {
      const { data } = await api.put(`/teams/${teamId}/members/${userId}/role`, { role });
      return data;
    },
    onSuccess() {
      qc.invalidateQueries({ queryKey: QK.detail(teamId) });
      toast.success("Role updated");
    },
    onError() {
      toast.error("Failed to update role");
    },
  });
}
