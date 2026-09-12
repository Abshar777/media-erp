"use client";

/**
 * Verification standing at a glance, on a board card or a table row.
 *
 * Fully signed off reads as "Verified"; anything else shows how far along it
 * is (2/3), because "not verified" alone doesn't tell you whether you're
 * waiting on one person or five. Clicking opens who is outstanding, with a
 * nudge — the people blocked by a verification are the ones who chase it.
 */

import { useState } from "react";
import { createPortal } from "react-dom";
import { ShieldCheck, ShieldAlert, X, Loader2, Send, CheckCircle2, XCircle, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRemindVerifiers } from "@/hooks/useVerify";
import type { Task } from "@/types/project";
import { cn } from "@/lib/utils";

export function VerificationBadge({ task, compact }: { task: Task; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const remind = useRemindVerifiers(task.id);

  const verifications = task.verifications ?? [];
  if (verifications.length === 0) return null;   // nothing was asked of anyone

  const passed = verifications.filter((v) => v.status === "passed").length;
  const total = verifications.length;
  const full = passed === total;
  const rejected = verifications.some((v) => v.status === "rejected");
  const pending = verifications.filter((v) => v.status === "pending");

  return (
    <>
      <button
        type="button"
        title={full ? "Fully verified" : `${passed} of ${total} verified`}
        onPointerDown={(e) => e.stopPropagation()}   /* don't start a card drag */
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        className={cn(
          "flex shrink-0 items-center gap-1 rounded-full border font-semibold transition-colors",
          compact ? "px-1.5 py-0 text-[9px]" : "px-2 py-0.5 text-[10px]",
          full
            ? "border-green-500/30 bg-green-500/10 text-green-600 hover:bg-green-500/20"
            : rejected
              ? "border-rose-500/30 bg-rose-500/10 text-rose-600 hover:bg-rose-500/20"
              : "border-amber-500/30 bg-amber-500/10 text-amber-600 hover:bg-amber-500/20"
        )}
      >
        {full ? <ShieldCheck className="size-3" /> : <ShieldAlert className="size-3" />}
        {full ? "Verified" : `${passed}/${total}`}
      </button>

      {open && typeof document !== "undefined" && createPortal(
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          onClick={() => setOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm overflow-hidden rounded-2xl border bg-card shadow-2xl"
          >
            <div className="flex items-center justify-between border-b px-5 py-4">
              <div className="flex items-center gap-2">
                <ShieldCheck className={cn("size-4", full ? "text-green-600" : "text-amber-600")} />
                <h2 className="text-sm font-semibold">
                  {full ? "Fully verified" : `${passed} of ${total} verified`}
                </h2>
              </div>
              <button onClick={() => setOpen(false)} className="rounded-md p-1 hover:bg-muted">
                <X className="size-4" />
              </button>
            </div>

            <div className="space-y-2 p-5">
              <p className="truncate text-xs text-muted-foreground">{task.title}</p>

              <div className="space-y-1.5 pt-1">
                {verifications.map((v) => (
                  <div key={v.user_id} className="flex items-start justify-between gap-2 text-xs">
                    <span className="truncate">{v.name}</span>
                    <span className={cn(
                      "flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
                      v.status === "passed"   ? "bg-green-500/10 text-green-600" :
                      v.status === "rejected" ? "bg-rose-500/10 text-rose-600"   :
                                                "bg-muted text-muted-foreground"
                    )}>
                      {v.status === "passed"   ? <><CheckCircle2 className="size-3" /> Verified</> :
                       v.status === "rejected" ? <><XCircle className="size-3" /> Needs changes</> :
                                                 <><Clock className="size-3" /> Waiting</>}
                    </span>
                  </div>
                ))}
              </div>

              {verifications.some((v) => v.reason) && (
                <div className="space-y-1 rounded-lg border-l-2 border-rose-400/40 bg-muted/40 px-2.5 py-1.5">
                  {verifications.filter((v) => v.reason).map((v) => (
                    <p key={v.user_id} className="text-[11px] italic text-foreground/80">
                      {v.name}: {v.reason}
                    </p>
                  ))}
                </div>
              )}

              {full ? (
                <p className="pt-1 text-[11px] text-green-600">
                  Everyone has signed off — this task can be approved.
                </p>
              ) : (
                <p className="pt-1 text-[11px] text-amber-600">
                  It can&apos;t be approved until everyone verifies.
                </p>
              )}
            </div>

            {pending.length > 0 && task.status === "pending_review" && (
              <div className="flex items-center justify-between gap-3 border-t px-5 py-4">
                <p className="text-[11px] text-muted-foreground">
                  Waiting on {pending.map((v) => v.name).join(", ")}
                </p>
                <Button
                  size="sm"
                  disabled={remind.isPending}
                  onClick={() => remind.mutate()}
                  className="shrink-0"
                >
                  {remind.isPending
                    ? <Loader2 className="size-4 animate-spin mr-1.5" />
                    : <Send className="size-4 mr-1.5" />}
                  Send now
                </Button>
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
