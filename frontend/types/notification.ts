export type NotificationType =
  // ── Task workflow ─────────────────────────────────────────────────────────
  | "task_assigned"       // a task was assigned to you
  | "task_started"        // an employee started a task (→ leader)
  | "task_break"          // an employee paused a task (→ leader)
  | "pending_review"      // task submitted for review
  | "task_approved"       // task was approved
  | "task_reedit"         // task sent back for revision
  | "team_task_assigned"  // new task added to your team (→ leader)
  | "task_transferred"    // a task was handed to (or away from) you
  | "verify_requested"    // you were asked to verify a task
  | "verify_rejected"     // a verifier asked for changes on your task
  | "verify_passed"       // every verifier signed your task off
  | "due_date_reminder"   // task is due tomorrow
  // ── Chat ──────────────────────────────────────────────────────────────────
  | "mention"             // someone @mentioned you in a message
  // ── Data sync ─────────────────────────────────────────────────────────────
  | "sync_success"
  | "sync_error"
  // ── Generic ───────────────────────────────────────────────────────────────
  | "info";

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  read: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface NotificationsData {
  items: Notification[];
  unread_count: number;
}
