"use client";

/**
 * Task projects — the optional "Project" (ad account) on a task.
 * Backend: GET /api/v1/task-projects (services/task_project_service.py).
 * A short, rarely-changing list: cached for 10 minutes.
 */
import { useQuery } from "@tanstack/react-query";
import api from "@/lib/axios";

export type ProjectPlatform = "meta" | "google" | "snapchat";

export interface TaskProject {
  id: string;
  name: string;
  platform: ProjectPlatform | string;
  /** Display group (the list is shown in groups, in order). */
  group: number;
}

export function useTaskProjects(enabled = true) {
  return useQuery({
    queryKey: ["task-projects"],
    queryFn: async () =>
      (await api.get<{ success: boolean; data: TaskProject[] }>("/task-projects")).data.data,
    enabled,
    staleTime: 10 * 60_000,
  });
}
