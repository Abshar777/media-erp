"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AlertTriangle, ArrowUpDown, Calendar, Paperclip, Trash2, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDeleteTask, useUpdateTask } from "@/hooks/useProjects";
import type { Task, TaskPriority, TaskStatus } from "@/types/project";
import { BOARD_COLUMNS, PRIORITY_META, isTaskOverdue, assigneeLabel, statusStyles, allowedColumns } from "@/types/project";
import { listItemVariants, listVariants } from "@/lib/animations";
import { fmtDate, fmtDateOnly } from "@/lib/datetime";
import { useCanApprove } from "@/hooks/useCanApprove";
import { ApproveRouteModal, ReeditModal, SubmitReviewModal } from "./ReviewActionModals";
import { VerificationBadge } from "./VerificationBadge";
import { toast } from "sonner";

type SortKey = "title" | "status" | "priority" | "due_date" | "created_at";

interface Props { tasks: Task[] }

export function TaskTable({ tasks }: Props) {
  const [sortKey, setSortKey]   = useState<SortKey>("created_at");
  const [sortAsc, setSortAsc]   = useState(false);
  const updateTask  = useUpdateTask();
  const deleteTask  = useDeleteTask();
  const statuses = BOARD_COLUMNS;
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const canApprove = useCanApprove();
  // Leaving pending_review is confirmed in a modal, as on the board.
  const [reviewAction, setReviewAction] = useState<
    { task: Task; to: "approved" | "reedit" } | null
  >(null);
  const [submitFor, setSubmitFor] = useState<Task | null>(null);

  function changeStatus(task: Task, next: TaskStatus) {
    if (task.status === "pending_review" && (next === "approved" || next === "reedit")) {
      if (!canApprove(task)) {
        toast.error("Only a team leader can move tasks out of Pending Review.");
        return;
      }
      setReviewAction({ task, to: next });
      return;
    }
    // Entering review needs a note — ask for it rather than firing an update
    // the server will reject.
    if (next === "pending_review") {
      setSubmitFor(task);
      return;
    }
    updateTask.mutate({ id: task.id, payload: { status: next } });
  }

  function toggleSort(k: SortKey) {
    if (k === sortKey) setSortAsc(p => !p);
    else { setSortKey(k); setSortAsc(true); }
  }

  const sorted = [...tasks].sort((a, b) => {
    let av = a[sortKey] ?? "";
    let bv = b[sortKey] ?? "";
    const cmp = String(av).localeCompare(String(bv));
    return sortAsc ? cmp : -cmp;
  });

  function Th({ k, label }: { k: SortKey; label: string }) {
    return (
      <th
        onClick={() => toggleSort(k)}
        className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground cursor-pointer select-none hover:text-foreground transition-colors"
      >
        <div className="flex items-center gap-1">
          {label}
          <ArrowUpDown className={cn("size-3", sortKey === k ? "text-primary" : "opacity-40")} />
        </div>
      </th>
    );
  }

  function handleDelete(id: string) {
    if (confirmId === id) {
      deleteTask.mutate(id);
      setConfirmId(null);
    } else {
      setConfirmId(id);
      setTimeout(() => setConfirmId(prev => prev === id ? null : prev), 2500);
    }
  }

  if (tasks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
        <p className="text-sm">No tasks found</p>
        <p className="text-xs mt-1">Add a task or adjust your filters</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border overflow-hidden">
      <table className="w-full">
        <thead className="bg-muted/40 border-b">
          <tr>
            <Th k="title" label="Title" />
            <Th k="status" label="Status" />
            <Th k="priority" label="Priority" />
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Assigned To
            </th>
            <Th k="due_date" label="Due Date" />
            <Th k="created_at" label="Created" />
            <th className="px-4 py-3 w-10" />
          </tr>
        </thead>
        <tbody>
          <AnimatePresence initial={false}>
            {sorted.map((task, i) => {
              const col = statuses.find(c => c.key === task.status);
              const colStyle = col ? statusStyles(col.color).badgeBg : undefined;
              const pri = PRIORITY_META[task.priority];
              const isOverdue = isTaskOverdue(task);
              const attachmentCount = task.attachments?.length ?? 0;

              return (
                <motion.tr
                  key={task.id}
                  layout
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15, delay: i * 0.02 }}
                  className={cn(
                    "border-b last:border-0 hover:bg-muted/30 transition-colors group",
                    isOverdue && "bg-red-50/40 dark:bg-red-950/15"
                  )}
                >
                  {/* Title + description */}
                  <td className="px-4 py-3 max-w-[240px]">
                    <div className="flex items-center gap-1.5">
                      <p className="text-sm font-medium truncate">{task.title}</p>
                      {attachmentCount > 0 && (
                        <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground shrink-0">
                          <Paperclip className="size-3" />{attachmentCount}
                        </span>
                      )}
                      <VerificationBadge task={task} compact />
                    </div>
                    {task.description && (
                      <p className="text-[11px] text-muted-foreground truncate mt-0.5">{task.description}</p>
                    )}
                  </td>

                  {/* Status */}
                  <td className="px-4 py-3">
                    <select
                      value={task.status}
                      onChange={e => changeStatus(task, e.target.value as TaskStatus)}
                      style={colStyle}
                      className="rounded-full px-2 py-0.5 text-[11px] font-semibold border-0 outline-none cursor-pointer"
                    >
                      {allowedColumns(task.status).map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                    </select>
                  </td>

                  {/* Priority */}
                  <td className="px-4 py-3">
                    <select
                      value={task.priority}
                      onChange={e =>
                        updateTask.mutate({ id: task.id, payload: { priority: e.target.value as TaskPriority } })
                      }
                      className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold border-0 outline-none cursor-pointer", pri.color)}
                    >
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                    </select>
                  </td>

                  {/* Assigned to */}
                  <td className="px-4 py-3">
                    {assigneeLabel(task) ? (
                      <div className="flex items-center gap-1.5">
                        <div className="flex size-5 items-center justify-center rounded-full bg-primary/10 text-primary font-bold text-[9px]">
                          {assigneeLabel(task)[0]?.toUpperCase()}
                        </div>
                        <span className="text-xs text-muted-foreground">{assigneeLabel(task)}</span>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground/40">—</span>
                    )}
                  </td>

                  {/* Due date */}
                  <td className="px-4 py-3">
                    {task.due_date ? (
                      <span className={cn("flex items-center gap-1 text-xs", isOverdue ? "text-red-500 font-semibold" : "text-muted-foreground")}>
                        {isOverdue ? <AlertTriangle className="size-3" /> : <Calendar className="size-3" />}
                        {fmtDateOnly(task.due_date, { day: "numeric", month: "short", year: "numeric" })}
                        {isOverdue && <span className="ml-1 rounded-full bg-red-100 px-1.5 py-0.5 text-[9px] font-bold text-red-600 dark:bg-red-900/50 dark:text-red-400">OVERDUE</span>}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground/40">—</span>
                    )}
                  </td>

                  {/* Created at */}
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {fmtDate(task.created_at, { day: "numeric", month: "short" })}
                  </td>

                  {/* Delete */}
                  <td className="px-4 py-3">
                    <button
                      onClick={() => handleDelete(task.id)}
                      className={cn(
                        "rounded-md p-1.5 opacity-0 group-hover:opacity-100 transition-all",
                        confirmId === task.id
                          ? "bg-red-100 text-red-600 dark:bg-red-900/50 opacity-100"
                          : "text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10"
                      )}
                      title={confirmId === task.id ? "Click again to confirm" : "Delete"}
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </td>
                </motion.tr>
              );
            })}
          </AnimatePresence>
        </tbody>
      </table>

      <AnimatePresence>
        {reviewAction?.to === "approved" && (
          <ApproveRouteModal task={reviewAction.task} onClose={() => setReviewAction(null)} />
        )}
        {submitFor && (
          <SubmitReviewModal task={submitFor} onClose={() => setSubmitFor(null)} />
        )}
        {reviewAction?.to === "reedit" && (
          <ReeditModal task={reviewAction.task} onClose={() => setReviewAction(null)} />
        )}
      </AnimatePresence>
    </div>
  );
}
