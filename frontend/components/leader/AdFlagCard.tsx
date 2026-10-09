"use client";

/**
 * Leader Desk → Ads to redo: one ad sent to you to recreate. The ad itself on
 * top (click to view / play every creative), then the report (last 7 days vs
 * the 7 before), why it was sent, and the actions. Everything the media team
 * needs is on the card — they usually can't open the other team's report.
 */
import { useRef, useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ExternalLink, FileText, Hammer, ImageOff, Loader2, Play, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtDateTime } from "@/lib/datetime";
import { SignedImg } from "@/components/shared/SignedImg";
import { MediaLightbox } from "@/components/shared/MediaLightbox";
import { FlagNumbers } from "@/components/ad-reports/FlagNumbers";
import { useAdFlagAction } from "@/hooks/useAdFlags";
import { useAuthStore } from "@/stores/authStore";
import type { AdFlag } from "@/types/adFlag";

const STATUS_STYLE: Record<string, string> = {
  open: "bg-red-500/10 text-red-700 dark:text-red-300",
  in_progress: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  done: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  declined: "bg-muted text-muted-foreground",
  withdrawn: "bg-muted text-muted-foreground",
};

function Cover({ flag, onOpen }: { flag: AdFlag; onOpen: () => void }) {
  const qc = useQueryClient();
  const c = flag.creatives[0];
  const refetch = () => qc.invalidateQueries({ queryKey: ["ad-reports", "flags"] });
  // A signed link may have expired: re-sign once per file, never in a loop.
  const retried = useRef<string | null>(null);
  const onVideoError = () => {
    const base = c?.url.split("?")[0] ?? "";
    if (retried.current === base) return;
    retried.current = base;
    refetch();
  };
  if (!c) {
    return (
      <div className="flex aspect-video items-center justify-center gap-2 bg-muted text-xs text-muted-foreground">
        <ImageOff className="size-4" /> No creative uploaded
      </div>
    );
  }
  const more = flag.creatives.length - 1;
  return (
    <button type="button" onClick={onOpen} aria-label={`View the ad's ${flag.creatives.length} creative${more ? "s" : ""}`}
      className="group relative block aspect-video w-full overflow-hidden bg-black">
      {c.content_type.startsWith("image/") ? (
        <SignedImg src={c.url} alt="" onExpired={refetch} className="size-full object-contain"
          fallback={<FileText className="m-auto size-6 text-white/60" />} />
      ) : c.content_type.startsWith("video/") ? (
        <>
          <video src={`${c.url}#t=0.1`} muted playsInline preload="metadata" className="size-full object-contain"
            onError={onVideoError} />
          <span className="absolute inset-0 m-auto flex size-11 items-center justify-center rounded-full bg-black/55 transition group-hover:scale-105">
            <Play className="size-5 fill-white text-white" />
          </span>
        </>
      ) : (
        <span className="flex size-full items-center justify-center gap-2 text-sm text-white/80"><FileText className="size-5" /> {c.filename}</span>
      )}
      {more > 0 && (
        <span className="absolute bottom-2 right-2 rounded-full bg-black/65 px-2 py-0.5 text-[11px] font-medium text-white">+{more} more</span>
      )}
    </button>
  );
}

