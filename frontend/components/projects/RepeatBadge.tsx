"use client";

/**
 * "↻ 3/5" — marks a task that is one copy of a repeating series.
 * Renders nothing for ordinary tasks, so it can sit in any badge row.
 */
import { Repeat } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Task } from "@/types/project";

const FREQ_LABEL = { daily: "daily", weekly: "weekly", monthly: "monthly" } as const;

export function RepeatBadge({ task, className }: { task: Task; className?: string }) {
  const r = task.recurrence;
  if (!r) return null;
  const progress = r.total ? `${r.index}/${r.total}` : `#${r.index}`;
  const tip = r.total
    ? `Repeats ${FREQ_LABEL[r.frequency]} · copy ${r.index} of ${r.total}`
    : `Repeats ${FREQ_LABEL[r.frequency]} until stopped · copy ${r.index}`;
  return (
    <span
      title={tip}
      aria-label={tip}
      className={cn(
        "inline-flex items-center gap-1 rounded-full bg-indigo-500/10 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-indigo-600 dark:text-indigo-400",
        className
      )}
    >
      <Repeat className="size-2.5" />
      {progress}
    </span>
  );
}

export default RepeatBadge;
