"use client";

/**
 * "Ad not performing" — send this ad to a team leader (usually the media
 * team's) to recreate. One screen: what you're sending (cover + last 7 days),
 * who gets it (pre-selected when we can tell), why (chips), an optional note.
 */
import { useEffect, useMemo, useState } from "react";
import { Loader2, Send, TrendingDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { ModalShell } from "@/components/ad-reports/ModalShell";
import { CreativeThumb } from "@/components/ad-reports/CreativeShowcase";
import { FlagNumbers } from "@/components/ad-reports/FlagNumbers";
import { useAdFlagDraft, useCreateAdFlag } from "@/hooks/useAdFlags";
import type { AdReport } from "@/types/adReport";

const NOTE_MAX = 1000;
const firstName = (n: string) => n.trim().split(/\s+/)[0] || n;

export function FlagAdModal({ report, open, onClose }: { report: AdReport; open: boolean; onClose: () => void }) {
  const { data: draft, isLoading, isError } = useAdFlagDraft(report.id, open);
  const create = useCreateAdFlag();
  const [to, setTo] = useState("");              // "<leaderId>|<teamId>"
  const [reasons, setReasons] = useState<string[]>([]);
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!open) return;
    setReasons([]); setNote(""); setTo("");
  }, [open, report.id]);
  useEffect(() => {
    if (draft?.default && !to) setTo(`${draft.default.recipient_id}|${draft.default.team_id}`);
  }, [draft, to]);

  const picked = useMemo(() => {
    const [lid, tid] = to.split("|");
    const team = draft?.recipients.find((t) => t.team_id === tid);
    return team ? { leader: team.leaders.find((l) => l.id === lid), team } : null;
  }, [to, draft]);

  const ok = !!picked?.leader && (reasons.length > 0 || note.trim().length > 0);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ok || !picked?.leader) return;
    try {
      await create.mutateAsync({ reportId: report.id, recipient_id: picked.leader.id,
        recipient_team_id: picked.team.team_id, reasons, note: note.trim() });
      onClose();
    } catch { /* toast shown by the hook */ }
  };

  const field = "w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30";

  return (
    <ModalShell open={open} onClose={onClose} title="Ad not performing" onSubmit={submit}
      icon={<TrendingDown className="size-4 text-red-600 dark:text-red-400" />}>
      {isLoading ? (
        <div className="flex h-40 items-center justify-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
      ) : isError || !draft ? (
        <p className="rounded-lg bg-muted/50 px-3 py-6 text-center text-sm text-muted-foreground">Couldn&apos;t load this. Close and try again.</p>
      ) : draft.active_flag ? (
        <p className="rounded-lg border border-red-500/25 bg-red-500/5 px-3 py-4 text-sm">
          This ad is already with <b>{draft.active_flag.recipient.name}</b> ({draft.active_flag.status_label.toLowerCase()}).
        </p>
      ) : (
        <>
          <p className="-mt-2 text-sm text-muted-foreground">
            Send this ad to a team leader to recreate. They&apos;ll see the ad and its numbers in Leader Desk.
          </p>

          {/* What you're sending */}
          <div className="flex gap-3 rounded-xl border bg-muted/30 p-3">
            <CreativeThumb creative={report.creatives?.[0]} className="size-16" />
            <div className="min-w-0 flex-1 space-y-2">
              <p className="truncate text-sm font-semibold">{report.name}</p>
              <FlagNumbers snap={draft.snapshot} compact />
            </div>
          </div>

          {/* Who */}
          <label className="space-y-1.5 text-sm font-medium">
            Send to
            <select value={to} onChange={(e) => setTo(e.target.value)} className={cn(field, "font-normal")} required
              aria-label="Team leader who should recreate the ad">
              <option value="" disabled>Choose a team leader…</option>
              {draft.recipients.map((t) => (
                <optgroup key={t.team_id} label={t.team_name}>
                  {t.leaders.map((l) => <option key={`${l.id}|${t.team_id}`} value={`${l.id}|${t.team_id}`}>{l.name}{l.email ? ` (${l.email})` : ""} — {t.team_name}</option>)}
                </optgroup>
              ))}
            </select>
            {draft.recipients.length === 0 && (
              <span className="block text-xs font-normal text-muted-foreground">No other team leaders yet.</span>
            )}
          </label>

          {/* Why */}
          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium">What&apos;s wrong? <span className="font-normal text-muted-foreground">(pick any)</span></legend>
            <div className="flex flex-wrap gap-1.5">
              {draft.reasons.map((r) => {
                const on = reasons.includes(r.key);
                return (
                  <button key={r.key} type="button" aria-pressed={on}
                    onClick={() => setReasons((xs) => on ? xs.filter((x) => x !== r.key) : [...xs, r.key])}
                    className={cn("rounded-full border px-3 py-1 text-xs font-medium transition",
                      on ? "border-red-500/50 bg-red-500/10 text-red-700 dark:text-red-300" : "hover:bg-muted")}>
                    {r.label}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <label className="space-y-1.5 text-sm font-medium">
            Note <span className="font-normal text-muted-foreground">(optional)</span>
            <textarea value={note} onChange={(e) => setNote(e.target.value.slice(0, NOTE_MAX))} rows={3}
              placeholder="e.g. Cost per lead doubled this week — try a new hook in the first 3 seconds"
              className={cn(field, "resize-none font-normal")} />
          </label>

          <div className="flex items-center justify-end gap-2 pt-1">
            {!ok && picked?.leader && <span className="mr-auto text-[11px] text-muted-foreground">Pick a reason or add a note</span>}
            <button type="button" onClick={onClose} className="h-9 rounded-lg border px-4 text-sm font-medium hover:bg-muted">Cancel</button>
            <button type="submit" disabled={!ok || create.isPending}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-red-600 px-4 text-sm font-medium text-white transition hover:bg-red-700 disabled:opacity-50">
              {create.isPending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              {picked?.leader ? `Send to ${firstName(picked.leader.name)}` : "Send"}
            </button>
          </div>
        </>
      )}
    </ModalShell>
  );
}
