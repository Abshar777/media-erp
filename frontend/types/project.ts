import { istTodayKey } from "@/lib/datetime";
// Status is now a dynamic, user-defined Kanban column key (free-form string).
// The defaults are pending | upcoming | currently_working | updation_needed.
export type TaskStatus = string;

export type TaskPriority = "low" | "medium" | "high";

/** A customisable Kanban column, defined in the DB. */
export interface BoardStatus {
  id: string;
  key: string;
  label: string;
  color: string;     // hex
  position: number;
  is_default: boolean;
}

/** Build inline styles for a status column from its hex colour. */
export function statusStyles(color: string) {
  return {
    text:      { color },
    headerBg:  { backgroundColor: `${color}1a`, borderColor: `${color}40` }, // ~10% bg, ~25% border
    columnBg:  { backgroundColor: `${color}0d` },                             // ~5%
    badgeBg:   { backgroundColor: `${color}26`, color },                      // ~15%
    dot:       { backgroundColor: color },
    border:    { borderColor: `${color}59` },                                 // ~35%
  };
}

export type DateFilterOption =
  | ""
  | "today"
  | "this_week"
  | "this_month"
  | "this_year"
  | "custom";

export interface Attachment {
  url: string;
  key: string;
  filename: string;
  size: number;
  content_type: string;
  backend: string;
}

export interface TaskInterval {
  started_at: string;
  ended_at: string | null;
}

export interface TaskTiming {
  total_seconds: number | null;
  intervals?: TaskInterval[] | null;
  started_at?: string | null;
  approved_at?: string | null;
}

export type VerifyStatus = "pending" | "passed" | "rejected";

export interface TaskVerification {
  user_id: string;
  name: string;
  status: VerifyStatus;
  reason: string;
  at: string | null;
}

/** Verifiers who still have to sign off — what blocks approval. */
export function pendingVerifiers(task: Pick<Task, "verifications">): TaskVerification[] {
  return (task.verifications ?? []).filter((v) => v.status !== "passed");
}

export interface TaskHistoryEntry {
  action: string;
  actor_id: string;
  actor_name: string;
  timestamp: string;
  from_status?: string | null;
  to_status?: string | null;
  note?: string | null;
  team_id?: string;
  team_name?: string;
}

/** One "stop" in a task's cross-team journey (video → content → …). */
export interface TeamFlowStep {
  team_name: string;
  team_id?: string;
  outcome?: "approved" | "reedit" | "routed" | null;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  priority: TaskPriority;
  status: TaskStatus;
  assigned_to: string;
  assigned_to_name?: string;
  /** Named approver — may be any team member, not only a leader. Additive:
   *  the team's leaders can still approve. Mirrors workflow.can_approve. */
  approver_id?: string;
  approver_name?: string;
  due_date: string | null;
  team_id?: string | null;
  attachments?: Attachment[];
  reedit_reason?: string;
  caption?: string;
  former_assigned_to_name?: string;
  former_team_name?: string;
  /** Why the task was last handed to its current assignee. */
  transfer_reason?: string;
  /** Verifier selection, as chosen. Teams expand at pending_review. */
  verify_users?: string[];
  verify_teams?: string[];
  verify_instructions?: string;
  /** Resolved sign-off list, present once the task has entered review. */
  verifications?: TaskVerification[];
  created_by: string;
  created_at: string;
  updated_at: string;
  timing?: TaskTiming | null;
  history?: TaskHistoryEntry[];
  /** Full cross-team journey summary — only present on the detail endpoint. */
  team_flow?: TeamFlowStep[];
}

export interface CreateTaskPayload {
  title: string;
  description?: string;
  priority?: TaskPriority;
  status?: TaskStatus;
  assigned_to?: string;
  assigned_to_name?: string;
  due_date?: string | null;
  team_id?: string | null;
  attachments?: Attachment[];
  /** Named approver (leader/admin only — server rejects otherwise). */
  approver_id?: string;
  approver_name?: string;
}

