"use client";

/**
 * Where a flagged ad stands, under the ad's facts — same strip style as
 * "No numbers yet". Open: red, with Withdraw for the sender. Recreated or
 * declined: shown for 14 days so the team sees the answer.
 */
import { useState } from "react";
import { CheckCircle2, Loader2, TrendingDown, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtDateTime } from "@/lib/datetime";
import { useAdFlagAction } from "@/hooks/useAdFlags";
import type { AdFlagSummary } from "@/types/adFlag";

export function FlagStatusStrip({ flag, meId }: { flag: AdFlagSummary; meId: string }) {
  const act = useAdFlagAction();
  const [confirm, setConfirm] = useState(false);
  const when = fmtDateTime(flag.active ? flag.created_at : flag.updated_at, { day: "numeric", month: "short" });
  const to = <><b className="font-semibold">{flag.recipient_name}</b>{flag.recipient_team_name && <> ({flag.recipient_team_name})</>}</>;

  if (flag.active) {
    return (
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-red-500/30 bg-red-500/[0.07] px-3 py-2 text-xs text-red-700 dark:text-red-300">
        <TrendingDown className="size-3.5 shrink-0" />
        <span title="It's in their Leader Desk → Ads to redo">Not performing — sent to {to} · {when}</span>
        <span className={cn("rounded-full px-1.5 py-px text-[10px] font-semibold",
          flag.status === "in_progress" ? "bg-amber-500/15 text-amber-700 dark:text-amber-300" : "bg-red-500/15")}>
          {flag.status_label}
        </span>
        {flag.status === "open" && flag.flagged_by === meId && (confirm ? (
          <span className="ml-auto inline-flex items-center gap-1">
            Withdraw it?
            <button type="button" onClick={() => setConfirm(false)} className="rounded-md px-1.5 py-0.5 font-medium hover:bg-red-500/10">Keep</button>
            <button type="button" disabled={act.isPending} onClick={() => act.mutate({ id: flag.id, action: "withdraw" }, { onSettled: () => setConfirm(false) })}
              className="inline-flex items-center gap-1 rounded-md border border-red-500/40 px-1.5 py-0.5 font-medium hover:bg-red-500/10 disabled:opacity-50">
              {act.isPending && <Loader2 className="size-3 animate-spin" />} Withdraw
            </button>
          </span>
        ) : (
          <button type="button" onClick={() => setConfirm(true)}
            className="ml-auto rounded-md px-1.5 py-0.5 font-medium hover:bg-red-500/10">Withdraw</button>
        ))}
      </div>
    );
  }
  if (flag.status === "done") {
    return (
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-emerald-500/30 bg-emerald-500/[0.07] px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300">
        <CheckCircle2 className="size-3.5 shrink-0" />
        <span>Recreated by {to} · {when}{flag.resolution_note && <> — “{flag.resolution_note}”</>}</span>
      </p>
    );
  }
  if (flag.status === "declined") {
    return (
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-amber-500/30 bg-amber-500/[0.07] px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
        <XCircle className="size-3.5 shrink-0" />
        <span>{to} couldn&apos;t recreate it · {when}{flag.resolution_note && <> — “{flag.resolution_note}”</>}</span>
      </p>
    );
  }
  return null;   // withdrawn: nothing to say
}
