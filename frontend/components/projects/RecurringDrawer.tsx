"use client";

/**
 * RecurringDrawer — manage repeating tasks (opened from the Projects header).
 *
 * Each series shows its pattern, people, progress and next date, with
 * Pause / Resume, Stop (two-step) and Edit. Edit changes FUTURE copies only —
 * copies already created are never altered, which the UI says out loud.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Pause, Pencil, Play, Repeat, Square, X, AlertTriangle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useRecurringList, useUpdateRecurring } from "@/hooks/useRecurring";
import { useAssignableUsers } from "@/hooks/useTeams";
import { UserPicker } from "@/components/teams/UserPicker";
import { DUE_OFFSET_OPTIONS, describePattern, shortDateWithDay, addDays } from "@/lib/recurrence";
import { istTodayKey } from "@/lib/datetime";
import type { RecurringSeries, TaskPriority } from "@/types/project";

const STATUS_META: Record<RecurringSeries["status"], { label: string; cls: string }> = {
  active:    { label: "Active",    cls: "bg-green-500/10 text-green-600 dark:text-green-400" },
  paused:    { label: "Paused",    cls: "bg-amber-500/10 text-amber-600 dark:text-amber-400" },
  completed: { label: "Finished",  cls: "bg-slate-500/10 text-slate-600 dark:text-slate-400" },
  stopped:   { label: "Stopped",   cls: "bg-slate-500/10 text-slate-600 dark:text-slate-400" },
};

function nextLabel(iso: string | null): string {
  if (!iso) return "—";
  const today = istTodayKey();
  if (iso === today) return "today";
  if (iso === addDays(today, 1)) return "tomorrow";
  return shortDateWithDay(iso);
}

const initials = (name: string) =>
  (name || "?").split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();

interface Props {
  open: boolean;
  onClose: () => void;
  /** Series to highlight and scroll to (from ?repeating=<id>). */
  focusId?: string | null;
}

export function RecurringDrawer({ open, onClose, focusId }: Props) {
  const { data: series = [], isLoading } = useRecurringList(open);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const counts = useMemo(() => ({
    active: series.filter((s) => s.status === "active").length,
    paused: series.filter((s) => s.status === "paused").length,
  }), [series]);

  if (!mounted) return null;
  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="recurring-backdrop"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px]"
            onClick={onClose}
          />
          <motion.aside
            key="recurring-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Repeating tasks"
            initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 380, damping: 36 }}
            className="fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l bg-card shadow-2xl sm:w-[440px]"
          >
            <header className="flex items-center justify-between border-b px-5 py-4">
              <div>
                <h2 className="flex items-center gap-2 text-base font-semibold">
                  <Repeat className="size-4 text-primary" /> Repeating tasks
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {counts.active} active{counts.paused ? ` · ${counts.paused} paused` : ""} · changes apply to future copies only
                </p>
              </div>
              <button onClick={onClose} className="rounded-md p-1.5 hover:bg-muted" aria-label="Close">
                <X className="size-4 text-muted-foreground" />
              </button>
            </header>

            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              {isLoading ? (
                <div className="flex justify-center py-12"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
              ) : series.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-14 text-center text-muted-foreground">
                  <Repeat className="size-8 opacity-30" />
                  <p className="text-sm font-medium text-foreground">No repeating tasks yet</p>
                  <p className="max-w-[260px] text-xs">
                    When you add a task, choose <b>Daily</b>, <b>Weekly</b> or <b>Monthly</b> under Repeat.
                  </p>
                </div>
              ) : (
                series.map((s) => <SeriesCard key={s.id} s={s} focused={s.id === focusId} />)
              )}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>,
    document.body
  );
}

