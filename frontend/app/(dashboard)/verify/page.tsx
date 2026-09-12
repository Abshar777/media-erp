"use client";

/**
 * Verification inbox — every task that names you as a verifier.
 *
 * The per-task page is reached from a notification or an email; this is the
 * standing list, so nothing waits on you unnoticed just because a notification
 * scrolled past.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck, Loader2, CheckCircle2, XCircle, Clock, ArrowRight, Eye } from "lucide-react";
import { useMyVerifications } from "@/hooks/useVerify";
import { PRIORITY_META, assigneeLabel } from "@/types/project";
import { fmtDateOnly } from "@/lib/datetime";
import { cn } from "@/lib/utils";

const TABS = [
  { id: "pending", label: "Waiting on me" },
  { id: "done",    label: "Already done" },
  { id: "all",     label: "All" },
] as const;

export default function VerifyInboxPage() {
  const [scope, setScope] = useState<(typeof TABS)[number]["id"]>("pending");
  // Super Admin oversight: every task under verification, not just yours.
  const [everyone, setEveryone] = useState(false);
  const { data, isLoading } = useMyVerifications(scope, everyone);
  const items = data?.items ?? [];
  const canSeeAll = data?.meta.can_see_all ?? false;
  const router = useRouter();

  return (
    <div className="flex flex-col gap-5 pb-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight">
          <ShieldCheck className="size-5 text-primary" /> Verifications
        </h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {everyone
            ? "Every task under verification across the company."
            : "Work that needs your sign-off before it can be approved."}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex w-fit max-w-full gap-1 overflow-x-auto rounded-xl border bg-muted/50 p-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setScope(t.id)}
              className={cn(
                "shrink-0 whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition-all",
                scope === t.id
                  ? "border bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {everyone && t.id === "pending" ? "Awaiting anyone" : t.label}
            </button>
          ))}
        </div>

        {canSeeAll && (
          <button
            type="button"
            onClick={() => setEveryone((v) => !v)}
            className={cn(
              "flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors",
              everyone
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-background text-muted-foreground hover:bg-muted"
            )}
          >
            <Eye className="size-3.5" />
            Everyone&apos;s verifications
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="size-7 animate-spin text-muted-foreground" />
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border bg-card py-20 text-muted-foreground/60">
          <ShieldCheck className="size-10" />
          <p className="text-sm font-medium">
            {scope !== "pending"
              ? "Nothing here yet"
              : everyone
                ? "Nothing is awaiting verification"
                : "Nothing is waiting on you"}
          </p>
          {scope === "pending" && !everyone && (
            <p className="text-xs">You&apos;ll be notified when someone needs your verification.</p>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {items.map((t) => {
            const p = PRIORITY_META[t.priority] ?? PRIORITY_META.medium;
            const mine = t.my_verification;
            const outstanding = (t.verifications ?? []).filter((v) => v.status !== "passed").length;
            return (
              <button
                key={t.id}
                onClick={() => router.push(`/verify/${t.id}`)}
                className="group rounded-2xl border bg-card p-4 text-left transition-all hover:shadow-md"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2 min-w-0">
                    <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold", p.color)}>
                      {p.label}
                    </span>
                    <p className="truncate text-sm font-medium">{t.title}</p>
                  </div>
                  {t.awaiting_me ? (
                    <span className="flex shrink-0 items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-600">
                      <Clock className="size-3" /> {everyone ? `${outstanding} waiting` : "Waiting"}
                    </span>
                  ) : mine?.status === "passed" ? (
                    <span className="flex shrink-0 items-center gap-1 rounded-full bg-green-500/10 px-2 py-0.5 text-[11px] font-medium text-green-600">
                      <CheckCircle2 className="size-3" /> Verified
                    </span>
                  ) : mine?.status === "rejected" ? (
                    <span className="flex shrink-0 items-center gap-1 rounded-full bg-rose-500/10 px-2 py-0.5 text-[11px] font-medium text-rose-600">
                      <XCircle className="size-3" /> Sent back
                    </span>
                  ) : (
                    // Oversight view: not your task, so report the task's own
                    // standing rather than a decision you never made.
                    <span className="flex shrink-0 items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                      {outstanding === 0 ? "All verified" : `${outstanding} outstanding`}
                    </span>
                  )}
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                  {assigneeLabel(t) && <span>By {assigneeLabel(t)}</span>}
                  {t.due_date && <span>Due {fmtDateOnly(t.due_date)}</span>}
                  {/* The task may have moved on since — say so rather than
                      letting someone open a page with nothing to do on it. */}
                  {!t.awaiting_me && t.status !== "pending_review" && (
                    <span className="text-muted-foreground/70">
                      Task is now {t.status.replace(/_/g, " ")}
                    </span>
                  )}
                </div>

                {t.verify_instructions && (
                  <p className="mt-2 truncate rounded-lg bg-muted/40 px-2.5 py-1.5 text-[11px] text-foreground/75">
                    {t.verify_instructions}
                  </p>
                )}

                <span className="mt-3 flex items-center gap-1 text-[11px] font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100">
                  {mine && t.awaiting_me ? "Verify now" : "View"} <ArrowRight className="size-3" />
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
