"use client";

/**
 * "Update numbers" — the 20-second daily job.
 *
 * Opens on the oldest missing day; chips list every missing day so a Monday
 * can fill Saturday and Sunday in one sitting ("Save & next day"). The
 * previous reported day's numbers sit beside each box to catch typos, and a
 * value wildly off yesterday's (5× either way) asks once before saving.
 * Cost per lead is shown, never typed.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { CalendarCheck, Loader2, PencilLine, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { ModalShell } from "./ModalShell";
import { adErrorMessage, useAdEntries, useSaveAdEntry } from "@/hooks/useAdReports";
import { METRIC_META, addDaysISO, cleanMoney, dayLabel, dayLabelW, formatINR, formatCount } from "@/lib/adReports";
import type { AdEntry, AdMetric, AdReport } from "@/types/adReport";

type Form = Partial<Record<AdMetric, string>> & { campaign_off: boolean; note: string };
const EMPTY: Form = { campaign_off: false, note: "" };

function toPaise(s: string | undefined): number | null {
  const c = cleanMoney(s ?? "");
  if (!c) return null;
  const n = Number(c);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

function fromEntry(e: AdEntry | undefined, metrics: AdMetric[]): Form {
  if (!e) return { ...EMPTY };
  const f: Form = { campaign_off: e.campaign_off, note: e.note };
  for (const m of metrics) {
    const v = e.values[m];
    if (v != null) f[m] = m === "spend" ? (v / 100).toFixed(2) : String(v);
  }
  return f;
}

interface Props {
  report: AdReport;
  open: boolean;
  onClose: () => void;
  today: string;
  /** Start on this day instead of the oldest missing one (e.g. "Edit" in the history). */
  initialDate?: string | null;
}

