"use client";

import { useState } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import api from "@/lib/axios";
import { BOARD_COLUMNS } from "@/types/project";
import type {
  CreateTaskPayload,
  ProjectFilters,
  Task,
  UpdateTaskPayload,
} from "@/types/project";

const QK = {
  tasks: (filters: Partial<ProjectFilters>) => ["projects", "tasks", filters] as const,
};

export interface LeaderTeam {
  id: string;
  name: string;
  color: string;
  members: { id: string; name: string; role: string }[];
}

export interface LeaderQueue {
  is_leader: boolean;
  review: Task[];
  incoming: Task[];
  reedit: Task[];
  teams: LeaderTeam[];
}

export function useTaskDetail(id: string | null) {
  return useQuery({
    queryKey: ["projects", "task", id],
    queryFn: async () => {
      const { data } = await api.get<{ success: boolean; data: Task }>(
        `/projects/${id}`
      );
      return data.data;
    },
    enabled: !!id,
    staleTime: 0,
  });
}

export interface LeaderQueueFilters {
  search?: string;
  priority?: string;
  date_filter?: string;
  date_from?: string;
  date_to?: string;
  /** "" / "unassigned" = the default queue, "assigned" or "all" widen it. */
  assigned?: string;
  /** Same chips as the Projects board: assigned_to_me | needs_my_approval | created_by_me */
  scope?: string;
}

export function useLeaderQueue(
  opts?: { enabled?: boolean },
  filters: LeaderQueueFilters = {}
) {
  return useQuery({
    // Filters are part of the key, so each combination caches separately
    // instead of the 15s poll overwriting a filtered view with an unfiltered one.
    queryKey: ["projects", "leader-queue", filters],
    queryFn: async () => {
      const params: Record<string, string> = {};
      for (const [k, v] of Object.entries(filters)) if (v) params[k] = v;
      const { data } = await api.get<{ success: boolean; data: LeaderQueue }>(
        "/projects/leader/queue",
        { params }
      );
      return data.data;
    },
    refetchInterval: 15_000,
    enabled: opts?.enabled ?? true,
  });
}

/** Pagination info returned alongside a task list (see GET /projects `meta`). */
export interface TasksMeta {
  total: number;
  returned: number;
  page: number;
  limit: number;
  pages: number;
  has_more: boolean;
  truncated: boolean;
}

/**
 * Paged task list. `data` from the API stays a plain array; pagination lives in
 * `meta`, so nothing ever silently falls off the end of the list.
 *
 * Pass `limit: 0` (the default) for "everything up to the server ceiling" —
 * identical to the legacy behaviour.
 */
export function useTasksPaged(
  filters: Partial<ProjectFilters> = {},
  page = 1,
  limit = 0
) {
  return useQuery({
    queryKey: [...QK.tasks(filters), "paged", page, limit],
    queryFn: async () => {
      const params: Record<string, string | number> = {};
      if (filters.search)      params.search      = filters.search;
      if (filters.status)      params.status      = filters.status;
      if (filters.priority)    params.priority    = filters.priority;
      if (filters.date_filter) params.date_filter = filters.date_filter;
      if (filters.date_from)   params.date_from   = filters.date_from;
      if (filters.date_to)     params.date_to     = filters.date_to;
      if (filters.team_id)     params.team_id     = filters.team_id;
      if (filters.member_id)   params.member_id   = filters.member_id;
      if (filters.scope)       params.scope       = filters.scope;
      params.page = page;
      if (limit > 0) params.limit = limit;

      const { data } = await api.get<{
        success: boolean; data: Task[]; meta?: TasksMeta;
      }>("/projects", { params });

      const meta: TasksMeta = data.meta ?? {
        total: data.data.length, returned: data.data.length,
        page: 1, limit: 0, pages: 1, has_more: false, truncated: false,
      };
      return { items: data.data, meta };
    },
    staleTime: 10_000,
    placeholderData: (prev) => prev,   // keep the old page visible while fetching
  });
}

/** Per-column state for the Kanban board. */
export interface ColumnMeta {
  total: number;
  loaded: number;
  hasMore: boolean;
}

/**
 * Kanban data loader — one paged query PER COLUMN.
 *
 * A flat page-1 slice would fill the six columns unevenly (it's just the newest
 * N tasks overall), so the board pages each column independently. Every column
 * reports "loaded of total" and can load more, which means no column can ever
 * quietly hide work.
 */
