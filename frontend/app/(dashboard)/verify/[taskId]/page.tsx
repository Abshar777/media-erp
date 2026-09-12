"use client";

/**
 * Verification page.
 *
 * Reached from the email a verifier gets when a task enters review. Login is
 * required — a sign-off has to be attributable to a person, so the link lands
 * here rather than carrying a token anyone could forward.
 */

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  CheckCircle2, XCircle, Loader2, ArrowLeft, ClipboardCheck,
  Paperclip, Clock, ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useVerification, useSubmitVerification } from "@/hooks/useVerify";
import { PRIORITY_META, assigneeLabel } from "@/types/project";
import { fmtDateOnly } from "@/lib/datetime";
import { cn } from "@/lib/utils";

function StatusPill({ status }: { status: string }) {
  const meta: Record<string, { label: string; cls: string }> = {
    passed:   { label: "Verified",     cls: "bg-green-500/10 text-green-600 border-green-500/30" },
    rejected: { label: "Needs changes", cls: "bg-rose-500/10 text-rose-600 border-rose-500/30" },
    pending:  { label: "Waiting",      cls: "bg-muted text-muted-foreground border-border" },
  };
  const m = meta[status] ?? meta.pending;
  return (
    <span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-medium", m.cls)}>
      {m.label}
    </span>
  );
}

export default function VerifyPage() {
  const { taskId } = useParams<{ taskId: string }>();
  const router = useRouter();
  const { data, isLoading, isError, error } = useVerification(taskId);
  const submit = useSubmitVerification(taskId);

  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError || !data) {
    // The common case is a real person following a real link who simply isn't
    // on the list — say that, rather than showing a bare error.
    const msg =
      (error as { response?: { data?: { message?: string } } })?.response?.data?.message ??
      "This verification could not be loaded.";
    return (
      <div className="mx-auto max-w-lg py-20 text-center space-y-4">
        <ShieldCheck className="mx-auto size-10 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">{msg}</p>
        <Button variant="outline" onClick={() => router.push("/projects")}>
          <ArrowLeft className="size-4 mr-1.5" /> Back to Projects
        </Button>
      </div>
    );
  }

  const { task, instructions, mine, verifications } = data;
  const priority = PRIORITY_META[task.priority] ?? PRIORITY_META.medium;
  const done = mine.status !== "pending";
  const stillOpen = task.status === "pending_review";

  return (
    <div className="mx-auto w-full max-w-2xl space-y-5 pb-10">
      <div>
        <button
          onClick={() => router.push("/projects")}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="size-3.5" /> Projects
        </button>
        <h1 className="mt-2 flex items-center gap-2 text-xl font-bold tracking-tight">
          <ClipboardCheck className="size-5 text-primary" /> Verify Task
        </h1>
      </div>

      {/* What you're being asked to check */}
      <div className="rounded-2xl border bg-card p-5 space-y-3">
        <div className="flex items-start gap-2">
          <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold shrink-0", priority.color)}>
            {priority.label}
          </span>
          <h2 className="text-base font-semibold leading-snug">{task.title}</h2>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          {assigneeLabel(task) && <span>Worked on by {assigneeLabel(task)}</span>}
          {task.due_date && (
            <span className="flex items-center gap-1">
              <Clock className="size-3" /> Due {fmtDateOnly(task.due_date)}
            </span>
          )}
        </div>

        {task.description && (
          <p className="text-sm text-foreground/80 whitespace-pre-wrap">{task.description}</p>
        )}

        {task.caption && (
          <p className="rounded-lg border-l-2 border-primary/40 bg-muted/40 px-3 py-2 text-xs italic text-foreground/80">
            &ldquo;{task.caption}&rdquo;
          </p>
        )}

        {instructions && (
          <div className="rounded-xl border border-amber-400/30 bg-amber-500/5 p-3 space-y-1">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-600">
              What to check
            </p>
            <p className="text-sm text-foreground/85 whitespace-pre-wrap">{instructions}</p>
          </div>
        )}

        {(task.attachments?.length ?? 0) > 0 && (
          <div className="space-y-1.5">
            <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              <Paperclip className="size-3" /> Attachments
            </p>
            <div className="flex flex-col gap-1">
              {task.attachments!.map((a) => (
                <a
                  key={a.key || a.url}
                  href={a.url}
                  target="_blank"
                  rel="noreferrer"
                  className="truncate text-xs text-primary hover:underline"
                >
                  {a.filename || a.url}
                </a>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Everyone's standing, so you can see who else is still to look */}
      <div className="rounded-2xl border bg-card p-5 space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Verifiers
        </p>
        {verifications.map((v) => (
          <div key={v.user_id} className="flex items-center justify-between gap-3 text-sm">
            <span className={cn(v.user_id === mine.user_id && "font-medium")}>
              {v.name}{v.user_id === mine.user_id ? " (you)" : ""}
            </span>
            <div className="flex items-center gap-2">
              {v.reason && (
                <span className="max-w-52 truncate text-[11px] text-muted-foreground italic">
                  {v.reason}
                </span>
              )}
              <StatusPill status={v.status} />
            </div>
          </div>
        ))}
      </div>

      {/* Your decision */}
      <div className="rounded-2xl border bg-card p-5 space-y-4">
        {done ? (
          <div className="flex items-center gap-2 text-sm">
            {mine.status === "passed" ? (
              <><CheckCircle2 className="size-4 text-green-600" /> You verified this task.</>
            ) : (
              <><XCircle className="size-4 text-rose-500" /> You asked for changes — {mine.reason}</>
            )}
          </div>
        ) : !stillOpen ? (
          <p className="text-sm text-muted-foreground">
            This task isn&apos;t awaiting review right now, so there&apos;s nothing to verify yet.
          </p>
        ) : rejecting ? (
          <div className="space-y-3">
            <label className="text-sm font-medium">What needs to change? *</label>
            <textarea
              autoFocus
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={4}
              placeholder="Be specific — this goes straight to the person who did the work."
              className="w-full resize-none rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
            />
            <p className="text-[11px] text-muted-foreground">
              The task goes back for changes, and they&apos;re notified with your reason.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => { setRejecting(false); setReason(""); }}>
                Cancel
              </Button>
              <Button
                onClick={() => submit.mutate({ passed: false, reason: reason.trim() })}
                disabled={!reason.trim() || submit.isPending}
                className="bg-rose-600 hover:bg-rose-700 text-white"
              >
                {submit.isPending ? <Loader2 className="size-4 animate-spin mr-1.5" /> : <XCircle className="size-4 mr-1.5" />}
                Send back for changes
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <Button
              onClick={() => submit.mutate({ passed: true })}
              disabled={submit.isPending}
              className="bg-green-600 hover:bg-green-700 text-white"
            >
              {submit.isPending ? <Loader2 className="size-4 animate-spin mr-1.5" /> : <CheckCircle2 className="size-4 mr-1.5" />}
              Looks good
            </Button>
            <Button variant="outline" onClick={() => setRejecting(true)}>
              <XCircle className="size-4 mr-1.5 text-rose-500" /> Needs changes
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
