"use client";

import { useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, PauseCircle, Timer, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDeleteTask, useUpdateTask } from "@/hooks/useProjects";
import { useCanApprove } from "@/hooks/useCanApprove";
import type { Task, TaskStatus } from "@/types/project";
import { BOARD_COLUMNS, PRIORITY_META, allowedColumns } from "@/types/project";
import { useTaskTimer, formatSeconds, formatSecondsHMS } from "@/hooks/useTaskTimer";
import { TaskDetailModal } from "./TaskDetailModal";
import { VerificationBadge } from "./VerificationBadge";
import { ApproveRouteModal, ReeditModal, SubmitReviewModal } from "./ReviewActionModals";

interface Props {
  task: Task;
  overlay?: boolean;
}

export function KanbanCard({ task, overlay = false }: Props) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition: isDragging ? "none" : transition ?? "transform 200ms ease",
    // `touch-action: none` was applied unconditionally, which killed BOTH scroll
    // axes on phones: cards cover the screen, so nearly every touch started on a
    // card and the browser was told never to scroll from it. The board uses a
    // TouchSensor with a delay activation constraint, so dnd-kit only needs to
    // suppress touch scrolling *while actually dragging* — before that the user
    // must be free to pan. ("manipulation" = allow pan/pinch, no double-tap zoom.)
    touchAction: isDragging ? "none" : "manipulation",
    willChange: "transform",
  };

  const deleteTask  = useDeleteTask();
  const updateTask  = useUpdateTask();
  const canApprove  = useCanApprove();

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [detailOpen,    setDetailOpen]    = useState(false);

  const { seconds, isRunning, isCompleted, hasTimer, pauseCount } =
    useTaskTimer(task);

  const reviewLocked =
    task.status === "pending_review" && !canApprove(task);

  const statusOptions = reviewLocked
    ? BOARD_COLUMNS.filter((c) => c.key === "pending_review")
    : allowedColumns(task.status);

  const meta       = PRIORITY_META[task.priority] ?? PRIORITY_META.medium;
  const col        = BOARD_COLUMNS.find((c) => c.key === task.status);
  const accentColor = col?.color ?? "#64748b";

  // Leaving pending_review is a decision (route the approval / give a reedit
  // reason) — confirm it in the same modal the Leader Desk uses.
  const [reviewTo, setReviewTo] = useState<"approved" | "reedit" | null>(null);
  // Entering review needs a note (the server rejects one without), so the
  // dropdown opens the submit form rather than firing an update that fails.
  const [submitOpen, setSubmitOpen] = useState(false);

  function handleStatusChange(s: TaskStatus) {
    if (task.status === "pending_review" && (s === "approved" || s === "reedit")) {
      setReviewTo(s);
      return;
    }
    if (s === "pending_review") {
      setSubmitOpen(true);
      return;
    }
    updateTask.mutate({ id: task.id, payload: { status: s } });
  }

  // Ghost placeholder while dragging
  if (isDragging && !overlay) {
    return (
      <div
        ref={setNodeRef}
        style={style}
        className="h-[76px] rounded-xl border-2 border-dashed border-primary/20 bg-primary/[0.03]"
        aria-hidden="true"
      />
    );
  }

  return (
    <div
      ref={setNodeRef}
      style={{
        ...style,
        borderLeft: `3px solid ${accentColor}70`,
      }}
      {...attributes}
      {...listeners}
      className={cn(
        "group relative rounded-xl border bg-card px-3 py-2.5 shadow-sm select-none",
        "cursor-grab active:cursor-grabbing",
        "transition-[box-shadow,border-color] duration-150",
        overlay
          ? "shadow-2xl rotate-[1deg] scale-[1.03] ring-2 ring-primary/30 cursor-grabbing"
          : "hover:shadow-md hover:border-primary/25",
      )}
    >
      {/* ── Row 1: grip · title · priority · delete ── */}
      <div className="flex items-center gap-1.5 min-w-0">
        <GripVertical
          className="size-3.5 shrink-0 text-muted-foreground/20 pointer-events-none"
        />

        {/* Title — click opens detail modal; no stopPropagation so drag still
            works from this area (DnD activationConstraint.distance handles
            distinguishing a click from a drag without blocking either). */}
        <button
          onClick={(e) => { e.stopPropagation(); setDetailOpen(true); }}
          className="flex-1 min-w-0 text-left"
          title="View task details"
        >
          <p className="text-[13px] font-semibold leading-snug text-foreground truncate hover:text-primary transition-colors">
            {task.title}
          </p>
        </button>

        <span
          className={cn(
            "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
            meta.color
          )}
        >
          {meta.label}
        </span>

        {/* Delete — appears on hover */}
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            if (confirmDelete) {
              deleteTask.mutate(task.id);
              setConfirmDelete(false);
            } else {
              setConfirmDelete(true);
              setTimeout(() => setConfirmDelete(false), 2500);
            }
          }}
          className={cn(
            "shrink-0 rounded-md p-1 opacity-0 group-hover:opacity-100 transition-all",
            confirmDelete
              ? "bg-red-100 text-red-600 dark:bg-red-900/50 dark:text-red-400 opacity-100"
              : "text-muted-foreground/40 hover:text-destructive hover:bg-destructive/10"
          )}
          title={confirmDelete ? "Click again to confirm delete" : "Delete task"}
        >
          <Trash2 className="size-3" />
        </button>
      </div>

      {/* ── Row 2: verification standing ──
          On its own line rather than beside the title: the title is the one
          thing that must always be readable, and a badge sharing that row
          squeezed it to nothing on narrow columns. */}
      <div className="pl-5 mt-1.5 empty:hidden">
        <VerificationBadge task={task} compact />
      </div>

      {/* ── Row 3: timer · pause count ── */}
      {hasTimer && (
        <div className="flex items-center gap-2.5 pl-5 mt-1.5">
          {isRunning ? (
            /* Live HH:MM:SS stopwatch — only on Started cards */
            <div className="flex items-center gap-1.5">
              <span className="size-1.5 shrink-0 rounded-full bg-blue-500 animate-pulse" />
              <span className="text-[12px] font-bold font-mono tabular-nums tracking-wider text-blue-500">
                {formatSecondsHMS(seconds)}
              </span>
            </div>
          ) : (
            /* Compact h/m/s display for Break, Approved, etc. — unchanged */
            <div
              className={cn(
                "flex items-center gap-1 text-[11px] font-medium tabular-nums",
                isCompleted ? "text-green-600 dark:text-green-400" : "text-muted-foreground"
              )}
            >
              <Timer className="size-3" />
              <span>{formatSeconds(seconds)}</span>
            </div>
          )}

          {pauseCount > 0 && (
            <div
              className="flex items-center gap-1 text-[11px] text-muted-foreground"
              title={`Paused ${pauseCount} time${pauseCount !== 1 ? "s" : ""}`}
            >
              <PauseCircle className="size-3" />
              <span>{pauseCount}</span>
            </div>
          )}
        </div>
      )}

      {/* ── Reedit reason — shown so member knows what to fix ── */}
      {task.status === "reedit" && task.reedit_reason && (
        <div className="ml-5 mt-1.5 rounded-md border border-rose-400/30 bg-rose-500/10 px-2 py-1">
          <p className="text-[10px] font-semibold text-rose-600 dark:text-rose-400 mb-0.5">
            Sent to reedit
          </p>
          <p className="text-[11px] text-foreground/70 leading-snug line-clamp-2">
            {task.reedit_reason}
          </p>
        </div>
      )}

      {/* ── Status quick-switch ── */}
      <div className="pl-5 mt-2">
        <select
          value={task.status}
          onChange={(e) => handleStatusChange(e.target.value as TaskStatus)}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          disabled={reviewLocked}
          title={
            reviewLocked
              ? "Only a team leader can approve or rework this task"
              : undefined
          }
          style={{ color: accentColor }}
          className="w-full rounded-md border-0 bg-muted/50 px-2 py-1 text-[10px] font-semibold outline-none cursor-pointer hover:bg-muted transition-colors disabled:cursor-not-allowed disabled:opacity-60"
        >
          {statusOptions.map((c) => (
            <option key={c.key} value={c.key}>
              {c.label}
            </option>
          ))}
        </select>
      </div>

      {detailOpen && (
        <TaskDetailModal task={task} onClose={() => setDetailOpen(false)} />
      )}

      {reviewTo === "approved" && (
        <ApproveRouteModal task={task} onClose={() => setReviewTo(null)} />
      )}
      {reviewTo === "reedit" && (
        <ReeditModal task={task} onClose={() => setReviewTo(null)} />
      )}
      {submitOpen && (
        <SubmitReviewModal task={task} onClose={() => setSubmitOpen(false)} />
      )}
    </div>
  );
}
