"use client";

/**
 * RepeatField — the "Repeat" section of the Add Task form.
 *
 * Sits directly under the due date, the convention everyone knows from
 * Google Calendar / Outlook / Todoist: repetition is about time, so it lives
 * with the date. Defaults to "Once", so the form behaves exactly as before
 * unless the leader opts in.
 *
 * The summary card is the important part: it states in plain English what
 * will happen ("Every Friday · 5 times · 10 Oct → 7 Nov · 2 people × 5 = 10
 * tasks"), using lib/recurrence.ts — a verified mirror of the server's date
 * engine — so the dates shown are exactly the dates the scheduler will use.
 */
import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CalendarClock, Info, Repeat } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DUE_OFFSET_OPTIONS, MAX_COUNT, addDays, describePattern, needsMonthEndNote,
  occurrenceDate, shortDate, unitFor,
} from "@/lib/recurrence";
import type { RepeatFrequency } from "@/types/project";

export type RepeatChoice = "once" | RepeatFrequency;

export interface RepeatValue {
  frequency: RepeatChoice;
  count: number;
  untilStopped: boolean;
  dueOffset: number;
}

export const REPEAT_DEFAULT: RepeatValue = { frequency: "once", count: 5, untilStopped: false, dueOffset: 0 };

const OPTIONS: { value: RepeatChoice; label: string }[] = [
  { value: "once", label: "Once" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
];

interface Props {
  value: RepeatValue;
  onChange: (v: RepeatValue) => void;
  /** Today in IST, YYYY-MM-DD — the first copy's date, and the series anchor. */
  anchorISO: string;
  /** How many people each copy goes to (for "2 people × 5 = 10 tasks"). */
  assigneeCount: number;
}

export function RepeatField({ value, onChange, anchorISO, assigneeCount }: Props) {
  const set = (patch: Partial<RepeatValue>) => onChange({ ...value, ...patch });
  const repeating = value.frequency !== "once";
  const freq = repeating ? (value.frequency as RepeatFrequency) : "daily";
  const max = MAX_COUNT[freq];
  const count = Math.min(Math.max(1, value.count || 1), max);
  // What's in the box while typing. Without it, clearing the box snapped it
  // to 1 at once, so backspacing and typing "3" produced 13.
  const [draft, setDraft] = useState<string | null>(null);

  // Preview: the next few dates, and the last one when the series has an end.
  const preview = [0, 1, 2].map((i) => occurrenceDate(freq, anchorISO, i));
  const last = occurrenceDate(freq, anchorISO, count - 1);
  const people = Math.max(assigneeCount, 1);

  return (
    <div className="space-y-2">
      <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Repeat className="size-3" /> Repeat
      </label>

      {/* Segmented control */}
      <div role="radiogroup" aria-label="Repeat" className="grid grid-cols-4 gap-1 rounded-lg border bg-muted/40 p-1">
        {OPTIONS.map((o) => {
          const active = value.frequency === o.value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => set({
                frequency: o.value,
                // A count valid for "daily" (e.g. 200) may be over the weekly/monthly cap.
                count: o.value === "once" ? value.count : Math.min(value.count, MAX_COUNT[o.value as RepeatFrequency]),
              })}
              className={cn(
                "rounded-md py-1.5 text-xs font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
                active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {o.label}
            </button>
          );
        })}
      </div>

      <AnimatePresence initial={false}>
        {repeating && (
          <motion.div
            key="repeat-options"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            <div className="space-y-3 pt-1">
              {/* How many times */}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <div className={cn("flex items-center gap-2 text-sm", value.untilStopped && "opacity-40")}>
                  <span className="text-muted-foreground">Repeat</span>
                  <input
                    type="number"
                    min={1}
                    max={max}
                    value={draft ?? count}
                    disabled={value.untilStopped}
                    onChange={(e) => {
                      const n = parseInt(e.target.value, 10);
                      setDraft(n > max ? String(max) : e.target.value);
                      if (!Number.isNaN(n)) set({ count: Math.min(Math.max(1, n), max) });
                    }}
                    onBlur={() => setDraft(null)}
                    aria-label={`Number of ${unitFor(freq, 2)}`}
                    className="w-16 rounded-lg border bg-background px-2 py-1.5 text-center text-sm tabular-nums outline-none focus:border-ring focus:ring-2 focus:ring-ring/30 transition disabled:cursor-not-allowed"
                  />
                  <span className="text-muted-foreground">{count === 1 ? "time" : "times"}</span>
                </div>
                <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground select-none">
                  <input
                    type="checkbox"
                    checked={value.untilStopped}
                    onChange={(e) => set({ untilStopped: e.target.checked })}
                    className="size-4 rounded border accent-primary"
                  />
                  until I stop it
                </label>
              </div>

              {/* When each copy is due */}
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">Each copy due</span>
                <select
                  value={value.dueOffset}
                  onChange={(e) => set({ dueOffset: Number(e.target.value) })}
                  className="rounded-lg border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30 transition"
                >
                  {DUE_OFFSET_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>

              {/* Plain-English summary — exactly what will happen */}
              <div className="rounded-xl border border-primary/25 bg-primary/5 px-3.5 py-3" aria-live="polite">
                <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                  <CalendarClock className="size-4 shrink-0 text-primary" />
                  {describePattern(freq, anchorISO)}
                  <span className="text-muted-foreground">·</span>
                  {value.untilStopped ? "until you stop it" : `${count} ${count === 1 ? "time" : "times"}`}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {value.untilStopped
                    ? <>Starts today ({shortDate(anchorISO)}) · next: {preview.slice(1).map(shortDate).join(", ")}…</>
                    : count === 1
                    ? <>Just today ({shortDate(anchorISO)})</>
                    : <>{shortDate(anchorISO)} → {shortDate(last)}{count > 3 && <> · next: {preview.slice(1).map(shortDate).join(", ")}…</>}</>}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {value.untilStopped
                    ? people === 1
                      ? `One new task each ${unitFor(freq, 1)}`
                      : `${people} people · one task each, every ${unitFor(freq, 1)}`
                    : people === 1
                    ? `${count} ${count === 1 ? "task" : "tasks"} in total`
                    : `${people} people × ${count} = ${people * count} tasks in total`}
                  {value.dueOffset > 0 && <> · each due {value.dueOffset === 1 ? "the next day" : `${value.dueOffset} days later`}</>}
                </p>
                {needsMonthEndNote(freq, anchorISO) && (
                  <p className="mt-1.5 flex items-start gap-1 text-[11px] text-muted-foreground">
                    <Info className="mt-px size-3 shrink-0" />
                    In shorter months it lands on the last day of the month.
                  </p>
                )}
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  The first {people === 1 ? "task is" : "tasks are"} created now, due {shortDate(addDays(anchorISO, value.dueOffset))}.
                </p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default RepeatField;
