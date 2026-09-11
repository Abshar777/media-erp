"use client";

import { useState, useEffect, useRef } from "react";
import {
  DndContext,
  DragEndEvent,
  DragOverEvent,
  DragOverlay,
  DragStartEvent,
  MouseSensor,
  TouchSensor,
  closestCenter,
  pointerWithin,
  defaultDropAnimationSideEffects,
  useSensor,
  useSensors,
  useDroppable,
  type DropAnimation,
  type CollisionDetection,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { AnimatePresence, motion } from "framer-motion";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { useUpdateTask } from "@/hooks/useProjects";
import { KanbanCard } from "./KanbanCard";
import { AddTaskModal } from "./AddTaskModal";
import { ApproveRouteModal, ReeditModal } from "./ReviewActionModals";
import { toast } from "sonner";
import { useCanApprove } from "@/hooks/useCanApprove";
import type { Task, TaskStatus, BoardColumn } from "@/types/project";
import { BOARD_COLUMNS, statusStyles, canTransition } from "@/types/project";

const dropAnimation: DropAnimation = {
  duration: 200,
  easing: "cubic-bezier(0.2, 0, 0, 1)",
  sideEffects: defaultDropAnimationSideEffects({
    styles: { active: { opacity: "0" } },
  }),
};

const COL_KEYS = BOARD_COLUMNS.map((c) => c.key);

function resolveColumn(id: string, tasks: Task[]): TaskStatus | null {
  if (COL_KEYS.includes(id)) return id as TaskStatus;
  return tasks.find((t) => t.id === id)?.status ?? null;
}

// Pointer-within first so the column the mouse is INSIDE always wins.
// Fall back to closestCenter only when pointer isn't inside any droppable
// (e.g. dragging fast between columns).
const kanbanCollision: CollisionDetection = (args) => {
  const inside = pointerWithin(args);
  if (inside.length > 0) return inside;
  return closestCenter(args);
};

// ── Column ────────────────────────────────────────────────────────────────────
interface ColumnProps {
  column:        BoardColumn;
  tasks:         Task[];
  /** Server-side totals for this column (loaded vs total). */
  colMeta?:      { total: number; loaded: number; hasMore: boolean };
  onLoadMore?:   () => void;
  /** User is hovering here right now AND it's a valid target */
  isOver:        boolean;
  /** This column is a valid drop target for the current drag */
  isValidTarget: boolean;
  /** This is where the drag originated */
  isSource:      boolean;
  onAdd:         () => void;
}

function KanbanColumn({ column, tasks, isOver, isValidTarget, isSource, onAdd, colMeta, onLoadMore }: ColumnProps) {
  const { setNodeRef } = useDroppable({ id: column.key });
  const s = statusStyles(column.color);

  return (
    <div className="flex w-full flex-col md:flex-1 md:min-w-[200px] md:h-full md:min-h-0">
      {/* Header */}
      <div
        className={cn(
          "rounded-t-xl border border-b-0 px-3 py-2.5 flex items-center justify-between transition-opacity duration-200",
          isSource && "opacity-50"
        )}
        style={{ ...s.headerBg, borderTop: `2px solid ${column.color}` }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="size-2 rounded-full shrink-0" style={s.dot} />
          <span className="text-[11px] font-bold uppercase tracking-wider truncate" style={s.text}>
            {column.label}
          </span>
          <span
            className="flex h-4 min-w-4 px-1 items-center justify-center rounded-full text-[10px] font-bold shrink-0"
            style={s.badgeBg}
          >
            {colMeta?.total ?? tasks.length}
          </span>
        </div>
        {column.key === "pending" && (
          <button
            onClick={onAdd}
            className="rounded-md p-1 opacity-70 hover:opacity-100 hover:bg-white/30 dark:hover:bg-black/20 transition-all"
            style={s.text}
            title="Add task"
          >
            <Plus className="size-3.5" />
          </button>
        )}
      </div>

      {/* Drop zone */}
      <div
        ref={setNodeRef}
        className={cn(
          "no-scrollbar flex flex-col gap-2 rounded-b-xl border border-t-0 p-1.5",
          "overflow-y-auto overflow-x-hidden [overscroll-behavior:contain]",
          // Bound the height explicitly at every breakpoint. Relying on the
          // h-full chain meant that when no ancestor had a definite height the
          // columns grew to fit ALL cards, making the whole page scroll instead
          // of each column scrolling internally.
          "max-h-[60vh] md:max-h-[calc(100vh-23rem)] md:flex-1 md:min-h-0",
          "transition-all duration-200",
          // Active hover on valid target: strong ring + bright bg
          isOver        && "ring-2 ring-inset shadow-inner",
          // Valid target but not hovered: soft pulse ring
          isValidTarget && !isOver && "ring-1 ring-inset opacity-90",
          // Source column: dim it
          isSource      && "opacity-40",
        )}
        style={{
          backgroundColor: isOver
            ? `${column.color}22`
            : isValidTarget
            ? `${column.color}10`
            : `${column.color}07`,
          borderColor: isOver
            ? `${column.color}88`
            : isValidTarget
            ? `${column.color}55`
            : `${column.color}33`,
          ...(isOver        ? { ringColor: column.color } : {}),
          ...(isValidTarget && !isOver ? { ringColor: `${column.color}66` } : {}),
        }}
      >
        <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          <AnimatePresence initial={false}>
            {tasks.map((task) => (
              <motion.div
                key={task.id}
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.12 } }}
                transition={{ type: "spring", stiffness: 350, damping: 28 }}
              >
                <KanbanCard task={task} />
              </motion.div>
            ))}
          </AnimatePresence>
        </SortableContext>

        {colMeta?.hasMore && (
          <button
            type="button"
            onClick={onLoadMore}
            className="mt-1 w-full rounded-lg border border-dashed py-2 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
          >
            Load more · showing {colMeta.loaded} of {colMeta.total}
          </button>
        )}

        {tasks.length === 0 && (
          <div
            className={cn(
              "flex flex-1 items-center justify-center rounded-lg border border-dashed p-6 transition-colors duration-200",
              isOver
                ? "border-current bg-current/5"
                : isValidTarget
                ? "border-current/40"
                : "border-muted-foreground/12"
            )}
            style={isOver || isValidTarget ? { color: column.color } : {}}
          >
            <p className="text-[11px] text-center whitespace-pre-line"
               style={{ color: isOver ? column.color : isValidTarget ? `${column.color}88` : undefined }}>
              {isOver ? "Drop here" : isValidTarget ? "Valid target" : "No tasks\nclick + to add"}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Board ─────────────────────────────────────────────────────────────────────
export function KanbanBoard({
  tasks,
  columnMeta,
  onLoadMore,
}: {
  tasks: Task[];
  columnMeta?: Record<string, { total: number; loaded: number; hasMore: boolean }>;
  onLoadMore?: (status: string) => void;
}) {
  const updateTask = useUpdateTask();
  const canApprove = useCanApprove();

  const [localTasks,   setLocalTasks]   = useState<Task[]>(tasks);
  const [activeTask,   setActiveTask]   = useState<Task | null>(null);
  const [overColumnId, setOverColumnId] = useState<TaskStatus | null>(null);
  const [addOpen,      setAddOpen]      = useState(false);
  const [addStatus,    setAddStatus]    = useState<TaskStatus>("pending");
  // A pending_review exit is confirmed in a modal, never by the drop itself.
  const [reviewAction, setReviewAction] = useState<
    { task: Task; to: "approved" | "reedit" } | null
  >(null);

  const draggingRef = useRef(false);
  const serverRef   = useRef(tasks);
  serverRef.current = tasks;

  // Server data that lands MID-DRAG must not be thrown away. Previously this
  // effect simply skipped the update while dragging and never retried, so any
  // task created during a drag stayed invisible until the next refetch — tasks
  // appeared to go missing. We now record that a sync was missed and apply it
  // as soon as the drag finishes (see syncFromServer).
  const pendingSyncRef = useRef(false);

  useEffect(() => {
    if (draggingRef.current) {
      pendingSyncRef.current = true;   // defer, don't drop
      return;
    }
    setLocalTasks(tasks);
  }, [tasks]);

  /** Re-apply the authoritative server list once a drag ends. */
  function syncFromServer() {
    if (pendingSyncRef.current) {
      pendingSyncRef.current = false;
      setLocalTasks(serverRef.current);
    }
  }

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 3 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } })
  );

  function onDragStart({ active }: DragStartEvent) {
    draggingRef.current = true;
    const task = localTasks.find((t) => t.id === active.id);
    setActiveTask(task ?? null);
    setOverColumnId(task?.status ?? null);
  }

  function onDragOver({ over }: DragOverEvent) {
    if (!over) { setOverColumnId(null); return; }
    const col = resolveColumn(String(over.id), localTasks);
    if (col) setOverColumnId(col);
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    draggingRef.current = false;
    const draggedTask = activeTask;
    setActiveTask(null);
    setOverColumnId(null);

    if (!over || !draggedTask) { syncFromServer(); return; }

    const activeId     = String(active.id);
    const overId       = String(over.id);
    if (activeId === overId) { syncFromServer(); return; }

    const targetStatus = resolveColumn(overId, localTasks);
    if (!targetStatus) { syncFromServer(); return; }

    // Same column — local reorder only
    if (targetStatus === draggedTask.status) {
      setLocalTasks((prev) => {
        const from = prev.findIndex((t) => t.id === activeId);
        const to   = prev.findIndex((t) => t.id === overId);
        if (from === -1 || to === -1 || from === to) return prev;
        return arrayMove(prev, from, to);
      });
      return;
    }

    // Cross-column — validate the 5 allowed transitions
    if (!canTransition(draggedTask.status, targetStatus)) {
      toast.error(`Cannot move from ${draggedTask.status.replace(/_/g, " ")} to ${targetStatus.replace(/_/g, " ")}.`);
      syncFromServer();
      return;
    }

    if (draggedTask.status === "pending_review" && !canApprove(draggedTask)) {
      toast.error("Only a team leader can move tasks out of Pending Review.");
      syncFromServer();
      return;
    }

    // Leaving pending_review needs a decision (route the approval / give a
    // reedit reason), so hand off to the modal rather than committing the drop.
    // Snap the card back first — the modal's mutation is what moves it.
    if (draggedTask.status === "pending_review") {
      syncFromServer();
      setReviewAction({ task: draggedTask, to: targetStatus as "approved" | "reedit" });
      return;
    }

    // Optimistic update. If a server sync was deferred during the drag, start
    // from that fresh list (so tasks added mid-drag appear) and re-apply the
    // optimistic status on top — rather than discarding either one.
    setLocalTasks((prev) => {
      const base = pendingSyncRef.current ? serverRef.current : prev;
      pendingSyncRef.current = false;
      return base.map((t) => (t.id === activeId ? { ...t, status: targetStatus } : t));
    });

    updateTask.mutate(
      { id: activeId, payload: { status: targetStatus } },
      {
        onError: () => {
          pendingSyncRef.current = false;
          setLocalTasks(serverRef.current);
          toast.error("Failed to update task.");
        },
      }
    );
  }

  function onDragCancel() {
    draggingRef.current = false;
    pendingSyncRef.current = false;
    setActiveTask(null);
    setOverColumnId(null);
    setLocalTasks(serverRef.current);
  }

  return (
    <>
      <DndContext
        sensors={sensors}
        collisionDetection={kanbanCollision}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={onDragCancel}
      >
        {/* Phones stack the columns vertically (a 6-column horizontal strip is
            unusable at 375px); from md up it becomes the classic side-by-side
            board that scrolls horizontally. */}
        <div className="no-scrollbar flex flex-col gap-3 pt-1 pb-1 select-none
                        md:h-full md:min-h-0 md:flex-row md:overflow-x-auto
                        [overscroll-behavior:contain]">
          {BOARD_COLUMNS.map((col) => {
            const isSource      = activeTask?.status === col.key;
            const isValidTarget = activeTask !== null
              && !isSource
              && canTransition(activeTask.status, col.key);
            const isOver        = overColumnId === col.key && isValidTarget;

            return (
              <KanbanColumn
                key={col.key}
                column={col}
                tasks={localTasks.filter((t) => t.status === col.key)}
                colMeta={columnMeta?.[col.key]}
                onLoadMore={() => onLoadMore?.(col.key)}
                isOver={isOver}
                isValidTarget={isValidTarget}
                isSource={isSource}
                onAdd={() => { setAddStatus(col.key); setAddOpen(true); }}
              />
            );
          })}
        </div>

        <DragOverlay dropAnimation={dropAnimation}>
          {activeTask ? <KanbanCard task={activeTask} overlay /> : null}
        </DragOverlay>
      </DndContext>

      <AddTaskModal open={addOpen} onClose={() => setAddOpen(false)} defaultStatus={addStatus} />

      <AnimatePresence>
        {reviewAction?.to === "approved" && (
          <ApproveRouteModal task={reviewAction.task} onClose={() => setReviewAction(null)} />
        )}
        {reviewAction?.to === "reedit" && (
          <ReeditModal task={reviewAction.task} onClose={() => setReviewAction(null)} />
        )}
      </AnimatePresence>
    </>
  );
}
