"use client";

/**
 * "Delete" on an ad or an account. Says plainly what goes (days of numbers,
 * creatives, who loses it), lets an account keep its ads or take them along,
 * and notes that an open "Ad not performing" request stays with the media team.
 * The toast after it offers Undo (useDeleteAdReport).
 */
import { useEffect, useState } from "react";
import { Building2, CalendarDays, Image as ImageIcon, Loader2, Megaphone, Trash2, Undo2, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { ModalShell } from "./ModalShell";
import { useAdEntries, useDeleteAdReport } from "@/hooks/useAdReports";
import type { AdReport } from "@/types/adReport";

interface Props {
  report: AdReport;
  open: boolean;
  onClose: () => void;
  today: string;
  /** Undo brought it back — open it again. */
  onRestored?: (id: string) => void;
}

export function DeleteReportDialog({ report: r, open, onClose, today, onRestored }: Props) {
  const del = useDeleteAdReport();
  const isAccount = r.kind === "account";
  const ads = r.account?.ads ?? 0;
  const [withAds, setWithAds] = useState(false);
  useEffect(() => { if (open) setWithAds(false); }, [open, r.id]);
  // How many days of numbers go with it (ads only — an account has none of its own).
  const { data: entries } = useAdEntries(r.id, r.start_date, today, open && !isAccount);

  const confirm = async () => {
    try {
      await del.mutateAsync({ id: r.id, withAds: isAccount && withAds, onRestored });
      onClose();
    } catch { /* the hook showed the message */ }
  };

  const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
  const facts: { icon: React.ElementType; text: string }[] = isAccount
    ? [
        { icon: Megaphone, text: ads ? plural(ads, "ad") + " inside" : "No ads inside" },
        { icon: Users, text: r.assignees.length === 0 ? "Nobody looks after it"
            : r.assignees.length === 1 ? "1 person looks after it" : `${r.assignees.length} people look after it` },
      ]
    : [
        { icon: CalendarDays, text: entries ? plural(entries.length, "day") + " of numbers" : "Counting days…" },
        { icon: ImageIcon, text: plural(r.creatives.length, "creative") },
        { icon: Users, text: `${r.assignees.map((a) => a.name).join(", ") || "Nobody"} will no longer see it` },
      ];

  return (
    <ModalShell open={open} onClose={onClose} tone="danger" icon={<Trash2 className="size-4" />}
      title={isAccount ? "Delete this ad account?" : "Delete this ad report?"} className="max-w-md">
      <div className="rounded-xl border bg-muted/30 p-3">
        <p className="flex items-center gap-2 font-semibold leading-snug">
          {isAccount ? <Building2 className="size-4 shrink-0 text-blue-600 dark:text-blue-400" /> : <Megaphone className="size-4 shrink-0 text-primary" />}
          <span className="min-w-0 break-words">{r.name}</span>
        </p>
        <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
          {facts.map((f) => (
            <li key={f.text} className="flex items-start gap-2"><f.icon className="mt-0.5 size-3.5 shrink-0" /> {f.text}</li>
          ))}
        </ul>
      </div>

      {isAccount && ads > 0 && (
        <div role="radiogroup" aria-label="What happens to its ads" className="space-y-2">
          {(([
            ads === 1
              ? [false, "Keep its ad", "It carries on as a standalone ad, with all its numbers."]
              : [false, `Keep its ${ads} ads`, "They carry on as standalone ads, with all their numbers."],
            ads === 1
              ? [true, "Delete the ad too", "And every day of its numbers."]
              : [true, `Delete the ${ads} ads too`, "And every day of their numbers."],
          ]) as [boolean, string, string][]).map(([v, title, hint]) => {
            const on = withAds === v;
            return (
              <button key={String(v)} type="button" role="radio" aria-checked={on} onClick={() => setWithAds(v)}
                className={cn("flex w-full items-start gap-3 rounded-xl border p-3 text-left transition outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
                  on ? (v ? "border-red-500/50 bg-red-500/5 ring-1 ring-red-500/30" : "border-primary bg-primary/5 ring-1 ring-primary/30") : "hover:bg-muted/50")}>
                <span className={cn("mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border-2",
                  on ? (v ? "border-red-500" : "border-primary") : "border-muted-foreground/40")}>
                  {on && <span className={cn("size-1.5 rounded-full", v ? "bg-red-500" : "bg-primary")} />}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{title}</span>
                  <span className="block text-xs text-muted-foreground">{hint}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      {!isAccount && r.flag?.active && (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
          The “Ad not performing” request stays with {r.flag.recipient_name || "the media team"} — its creatives are kept on it.
        </p>
      )}

      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Undo2 className="size-3.5" /> You can undo this from the message that appears next.
      </p>

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className="h-9 rounded-lg border px-4 text-sm font-medium hover:bg-muted">Cancel</button>
        <button type="button" onClick={confirm} disabled={del.isPending}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-red-600 px-4 text-sm font-medium text-white transition hover:bg-red-700 disabled:opacity-50">
          {del.isPending ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
          {isAccount && withAds ? `Delete account + ${ads === 1 ? "its ad" : `${ads} ads`}` : "Delete"}
        </button>
      </div>
    </ModalShell>
  );
}