export function AdFlagCard({ flag, highlight }: { flag: AdFlag; highlight?: boolean }) {
  const act = useAdFlagAction();
  const meId = useAuthStore((st) => st.user?.id ?? "");
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  const forMe = flag.recipient.id === meId;
  // The recipient works on it; the sender can withdraw it. An admin who isn't
  // either still gets the leader's buttons (e.g. to close a stale request).
  const showLeader = flag.can_act && (forMe || !flag.can_withdraw);
  const showWithdraw = flag.can_withdraw && !showLeader;
  const qc = useQueryClient();
  const [view, setView] = useState<number | null>(null);
  const [mode, setMode] = useState<"done" | "decline" | null>(null);
  const [note, setNote] = useState("");
  const busy = act.isPending;

  const run = (action: "start" | "done" | "decline") =>
    act.mutate({ id: flag.id, action, note: note.trim() }, { onSuccess: () => { setMode(null); setNote(""); } });

  return (
    <article id={`flag-${flag.id}`}
      className={cn("flex flex-col overflow-hidden rounded-xl border bg-card shadow-sm transition",
        highlight && "ring-2 ring-red-500/60")}>
      <Cover flag={flag} onOpen={() => setView(0)} />

      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="line-clamp-2 text-sm font-semibold leading-snug">{flag.report_name}</p>
            <p className="truncate text-[11px] text-muted-foreground">
              {[flag.account_name, flag.team_name].filter(Boolean).join(" · ")}
            </p>
          </div>
          <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold", STATUS_STYLE[flag.status])}>
            {flag.status_label}
          </span>
        </div>

        {flag.reasons.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {flag.reasons.map((r) => (
              <span key={r.key} className="rounded-full border border-red-500/30 bg-red-500/5 px-2 py-0.5 text-[10px] font-medium text-red-700 dark:text-red-300">
                {r.label}
              </span>
            ))}
          </div>
        )}
        {flag.note && (
          <p className="rounded-md border-l-2 border-red-400/60 bg-muted/40 px-2.5 py-1.5 text-xs text-foreground/85">“{flag.note}”</p>
        )}

        <FlagNumbers snap={flag.snapshot} compact />

        {/* Seen by the sender or an admin: who has it now. */}
        {!forMe && (
          <p className="rounded-md bg-muted/50 px-2.5 py-1.5 text-[11px] text-muted-foreground">
            With <span className="font-medium text-foreground">{flag.recipient.name || "—"}</span>
            {flag.recipient.team_name && <> · {flag.recipient.team_name}</>}
          </p>
        )}
        <p className="text-[11px] text-muted-foreground">
          Sent by <span className="font-medium text-foreground">{flag.flagged_by.id === meId ? "you" : flag.flagged_by.name || "—"}</span> · {fmtDateTime(flag.created_at, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
        </p>
        {!flag.active && flag.resolution_note && (
          <p className="text-[11px] text-muted-foreground">Your note: “{flag.resolution_note}”</p>
        )}

        {/* Actions */}
        {showLeader && (
          mode ? (
            <div className="mt-auto space-y-2">
              <textarea value={note} onChange={(e) => setNote(e.target.value.slice(0, 1000))} rows={2} autoFocus
                aria-label={mode === "decline" ? "Why it can't be redone" : "Note for the sender (optional)"}
                placeholder={mode === "decline" ? "Why can't it be redone? (the sender will see this)" : "Optional: what changed in the new version"}
                className="w-full resize-none rounded-lg border bg-background px-3 py-2 text-xs outline-none focus:border-ring focus:ring-2 focus:ring-ring/30" />
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => { setMode(null); setNote(""); }} className="h-8 rounded-lg border px-3 text-xs font-medium hover:bg-muted">Cancel</button>
                <button type="button" disabled={busy || (mode === "decline" && note.trim().length < 3)} onClick={() => run(mode)}
                  className={cn("inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-medium text-white disabled:opacity-50",
                    mode === "decline" ? "bg-zinc-700 hover:bg-zinc-800" : "bg-emerald-600 hover:bg-emerald-700")}>
                  {busy && <Loader2 className="size-3.5 animate-spin" />}
                  {mode === "decline" ? "Decline" : "Mark recreated"}
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-auto flex flex-wrap gap-2 pt-1">
              {flag.status === "open" ? (
                <button type="button" disabled={busy} onClick={() => run("start")}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
                  {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Hammer className="size-3.5" />} Start recreating
                </button>
              ) : (
                <button type="button" disabled={busy} onClick={() => setMode("done")}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
                  <CheckCircle2 className="size-3.5" /> Mark recreated
                </button>
              )}
              <button type="button" disabled={busy} onClick={() => setMode("decline")}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium hover:bg-muted disabled:opacity-50">
                <XCircle className="size-3.5" /> Decline
              </button>
              {flag.can_open_report ? (
                <Link href={`/ad-reports?report=${flag.report_id}`}
                  className="ml-auto inline-flex h-8 items-center gap-1 rounded-lg px-2 text-xs font-medium text-primary hover:bg-primary/10">
                  Report <ExternalLink className="size-3" />
                </Link>
              ) : flag.report_deleted && (
                <span className="ml-auto text-[11px] text-muted-foreground" title="Its creatives were kept on this request">
                  Report deleted
                </span>
              )}
            </div>
          )
        )}

        {/* The sender can take it back until the leader starts on it. */}
        {showWithdraw && (
          <div className="mt-auto flex items-center justify-end gap-2 pt-1 text-xs">
            {confirmWithdraw ? (
              <>
                <span className="mr-auto text-muted-foreground">Withdraw this request?</span>
                <button type="button" onClick={() => setConfirmWithdraw(false)} className="h-8 rounded-lg border px-3 font-medium hover:bg-muted">Keep</button>
                <button type="button" disabled={busy} onClick={() => act.mutate({ id: flag.id, action: "withdraw" })}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-red-500/40 px-3 font-medium text-red-600 hover:bg-red-500/10 disabled:opacity-50 dark:text-red-400">
                  {busy && <Loader2 className="size-3.5 animate-spin" />} Withdraw
                </button>
              </>
            ) : (
              <button type="button" onClick={() => setConfirmWithdraw(true)} className="h-8 rounded-lg border px-3 font-medium hover:bg-muted">Withdraw</button>
            )}
          </div>
        )}
      </div>

      {view !== null && flag.creatives.length > 0 && (
        <MediaLightbox
          items={flag.creatives.map((c) => ({ url: c.url, filename: c.filename, content_type: c.content_type, size: c.size }))}
          index={view} onIndexChange={setView} onClose={() => setView(null)}
          onExpired={() => qc.invalidateQueries({ queryKey: ["ad-reports", "flags"] })}
        />
      )}
    </article>
  );
}