export interface UpdateTaskPayload {
  title?: string;
  description?: string;
  priority?: TaskPriority;
  status?: TaskStatus;
  assigned_to?: string;
  assigned_to_name?: string;
  due_date?: string | null;
  team_id?: string | null;
  attachments?: Attachment[];
  reedit_reason?: string;
  destination_team_id?: string;
  /** Assign the routed copy to this specific person in the destination team.
   *  Backend: app/routers/projects.py (next_leader_id / next_leader_name). */
  next_leader_id?: string;
  next_leader_name?: string;
  /** Change who may approve THIS task (leader/admin only, server-enforced). */
  approver_id?: string;
  approver_name?: string;
  /** Who may approve the ROUTED COPY created in the destination team. */
  next_approver_id?: string;
  next_approver_name?: string;
  /** Hand this task to a teammate. Allowed from any status; never changes it.
   *  The reason is mandatory — the server rejects a blank one. */
  transfer_to_id?: string;
  transfer_to_name?: string;
  transfer_reason?: string;
  verify_users?: string[];
  verify_teams?: string[];
  verify_instructions?: string;
  caption?: string;
}

/** Display label for a task's assignee — prefers the denormalized name,
 *  falls back to the raw assigned_to (legacy data stored names there). */
export function assigneeLabel(task: Pick<Task, "assigned_to" | "assigned_to_name">): string {
  return task.assigned_to_name?.trim() || task.assigned_to || "";
}

export interface ProjectFilters {
  search: string;
  status: TaskStatus | "";
  priority: TaskPriority | "";
  date_filter: DateFilterOption;
  date_from: string;
  date_to: string;
  team_id?: string;
  member_id?: string;
  /** Quick scope chip: narrows to your own slice of the board. */
  scope?: TaskScope;
}

/** "" = no scope chip active (the normal, unnarrowed board). */
export type TaskScope = "" | "assigned_to_me" | "needs_my_approval" | "created_by_me";

export const TASK_SCOPES: { value: Exclude<TaskScope, "">; label: string }[] = [
  { value: "assigned_to_me",    label: "Assigned to me" },
  { value: "needs_my_approval", label: "Needs my approval" },
  { value: "created_by_me",     label: "Created by me" },
];

// ── Fixed Kanban columns ────────────────────────────────────────────────────
// The board has exactly these 5 columns. Names/colours/order are fixed —
// no add / edit / delete. Keys are the values stored in task.status.
export interface BoardColumn {
  key: string;
  label: string;
  color: string; // hex
}

export const BOARD_COLUMNS: BoardColumn[] = [
  { key: "pending",        label: "Pending",        color: "#f59e0b" }, // amber
  { key: "started",        label: "Started",        color: "#3b82f6" }, // blue
  { key: "break",          label: "Break",          color: "#f97316" }, // orange
  { key: "reedit",         label: "Reedit",         color: "#f43f5e" }, // rose — sent back for changes
  { key: "pending_review", label: "Pending Review", color: "#a855f7" }, // purple
  { key: "approved",       label: "Approved",       color: "#22c55e" }, // green
];

/** The terminal "done" column. */
export const DONE_STATUS = "approved";

// ── Workflow state machine (mirrors the backend) ─────────────────────────────
//  pending -> started -> (break) -> pending_review -> approved
//                          \-> reedit <-/ (leader sends back) -> started
export const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  pending:        ["started"],
  started:        ["break", "pending_review"],
  break:          ["started"],
  reedit:         ["started"],               // member picks the rework back up
  pending_review: ["approved", "reedit"],    // approve / send-to-reedit — leader only (server-enforced)
  approved:       [],
};

export function canTransition(from: string, to: string): boolean {
  if (from === to) return true;
  return (ALLOWED_TRANSITIONS[from] ?? []).includes(to);
}

/** Columns selectable from a status: the current column plus its valid targets,
 *  returned in board order. */
export function allowedColumns(from: string): BoardColumn[] {
  return BOARD_COLUMNS.filter((c) => c.key === from || canTransition(from, c.key));
}

/**
 * A task is overdue when its due date is in the past AND it isn't done
 * (i.e. not in the Approved column).
 */
/** Overdue once the IST calendar day *after* the due date has begun.
 *  due_date is a date-only "YYYY-MM-DD" value, so compare IST date keys —
 *  never Date#setHours(), which uses the browser's timezone. */
export function isTaskOverdue(task: Pick<Task, "due_date" | "status">): boolean {
  if (!task.due_date) return false;
  if (task.status === DONE_STATUS) return false;
  return String(task.due_date).slice(0, 10) < istTodayKey();
}

export const PRIORITY_META: Record<TaskPriority, { label: string; color: string }> = {
  low:    { label: "Low",    color: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300" },
  medium: { label: "Medium", color: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300" },
  high:   { label: "High",   color: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" },
};
