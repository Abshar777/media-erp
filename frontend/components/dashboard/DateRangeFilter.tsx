"use client";

/**
 * Overview date filter — sits beside the member picker and looks like it:
 * neutral on "All time", primary-tinted when a range is on.
 * Presets in one column, then a Custom range (From / To + Apply).
 */
import { useEffect, useRef, useState } from "react";
import { CalendarDays, Check, ChevronDown, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { RANGE_PRESETS, rangeLabel, type OverviewRange } from "@/lib/overviewRange";

const PANEL_W = 288;   // sm:w-72

interface Props {
  value: OverviewRange;
  onChange: (r: OverviewRange) => void;
  today: string;
  className?: string;
}

export function DateRangeFilter({ value, onChange, today, className }: Props) {
  const [open, setOpen] = useState(false);
  // The panel normally hangs from the button's right edge (the header's right
  // corner). When the header wraps and the button sits at the left, that would
  // push it off-screen, so it opens from the left edge instead.
  const [alignLeft, setAlignLeft] = useState(false);
  const [from, setFrom] = useState(value.from ?? "");
  const [to, setTo] = useState(value.to ?? "");
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const active = value.key !== "all";

  useEffect(() => {
    if (!open) return;
    setFrom(value.from ?? "");
    setTo(value.to ?? "");
    const onDown = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); button.current?.focus(); } };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open, value.from, value.to]);

  const choose = (r: OverviewRange) => { onChange(r); setOpen(false); };
  const customOk = !!from && !!to && from <= to && to <= today;
  const field = "h-9 w-full rounded-lg border bg-background px-2.5 text-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30";

  return (
    <div ref={wrap} className={cn("relative", className)}>
      <div className={cn("flex w-full items-stretch rounded-xl border bg-card shadow-sm transition sm:w-auto",
        active && "border-primary/40 bg-primary/5")}>
        <button
          ref={button}
          type="button"
          onClick={() => {
            if (!open && wrap.current) setAlignLeft(wrap.current.getBoundingClientRect().right < PANEL_W + 8);
            setOpen((o) => !o);
          }}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={`Date range: ${rangeLabel(value, today)}`}
          className="flex min-w-0 flex-1 items-center gap-2.5 px-3 py-2 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/40 rounded-xl"
        >
          <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-lg",
            active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>
            <CalendarDays className="size-4" />
          </span>
          <span className="truncate">{rangeLabel(value, today)}</span>
          <ChevronDown className={cn("ml-auto size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
        </button>
        {active && (
          <button type="button" onClick={() => onChange({ key: "all" })} aria-label="Clear dates"
            className="flex items-center border-l px-2.5 text-muted-foreground transition hover:text-foreground">
            <X className="size-4" />
          </button>
        )}
      </div>

      {open && (
        <div role="dialog" aria-label="Choose a date range"
          className={cn("absolute top-full z-40 mt-2 w-full min-w-[16rem] overflow-hidden rounded-xl border bg-popover shadow-xl sm:w-72",
            alignLeft ? "left-0" : "right-0")}>
          <ul className="py-1">
            {RANGE_PRESETS.map((p) => {
              const on = value.key === p.key;
              return (
                <li key={p.key}>
                  <button type="button" onClick={() => choose({ key: p.key })}
                    className={cn("flex w-full items-center justify-between px-3 py-2 text-left text-sm transition hover:bg-muted",
                      on && "font-medium text-primary")}>
                    {p.label}
                    {on && <Check className="size-4" />}
                  </button>
                </li>
              );
            })}
          </ul>
          <form
            onSubmit={(e) => { e.preventDefault(); if (customOk) choose({ key: "custom", from, to }); }}
            className="space-y-2 border-t bg-muted/30 p-3"
          >
            <p className="text-xs font-medium text-muted-foreground">Custom range</p>
            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1 text-[11px] text-muted-foreground">From
                <input type="date" value={from} max={to || today} onChange={(e) => setFrom(e.target.value)} className={field} aria-label="From" />
              </label>
              <label className="space-y-1 text-[11px] text-muted-foreground">To
                <input type="date" value={to} min={from || undefined} max={today} onChange={(e) => setTo(e.target.value)} className={field} aria-label="To" />
              </label>
            </div>
            {from && to && from > to && <p className="text-[11px] text-red-600 dark:text-red-400">“To” can&apos;t be before “From”.</p>}
            <button type="submit" disabled={!customOk}
              className="h-9 w-full rounded-lg bg-primary text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50">
              Apply
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