export function useBoardColumns(
  filters: Partial<ProjectFilters> = {},
  pageSize = 50
) {
  const [limits, setLimits] = useState<Record<string, number>>({});

  const results = useQueries({
    queries: BOARD_COLUMNS.map((col) => {
      const limit = limits[col.key] ?? pageSize;
      return {
        queryKey: [...QK.tasks(filters), "col", col.key, limit],
        queryFn: async () => {
          const params: Record<string, string | number> = { status: col.key, page: 1, limit };
          if (filters.search)      params.search      = filters.search;
          if (filters.priority)    params.priority    = filters.priority;
          if (filters.date_filter) params.date_filter = filters.date_filter;
          if (filters.date_from)   params.date_from   = filters.date_from;
          if (filters.date_to)     params.date_to     = filters.date_to;
          if (filters.team_id)     params.team_id     = filters.team_id;
          if (filters.member_id)   params.member_id   = filters.member_id;
          if (filters.scope)       params.scope       = filters.scope;
      if (filters.scope)       params.scope       = filters.scope;
          const { data } = await api.get<{
            success: boolean; data: Task[]; meta?: TasksMeta;
          }>("/projects", { params });
          return { items: data.data, meta: data.meta };
        },
        staleTime: 10_000,
        placeholderData: (prev: unknown) => prev,
      };
    }),
  });

  // Each column is fetched (and invalidated) independently, so right after a
  // status change there's a window where the moved task is still cached under
  // its OLD column while already present under its NEW one — a duplicate card
  // in two places at once. That window can outlast a normal re-render cycle
  // (observed: stale copies surviving several seconds without a manual
  // refresh), so we can't just trust "the stale query will catch up." Instead,
  // de-dupe by id and keep whichever copy has the newer `updated_at` — that's
  // always the column the task actually belongs to right now.
  const byId = new Map<string, Task>();
  for (const r of results) {
    for (const t of r.data?.items ?? []) {
      const existing = byId.get(t.id);
      if (!existing || new Date(t.updated_at) >= new Date(existing.updated_at)) {
        byId.set(t.id, t);
      }
    }
  }
  const tasks: Task[] = [...byId.values()];

  const meta: Record<string, ColumnMeta> = {};
  BOARD_COLUMNS.forEach((col, i) => {
    const m = results[i].data?.meta;
    const loaded = results[i].data?.items?.length ?? 0;
    meta[col.key] = {
      total: m?.total ?? loaded,
      loaded,
      hasMore: m?.has_more ?? false,
    };
  });

  function loadMore(status: string) {
    setLimits((prev) => ({ ...prev, [status]: (prev[status] ?? pageSize) + pageSize }));
  }

  return {
    tasks,
    meta,
    loadMore,
    isLoading: results.some((r) => r.isLoading),
    /** True match count across every column — independent of what's loaded. */
    total: Object.values(meta).reduce((n, m) => n + m.total, 0),
  };
}

export function useTasks(filters: Partial<ProjectFilters> = {}) {
  return useQuery({
    queryKey: QK.tasks(filters),
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (filters.search)      params.search      = filters.search;
      if (filters.status)      params.status      = filters.status;
      if (filters.priority)    params.priority    = filters.priority;
      if (filters.date_filter) params.date_filter = filters.date_filter;
      if (filters.date_from)   params.date_from   = filters.date_from;
      if (filters.date_to)     params.date_to     = filters.date_to;
      if (filters.team_id)     params.team_id     = filters.team_id;
      if (filters.member_id)   params.member_id   = filters.member_id;
      if (filters.scope)       params.scope       = filters.scope;
      const { data } = await api.get<{ success: boolean; data: Task[] }>(
        "/projects",
        { params }
      );
      return data.data;
    },
    staleTime: 10_000,
  });
}

export function useCreateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CreateTaskPayload) => {
      const { data } = await api.post<{ success: boolean; data: Task }>(
        "/projects",
        payload
      );
      return data.data;
    },
    onSuccess() {
      qc.invalidateQueries({ queryKey: ["projects"] });
      toast.success("Task created!");
    },
    onError() {
      toast.error("Failed to create task");
    },
  });
}

export function useUpdateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, payload }: { id: string; payload: UpdateTaskPayload }) => {
      const { data } = await api.put<{ success: boolean; data: Task }>(
        `/projects/${id}`,
        payload
      );
      return data.data;
    },
    onSuccess() {
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
    onError(err: unknown) {
      // Revert the optimistic board move and surface the workflow reason
      qc.invalidateQueries({ queryKey: ["projects"] });
      const msg =
        (err as { response?: { data?: { detail?: string; message?: string } } })
          ?.response?.data?.detail ||
        (err as { response?: { data?: { detail?: string; message?: string } } })
          ?.response?.data?.message ||
        "Failed to update task";
      toast.error(msg);
    },
  });
}

export function useDeleteTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/projects/${id}`);
    },
    onSuccess() {
      qc.invalidateQueries({ queryKey: ["projects"] });
      toast.success("Task deleted");
    },
    onError() {
      toast.error("Failed to delete task");
    },
  });
}