function SeriesCard({ s, focused }: { s: RecurringSeries; focused: boolean }) {
  const update = useUpdateRecurring();
  const [confirmStop, setConfirmStop] = useState(false);
  const [editing, setEditing] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const ended = s.status === "completed" || s.status === "stopped";

  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focused]);

  const pct = s.occurrences_total ? Math.round((s.occurrences_done / s.occurrences_total) * 100) : null;
  const meta = STATUS_META[s.status];
  const busy = update.isPending;

  return (
    <div
      ref={ref}
      className={cn(
        "rounded-xl border bg-background p-3.5 transition-shadow",
        focused && "ring-2 ring-primary/50",
        ended && "opacity-70"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 truncate text-sm font-semibold" title={s.title}>{s.title}</p>
        <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold", meta.cls)}>{meta.label}</span>
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <span className="flex -space-x-1.5">
          {s.assignees.slice(0, 4).map((a) => (
            <span key={a.id} title={a.name}
              className="flex size-5 items-center justify-center rounded-full border-2 border-background bg-primary/15 text-[8px] font-bold text-primary">
              {initials(a.name)}
            </span>
          ))}
        </span>
        <span className="truncate">
          {s.assignees.map((a) => a.name.split(" ")[0]).slice(0, 3).join(", ")}
          {s.assignees.length > 3 ? ` +${s.assignees.length - 3}` : ""}
        </span>
        <span>·</span>
        <span>{describePattern(s.frequency, s.anchor_date, s.month_day)}</span>
        {s.status === "active" && <><span>·</span><span>next: <b className="font-medium text-foreground">{nextLabel(s.next_date)}</b></span></>}
      </div>

      {/* Progress */}
      <div className="mt-2.5 flex items-center gap-2.5">
        {pct !== null ? (
          <>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
            </div>
            <span className="text-[11px] tabular-nums text-muted-foreground">{s.occurrences_done} / {s.occurrences_total}</span>
          </>
        ) : (
          <span className="text-[11px] text-muted-foreground">{s.occurrences_done} created · until stopped</span>
        )}
      </div>

      {s.status === "paused" && s.paused_reason && (
        <p className="mt-2 flex items-start gap-1.5 text-[11px] text-amber-600 dark:text-amber-400">
          <AlertTriangle className="mt-px size-3 shrink-0" /> {s.paused_reason}
        </p>
      )}
      {s.last_errors.length > 0 && s.status !== "paused" && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          Last run skipped: {s.last_errors.map((e) => s.assignees.find((a) => a.id === e.user_id)?.name || "someone").join(", ")}
          {" — "}{s.last_errors[0].message}
        </p>
      )}

      {/* Actions */}
      {!ended && !editing && (
        <div className="mt-3 flex items-center gap-1.5">
          {s.status === "active" ? (
            <ActionBtn icon={<Pause className="size-3" />} label="Pause" disabled={busy}
              onClick={() => update.mutate({ id: s.id, action: "pause" })} />
          ) : (
            <ActionBtn icon={<Play className="size-3" />} label="Resume" disabled={busy}
              onClick={() => update.mutate({ id: s.id, action: "resume" })} />
          )}
          <ActionBtn icon={<Pencil className="size-3" />} label="Edit" disabled={busy} onClick={() => setEditing(true)} />
          <div className="ml-auto">
            {confirmStop ? (
              <span className="flex items-center gap-1.5">
                <span className="text-[11px] text-muted-foreground">Stop for good?</span>
                <ActionBtn label="Cancel" onClick={() => setConfirmStop(false)} />
                <ActionBtn icon={<Square className="size-3" />} label="Stop" danger disabled={busy}
                  onClick={() => { update.mutate({ id: s.id, action: "stop" }); setConfirmStop(false); }} />
              </span>
            ) : (
              <ActionBtn icon={<Square className="size-3" />} label="Stop" disabled={busy} onClick={() => setConfirmStop(true)} />
            )}
          </div>
        </div>
      )}

      {editing && <EditForm s={s} onDone={() => setEditing(false)} />}
    </div>
  );
}

function ActionBtn({ icon, label, onClick, disabled, danger }: {
  icon?: React.ReactNode; label: string; onClick: () => void; disabled?: boolean; danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors disabled:opacity-50",
        danger
          ? "border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/15"
          : "hover:bg-muted"
      )}
    >
      {icon}{label}
    </button>
  );
}

function EditForm({ s, onDone }: { s: RecurringSeries; onDone: () => void }) {
  const update = useUpdateRecurring();
  const { data: directory = [] } = useAssignableUsers();
  const [title, setTitle] = useState(s.title);
  const [priority, setPriority] = useState<TaskPriority>(s.priority);
  const [due, setDue] = useState(s.due_offset_days);
  const [people, setPeople] = useState<string[]>(s.assignees.map((a) => a.id));

  const save = async () => {
    if (!title.trim() || people.length === 0) return;
    await update.mutateAsync({ id: s.id, title: title.trim(), priority, due_offset_days: due, assignees: people });
    onDone();
  };

  const field = "w-full rounded-lg border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30 transition";
  return (
    <div className="mt-3 space-y-2.5 border-t pt-3">
      <p className="text-[11px] text-muted-foreground">Changes apply to future copies. Copies already created stay as they are.</p>
      <input value={title} onChange={(e) => setTitle(e.target.value)} className={field} aria-label="Title" />
      <div className="grid grid-cols-2 gap-2">
        <select value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)} className={field} aria-label="Priority">
          <option value="low">Low priority</option>
          <option value="medium">Medium priority</option>
          <option value="high">High priority</option>
        </select>
        <select value={due} onChange={(e) => setDue(Number(e.target.value))} className={field} aria-label="Each copy due">
          {DUE_OFFSET_OPTIONS.map((o) => <option key={o.value} value={o.value}>Due: {o.label.toLowerCase()}</option>)}
        </select>
      </div>
      <UserPicker
        users={directory}
        selectedIds={people}
        onToggle={(id) => setPeople((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))}
        placeholder="Search people…"
        maxHeightClass="max-h-36"
      />
      <div className="flex justify-end gap-1.5">
        <ActionBtn label="Cancel" onClick={onDone} />
        <button
          type="button"
          onClick={save}
          disabled={!title.trim() || people.length === 0 || update.isPending}
          className="rounded-md bg-primary px-3 py-1 text-[11px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {update.isPending ? "Saving…" : "Save changes"}
        </button>
      </div>
    </div>
  );
}

export default RecurringDrawer;
