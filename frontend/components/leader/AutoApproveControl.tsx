"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Loader2, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePopoverSide } from "@/hooks/usePopoverSide";
import { delayLabel, useAutoApprove, useSaveAutoApprove } from "@/hooks/useAutoApprove";

const PRESETS = [0, 15, 30, 60, 120, 240];

/**
 * Leader Desk header control: a pill showing the leader's own auto-approve state,
 * opening a card with the switch and the delay. Saves as soon as something changes.
 * Renders nothing for someone who doesn't lead a team.
 */
export function AutoApproveControl() {
  const { data } = useAutoApprove();
  const save = useSaveAutoApprove();
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(false);
  const [amount, setAmount] = useState("45");
  const [unit, setUnit] = useState<"min" | "h">("min");
  const ref = useRef<HTMLDivElement>(null);
  const side = usePopoverSide(ref, open, 368);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    window.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); window.removeEventListener("keydown", esc); };
  }, [open]);

  if (!data?.can_use) return null;
  const on = data.enabled;
  const delay = data.delay_minutes;
  const isPreset = PRESETS.includes(delay);
  const max = data.max_delay_minutes || 1440;

  const apply = (patch: Partial<{ enabled: boolean; delay_minutes: number }>) =>
    save.mutate({ enabled: patch.enabled ?? on, delay_minutes: patch.delay_minutes ?? delay });

  const customMinutes = Math.round((Number(amount) || 0) * (unit === "h" ? 60 : 1));
  const customOk = customMinutes >= 1 && customMinutes <= max;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn(
          "flex items-center gap-2 rounded-full border px-3.5 py-2 text-sm font-medium transition-colors",
          on
            ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/15 dark:text-emerald-400"
            : "text-muted-foreground hover:bg-muted hover:text-foreground",
        )}
      >
        <Zap className={cn("size-4", on && "fill-current")} />
        Auto-approve
        <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold",
          on ? "bg-emerald-500/15" : "bg-muted")}>
          {on ? delayLabel(delay) : "Off"}
        </span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Auto-approve settings"
          className={cn("fixed inset-x-3 top-24 z-50 rounded-2xl border bg-card p-4 shadow-xl sm:absolute sm:inset-x-auto sm:top-full sm:mt-2 sm:w-[23rem]",
            side === "right" ? "sm:right-0" : "sm:left-0")}
        >
          {/* Switch */}
          <div className="flex items-start gap-3">
            <span className={cn("mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg",
              on ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-muted text-muted-foreground")}>
              <Zap className={cn("size-4", on && "fill-current")} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">Auto-approve</p>
              <p className="text-xs text-muted-foreground">Approve your team&apos;s submitted work automatically.</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={on}
              aria-label="Auto-approve"
              disabled={save.isPending}
              onClick={() => apply({ enabled: !on })}
              className={cn("relative mt-1 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-60",
                on ? "bg-emerald-500" : "bg-muted-foreground/30")}
            >
              <span className={cn("inline-block size-5 rounded-full bg-white shadow transition-transform",
                on ? "translate-x-5" : "translate-x-0.5")} />
            </button>
          </div>

          {/* Delay */}
          <p className="mt-4 mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Approve after</p>
          <div className="grid grid-cols-4 gap-1.5">
            {PRESETS.map((m) => (
              <button
                key={m}
                type="button"
                disabled={save.isPending}
                onClick={() => { setCustom(false); apply({ delay_minutes: m }); }}
                aria-pressed={delay === m && !custom}
                className={cn("rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors",
                  delay === m && !custom ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted")}
              >
                {delayLabel(m)}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setCustom(true)}
              aria-pressed={custom || !isPreset}
              className={cn("col-span-2 rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors",
                custom || !isPreset ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted")}
            >
              {!isPreset && !custom ? `Custom · ${delayLabel(delay)}` : "Custom"}
            </button>
          </div>
          {custom && (
            <div className="mt-2 flex items-center gap-2">
              <input
                type="number" min={1} inputMode="numeric" value={amount}
                onChange={(e) => setAmount(e.target.value)}
                aria-label="Custom delay"
                className="h-8 w-20 rounded-lg border bg-background px-2 text-sm outline-none focus:border-ring"
              />
              <div className="flex rounded-lg border p-0.5 text-xs">
                {(["min", "h"] as const).map((u) => (
                  <button key={u} type="button" onClick={() => setUnit(u)}
                    className={cn("rounded-md px-2 py-1", unit === u ? "bg-muted font-semibold" : "text-muted-foreground")}>
                    {u === "min" ? "minutes" : "hours"}
                  </button>
                ))}
              </div>
              <button
                type="button"
                disabled={!customOk || save.isPending}
                onClick={() => { apply({ delay_minutes: customMinutes }); setCustom(false); }}
                className="ml-auto flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50"
              >
                <Check className="size-3.5" /> Set
              </button>
            </div>
          )}
          {custom && !customOk && (
            <p className="mt-1 text-[11px] text-rose-500">Between 1 minute and {max / 60} hours.</p>
          )}

          {/* What it means */}
          <p className={cn("mt-3 rounded-lg px-3 py-2 text-xs",
            on ? "bg-emerald-500/10 text-emerald-800 dark:text-emerald-300" : "bg-muted text-muted-foreground")}>
            {save.isPending ? <Loader2 className="inline size-3.5 animate-spin" /> : null}{" "}
            {!on
              ? "Off — you approve every submission yourself."
              : delay
                ? `You get ${delayLabel(delay)} after each submission to approve or send it back yourself; then it's approved for you.`
                : "Work is approved the moment it's submitted."}
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
            <span>Your teams:</span>
            {data.teams.map((t) => (
              <span key={t.id} className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5">
                <span className="size-1.5 rounded-full" style={{ background: t.color || "#94a3b8" }} />
                {t.name}
              </span>
            ))}
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
            Only covers work submitted after you turn it on, and only your own approvals — other leaders keep their own setting.
            Verifiers still sign off first. Use <span className="font-medium">Hold</span> on a card to approve that one yourself.
          </p>
        </div>
      )}
    </div>
  );
}
