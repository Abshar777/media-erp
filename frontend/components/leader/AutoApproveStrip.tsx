"use client";

import { useEffect, useState } from "react";
import { Pause, Play, Zap } from "lucide-react";
import { useHoldAutoApprove } from "@/hooks/useAutoApprove";
import type { Task } from "@/types/project";
import { cn } from "@/lib/utils";

/** "in 24 min", "in 1 h 5 min", "in under a minute". */
export function untilLabel(ms: number): string {
  const min = Math.ceil(ms / 60_000);
  if (min <= 1) return "in under a minute";
  const h = Math.floor(min / 60), m = min % 60;
  return "in " + [h ? `${h} h` : "", m ? `${m} min` : ""].filter(Boolean).join(" ");
}

/** The earliest leader timer on a task waiting in review, or null. */
export function nextAutoApproval(task: Task) {
  const list = task.auto_approvals ?? [];
  if (task.status !== "pending_review" || !list.length) return null;
  return [...list].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))[0];
}

/**
 * Slim strip on a Pending Review card when a leader's auto-approve covers it:
 * countdown + Hold, or "Held" + Resume. Renders nothing otherwise.
 */
export function AutoApproveStrip({ task }: { task: Task }) {
  const hold = useHoldAutoApprove();
  // Re-render every 30 s, and when the tab comes back (background tabs throttle timers).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const t = setInterval(tick, 30_000);
    const onVisible = () => { if (document.visibilityState === "visible") tick(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", onVisible); };
  }, []);

  const next = nextAutoApproval(task);
  const held = task.auto_approve_hold;
  if (!next && !held) return null;

  const waitingOnVerifiers = (task.verifications ?? []).some((v) => v.status !== "passed");
  const left = next ? Date.parse(next.at) - now : 0;
  const text = held
    ? `Auto-approve held${held.by_name ? ` by ${held.by_name}` : ""} — approve it yourself`
    : waitingOnVerifiers
      ? "Auto-approves after the verifiers sign off"
      : left > 0
        ? `Auto-approves ${untilLabel(left)}`
        : "Auto-approving now…";
  const by = next && !held ? `${next.leader_name}'s auto-approve` : "";

  return (
    <div className={cn("flex items-center gap-2 border-t px-4 py-2 text-[11px]",
      held ? "bg-muted/40 text-muted-foreground" : "bg-emerald-500/5 text-emerald-700 dark:text-emerald-400")}>
      {held ? <Pause className="size-3.5 shrink-0" /> : <Zap className="size-3.5 shrink-0 fill-current" />}
      <span className="min-w-0 flex-1 truncate" title={by || undefined}>
        <span className="font-semibold">{text}</span>
        {by && <span className="text-muted-foreground"> · {by}</span>}
      </span>
      <button
        type="button"
        disabled={hold.isPending}
        onClick={() => hold.mutate({ taskId: task.id, hold: !held })}
        className="flex shrink-0 items-center gap-1 rounded-md border px-2 py-0.5 font-medium text-foreground/80 hover:bg-muted disabled:opacity-50"
      >
        {held ? <><Play className="size-3" /> Resume</> : <><Pause className="size-3" /> Hold</>}
      </button>
    </div>
  );
}
