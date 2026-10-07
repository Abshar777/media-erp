"use client";

/**
 * One-line strip in the task detail modal for a copy of a repeating series:
 * "↻ Part of a weekly series · copy 3 of 5 · next on Fri 24 Oct · Manage".
 * Renders nothing for ordinary tasks.
 *
 * The modal opens from many places (Overview, Chat, Leader Desk), so "Manage"
 * links to the Projects page, which opens the Repeating drawer on this series.
 */
import Link from "next/link";
import { Repeat } from "lucide-react";
import { useRecurringSeries } from "@/hooks/useRecurring";
import { shortDateWithDay } from "@/lib/recurrence";
import type { Task } from "@/types/project";

export function RecurrenceStrip({ task }: { task: Task }) {
  const r = task.recurrence;
  const { data: series } = useRecurringSeries(r?.id);
  if (!r) return null;

  const copy = r.total ? `copy ${r.index} of ${r.total}` : `copy ${r.index}`;
  let tail: React.ReactNode = null;
  if (series?.status === "active" && series.next_date) {
    tail = <>next on {shortDateWithDay(series.next_date)}</>;
  } else if (series?.status === "paused") {
    tail = <span className="text-amber-600 dark:text-amber-400">paused{series.paused_reason ? ` — ${series.paused_reason}` : ""}</span>;
  } else if (series?.status === "completed") {
    tail = <>series finished</>;
  } else if (series?.status === "stopped") {
    tail = <>series stopped</>;
  }

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-indigo-400/30 bg-indigo-500/5 px-3 py-2 text-xs">
      <Repeat className="size-3.5 shrink-0 text-indigo-600 dark:text-indigo-400" />
      <span className="font-medium text-foreground">Part of a {r.frequency} series</span>
      <span className="text-muted-foreground">· {copy}</span>
      {tail && <span className="text-muted-foreground">· {tail}</span>}
      {series?.can_manage && (
        <Link
          href={`/projects?repeating=${r.id}`}
          className="ml-auto font-medium text-indigo-600 hover:underline dark:text-indigo-400"
        >
          Manage
        </Link>
      )}
    </div>
  );
}

export default RecurrenceStrip;