export function EntryModal({ report, open, onClose, today, initialDate }: Props) {
  const metrics = report.metrics;
  const maxDay = report.end_date && report.end_date < today ? report.end_date : today;
  const { data: entries = [], isLoading } = useAdEntries(open ? report.id : null, addDaysISO(today, -45), maxDay, open);
  const save = useSaveAdEntry();

  const [day, setDay] = useState<string>("");
  const [form, setForm] = useState<Form>({ ...EMPTY });
  const [confirmOdd, setConfirmOdd] = useState(false);
  const [missing, setMissing] = useState<string[]>(report.missing);
  const firstInput = useRef<HTMLInputElement>(null);

  // Pick the starting day each time the modal opens.
  useEffect(() => {
    if (!open) return;
    setMissing(report.missing);
    const yesterday = addDaysISO(today, -1);
    const start = initialDate || report.missing[0] || (yesterday >= report.start_date ? yesterday : today);
    setDay(start > maxDay ? maxDay : start);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, report.id, initialDate]);

  const byDate = useMemo(() => new Map(entries.map((e) => [e.date, e])), [entries]);
  const existing = byDate.get(day);
  // The nearest earlier reported day — the reference shown beside each box.
  const previous = useMemo(() => entries.filter((e) => e.date < day && !e.campaign_off).sort((a, b) => b.date.localeCompare(a.date))[0], [entries, day]);

  useEffect(() => {
    if (!open || !day) return;
    setForm(fromEntry(byDate.get(day), metrics));
    setConfirmOdd(false);
    setTimeout(() => firstInput.current?.focus(), 50);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day, open, entries.length]);

  const spendPaise = toPaise(form.spend);
  const leads = form.leads ? Number(form.leads) : null;
  const cpl = form.campaign_off ? null : spendPaise != null && leads ? spendPaise / leads : null;

  // 5× either way from the previous day → ask once ("extra zero" typos).
  const odd = useMemo(() => {
    if (!previous || form.campaign_off) return [] as string[];
    const out: string[] = [];
    for (const m of metrics) {
      const prev = previous.values[m];
      const cur = m === "spend" ? spendPaise : form[m] ? Number(form[m]) : null;
      if (prev && cur != null && cur > 0 && (cur >= prev * 5 || cur * 5 <= prev)) out.push(m);
    }
    return out;
  }, [previous, form, metrics, spendPaise]);

  const complete = form.campaign_off || metrics.every((m) => (form[m] ?? "").trim() !== "");
  const editingOld = !!existing && !report.can_manage && day < addDaysISO(today, -7);
  const locked = report.status === "ended" && !report.can_manage;

  const submit = async (next: boolean) => {
    if (!complete || save.isPending) return;
    if (odd.length && !confirmOdd) { setConfirmOdd(true); return; }
    const p = {
      id: report.id, date: day, campaign_off: form.campaign_off, note: form.note.trim(),
      leads: form.campaign_off ? null : form.leads ? Number(form.leads) : null,
      spend: form.campaign_off ? null : cleanMoney(form.spend ?? ""),
      impressions: form.impressions ? Number(form.impressions) : null,
      reach: form.reach ? Number(form.reach) : null,
      clicks: form.clicks ? Number(form.clicks) : null,
    };
    try {
      const res = await save.mutateAsync(p);
      const left = res.data.missing;
      setMissing(left);
      toast.success(`${dayLabel(day)} saved${res.data.report_status === "ended" ? " — the report is complete" : ""}`);
      if (next && left.length) setDay(left[0]);
      else onClose();
    } catch (e) {
      toast.error(adErrorMessage(e, "Could not save the numbers"));
    }
  };

  // Enter moves to the next box; on the last one it saves.
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const inputs = Array.from(e.currentTarget.form?.querySelectorAll<HTMLInputElement>("input[data-metric]") ?? []);
    const i = inputs.indexOf(e.currentTarget);
    if (i >= 0 && i < inputs.length - 1) inputs[i + 1].focus();
    else submit(missing.filter((d) => d !== day).length > 0);
  };

  const inputCls = "h-11 w-full rounded-xl border bg-background px-3 text-lg font-semibold tabular-nums outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30 disabled:opacity-50";
  const otherMissing = missing.filter((d) => d !== day);

  return (
    <ModalShell open={open} onClose={onClose} title={`Update numbers — ${report.name}`} icon={<PencilLine className="size-4" />}
      onSubmit={(e) => { e.preventDefault(); submit(false); }}>
      {/* Day */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-muted-foreground">Numbers for</span>
          <input
            type="date" aria-label="Day" value={day} min={report.start_date} max={maxDay}
            onChange={(e) => e.target.value && setDay(e.target.value)}
            className="h-8 rounded-lg border bg-background px-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
          />
        </div>
        {missing.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Missing days">
            <span className="text-xs text-muted-foreground">Missing:</span>
            {missing.slice(0, 10).map((d) => (
              <button key={d} type="button" onClick={() => setDay(d)}
                className={cn("rounded-full border px-2.5 py-0.5 text-xs font-medium transition",
                  d === day ? "border-primary bg-primary text-primary-foreground" : "border-red-500/30 bg-red-500/5 text-red-700 hover:bg-red-500/10 dark:text-red-400")}>
                {dayLabel(d)}
              </button>
            ))}
            {missing.length > 10 && <span className="text-xs text-muted-foreground">+{missing.length - 10} more</span>}
          </div>
        )}
        <p className="text-sm font-medium">
          {dayLabelW(day || today)}
          {day === today && <span className="ml-2 text-xs font-normal text-amber-600 dark:text-amber-400">Today isn&apos;t over — Meta&apos;s numbers will still change</span>}
          {existing && <span className="ml-2 text-xs font-normal text-muted-foreground">Already entered by {existing.entered_by_name || "someone"} — saving updates it</span>}
        </p>
      </div>

      {isLoading ? (
        <div className="flex h-40 items-center justify-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
      ) : (
        <>
          <fieldset disabled={form.campaign_off || locked || editingOld} className="space-y-3">
            {metrics.map((m, i) => {
              const prev = previous?.values[m];
              return (
                <label key={m} className="grid grid-cols-[1fr_auto] items-end gap-x-3 gap-y-1">
                  <span className="col-span-2 text-xs font-medium text-muted-foreground">
                    {METRIC_META[m].label}{m === "spend" && " (₹)"}
                  </span>
                  <input
                    ref={i === 0 ? firstInput : undefined}
                    data-metric={m}
                    inputMode={m === "spend" ? "decimal" : "numeric"}
                    autoComplete="off"
                    value={form.campaign_off ? "0" : form[m] ?? ""}
                    onChange={(e) => {
                      const v = m === "spend" ? e.target.value.replace(/[^\d.,]/g, "") : e.target.value.replace(/\D/g, "");
                      setForm((f) => ({ ...f, [m]: v }));
                      setConfirmOdd(false);
                    }}
                    onKeyDown={onKey}
                    placeholder={m === "spend" ? "0.00" : "0"}
                    className={cn(inputCls, odd.includes(m) && "border-amber-500 focus:border-amber-500 focus:ring-amber-500/30")}
                  />
                  <span className="w-28 pb-3 text-right text-xs text-muted-foreground">
                    {prev != null ? <>prev. {m === "spend" ? formatINR(prev) : formatCount(prev)}</> : null}
                  </span>
                </label>
              );
            })}
          </fieldset>

          <div className="flex items-center justify-between rounded-xl bg-muted/50 px-3 py-2.5 text-sm">
            <span className="text-muted-foreground">Per lead (form) <span className="text-xs">· calculated</span></span>
            <span className="font-semibold tabular-nums">{cpl != null ? formatINR(cpl) : "—"}</span>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <label className="flex shrink-0 cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" checked={form.campaign_off} disabled={locked || editingOld}
                onChange={(e) => setForm((f) => ({ ...f, campaign_off: e.target.checked }))}
                className="size-4 accent-primary" />
              Campaign didn&apos;t run this day
            </label>
            <input value={form.note} maxLength={500} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
              placeholder="Note (optional)" disabled={locked || editingOld}
              className="h-9 w-full rounded-lg border bg-background px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30" />
          </div>

          {(locked || editingOld) && (
            <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
              {locked ? "This report has ended — ask your team leader to correct it." : "Only your team leader can change numbers older than 7 days."}
            </p>
          )}
          {confirmOdd && (
            <p role="alert" className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
              {odd.map((m) => METRIC_META[m as AdMetric].label).join(" and ")} {odd.length > 1 ? "are" : "is"} very different from the previous day. Check for a missing or extra zero, then save again.
            </p>
          )}

          <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
            {otherMissing.length > 0 && (
              <button type="button" disabled={!complete || save.isPending || locked || editingOld} onClick={() => submit(true)}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition hover:bg-muted disabled:opacity-50">
                Save &amp; next day →
              </button>
            )}
            <button type="submit" disabled={!complete || save.isPending || locked || editingOld}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50">
              {save.isPending ? <Loader2 className="size-4 animate-spin" /> : <CalendarCheck className="size-4" />}
              {confirmOdd ? "Save anyway" : existing ? "Save changes" : "Save"}
            </button>
          </div>
        </>
      )}
    </ModalShell>
  );
}
