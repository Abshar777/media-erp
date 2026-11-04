"use client";
import { useState } from "react";
import { AlertTriangle, Banknote, Coins, Landmark, ReceiptText, CalendarDays, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Wallet, WalletCommission, WalletDay, WalletItemGroup, WalletPayment, WalletStatus } from "@/types/wallet";

/*
 * The wallet (2026-11-04): what the month has earned, a day at a time, what came off and why, commission, the rest of
 * the payslip, and what finance has paid. Every figure comes from the server; this only lays them out.
 */

/** This app's card surface — the one every panel here uses. */
function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("rounded-xl border bg-card delta-shadow", className)}>{children}</div>;
}

const money = (n: number, c: string) => `${c} ${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const signed = (n: number, c: string) => `${n < 0 ? "−" : "+"}${money(n, c)}`;
const dayName = (key: string) =>
  new Date(`${key}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", timeZone: "UTC" });
const fullDay = (key: string | null) =>
  key ? new Date(`${key}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "—";
const time = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : null);

const HEADLINE: Record<WalletStatus, { label: string; tone: string }> = {
  in_progress: { label: "Earned so far this month", tone: "border-sky-500/25 bg-sky-500/10 text-sky-700 dark:text-sky-300" },
  awaiting_payroll: { label: "Earned — waiting for payroll", tone: "border-violet-500/25 bg-violet-500/10 text-violet-700 dark:text-violet-300" },
  payslip: { label: "Still to be paid", tone: "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300" },
  part_paid: { label: "Still to be paid · part paid", tone: "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300" },
  paid: { label: "Paid in full", tone: "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" },
  paused: { label: "Pay stopped for this month", tone: "border-border bg-muted text-muted-foreground" },
};

function Headline({ w }: { w: Wallet }) {
  const h = HEADLINE[w.status];
  const c = w.currency;
  const figure = w.status === "paid" ? w.totals.paid : w.status === "in_progress" || w.status === "awaiting_payroll" ? w.totals.net : w.totals.balance;
  const sub =
    w.status === "paused" ? (w.muted?.reason ? `HR: ${w.muted.reason}` : "HR has stopped this month's pay.")
    : w.status === "paid" ? `Finance paid ${money(w.totals.paid, c)} for this month.`
    : w.status === "part_paid" ? `Finance has paid ${money(w.totals.paid, c)} of ${money(w.totals.net, c)}.`
    : w.status === "payslip" ? "Your payslip is out — finance hasn't paid it yet."
    : w.status === "awaiting_payroll" ? "The month is over. Figures can still change until HR issues the payslip."
    : `Up to today. The rest of the month adds ${money(w.salary.perDay, c)} a day.`;
  return (
    <div className={cn("rounded-xl border px-4 py-3", h.tone)}>
      <p className="text-xs font-medium">{h.label}</p>
      <p className="text-2xl font-bold tracking-tight md:text-3xl">{w.status === "paused" ? "—" : money(figure, c)}</p>
      <p className="text-xs opacity-90">{sub}</p>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg bg-muted/50 px-3 py-2.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("text-base font-semibold tabular-nums md:text-lg", tone)}>{value}</p>
    </div>
  );
}

function Section({ title, sub, icon: Icon, children }: { title: string; sub?: string; icon: React.ElementType; children: React.ReactNode }) {
  return (
    <Card className="p-4">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-semibold"><Icon className="h-4 w-4 text-primary" />{title}</p>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      </div>
      {children}
    </Card>
  );
}

function DayRow({ d, c }: { d: WalletDay; c: string }) {
  const inT = time(d.checkIn), outT = time(d.checkOut);
  const off = d.deductions.reduce((s, x) => s + x.amount, 0);
  const muted = !d.counted || d.kind === "not_employed";
  return (
    <div className={cn("grid grid-cols-[3.75rem_minmax(0,1fr)_auto] items-start gap-3 py-2.5 text-sm", muted && "opacity-60")}>
      <p className="text-xs font-medium text-muted-foreground">{dayName(d.date)}</p>
      <div className="min-w-0">
        <p className="font-medium">
          {d.label}
          {(inT || outT) && <span className="font-normal text-muted-foreground"> · in {inT ?? "—"}{outT ? ` · out ${outT}` : ""}</span>}
        </p>
        {d.deductions.map((x, i) => <p key={i} className="text-xs text-red-600 dark:text-red-400">{x.reason}</p>)}
        {d.note && <p className="text-xs text-muted-foreground">{d.note}</p>}
      </div>
      <div className="text-right tabular-nums">
        <p className={cn("text-sm", d.credit > 0 && d.counted ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")}>
          {d.kind === "not_employed" ? "—" : `+${money(d.credit, c)}`}
        </p>
        {off > 0 && <p className="text-xs text-red-600 dark:text-red-400">−{money(off, c)}</p>}
      </div>
    </div>
  );
}

function SalaryDays({ w }: { w: Wallet }) {
  const [all, setAll] = useState(false);
  const c = w.currency;
  // Newest first: today's line on top. Days still to come sit at the end.
  const past = w.days.filter((d) => d.counted).reverse();
  const future = w.days.filter((d) => !d.counted);
  const shown = all ? [...past, ...future] : past.slice(0, 10);
  const lost = w.days.filter((d) => d.counted).flatMap((d) => d.deductions).reduce((s, x) => s + x.days, 0);
  const sub = [
    `${money(w.salary.perDay, c)} a day (salary ÷ 30)`,
    lost ? `${lost} day${lost === 1 ? "" : "s"} lost` : null,
  ].filter(Boolean).join(" · ");
  return (
    <Section title="Salary, day by day" sub={sub} icon={CalendarDays}>
      {w.salary.employedShare < 1 && (
        <p className="mb-1 text-xs text-muted-foreground">Part of the month — you were employed for {Math.round(w.salary.employedShare * 30)} of its 30 paid days.</p>
      )}
      <div className="divide-y divide-border/60">
        {shown.map((d) => <DayRow key={d.date} d={d} c={c} />)}
        {w.reconcile.map((r, i) => (
          <div key={`r${i}`} className="flex items-start justify-between gap-3 py-2.5 text-sm">
            <div><p className="font-medium">{r.kind === "lop" ? "Loss of pay" : r.kind === "late" ? "Late penalty" : "Early-out penalty"}</p><p className="text-xs text-muted-foreground">{r.reason}</p></div>
            <p className={cn("tabular-nums", r.amount > 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400")}>{r.amount > 0 ? "−" : "+"}{money(r.amount, c)}</p>
          </div>
        ))}
      </div>
      {(past.length > 10 || future.length > 0) && (
        <button type="button" onClick={() => setAll((v) => !v)} className="mt-1 text-xs font-medium text-primary hover:underline">
          {all ? "Show fewer days" : `Show all ${w.days.length} days${future.length ? ` (${future.length} still to come)` : ""}`}
        </button>
      )}
    </Section>
  );
}

const STEPS: Array<{ key: WalletCommission["state"]; label: string }> = [
  { key: "earned", label: "Earned" }, { key: "approved", label: "Approved by finance" }, { key: "on_payroll", label: "On payroll" }, { key: "paid", label: "Paid" },
];

function CommissionRows({ w }: { w: Wallet }) {
  if (!w.commission.length && !w.finance.crmError) return null;
  return (
    <Section title="Commission" sub="from finance" icon={Coins}>
      {w.finance.crmError && (
        <p className="mb-2 text-xs text-amber-700 dark:text-amber-300">The sales CRMs' commission couldn't be read just now: {w.finance.crmError}</p>
      )}
      <div className="divide-y divide-border/60">
        {w.commission.map((c, i) => {
          const at = STEPS.findIndex((s) => s.key === c.state);
          // A commission paid by receipt never rides on payroll — that step is not shown for it.
          const steps = STEPS.filter((s) => s.key !== "on_payroll" || c.state === "on_payroll" || /payroll/.test(c.note ?? ""));
          return (
            <div key={i} className="flex flex-wrap items-start justify-between gap-3 py-2.5 text-sm">
              <div className="min-w-0">
                <p className="font-medium">{c.name}</p>
                {c.detail && <p className="text-xs text-muted-foreground">{c.detail}</p>}
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {steps.map((s) => {
                    const done = STEPS.findIndex((x) => x.key === s.key) <= at;
                    return (
                      <span key={s.key} className={cn("rounded-md border px-1.5 py-0.5 text-[11px]",
                        done ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "border-border text-muted-foreground")}>
                        {s.label}
                      </span>
                    );
                  })}
                </div>
                {c.note && <p className="mt-1 text-xs text-muted-foreground">{c.note}</p>}
              </div>
              <p className={cn("tabular-nums", c.inBalance ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")}>{money(c.amount, c.currency)}</p>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

const GROUP: Record<WalletItemGroup, string> = {
  commission: "Commission", slab: "Salary slab", finance: "Finance", reimbursement: "Reimbursement", overtime: "Overtime",
  one_time: "One-time", paid_separately: "Paid separately", loan: "Loan", advance: "Salary advance", structure: "Salary structure",
};

function OtherItems({ w }: { w: Wallet }) {
  // Commission counted here rather than on a payslip is already a row under Commission, amount and all.
  const items = w.items.filter((it) => !(it.group === "commission" && w.commission.some((c) => c.inBalance && c.name === it.label)));
  if (!items.length) return null;
  const c = w.currency;
  return (
    <Section title="Everything else this month" icon={ReceiptText}>
      <div className="divide-y divide-border/60">
        {items.map((it, i) => (
          <div key={i} className={cn("flex items-start justify-between gap-3 py-2.5 text-sm", !it.counted && "opacity-60")}>
            <div className="min-w-0">
              <p className="font-medium">{it.label} <span className="ml-1 rounded-md border border-border px-1.5 py-0.5 text-[11px] font-normal text-muted-foreground">{GROUP[it.group]}</span></p>
              {it.note && <p className="text-xs text-muted-foreground">{it.note}</p>}
            </div>
            <p className={cn("tabular-nums", it.direction === "credit" ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400", !it.counted && "line-through")}>
              {signed(it.direction === "credit" ? it.amount : -it.amount, c)}
            </p>
          </div>
        ))}
      </div>
    </Section>
  );
}

function PaymentRow({ p, c }: { p: WalletPayment; c: string }) {
  const Icon = /cash/i.test(p.method) ? Banknote : Landmark;
  return (
    <div className={cn("grid grid-cols-[5.5rem_minmax(0,1fr)_auto] items-start gap-3 py-2.5 text-sm", p.reversed && "opacity-60")}>
      <p className="text-xs font-medium text-muted-foreground">{fullDay(p.date)}</p>
      <div className="min-w-0">
        <p className="font-medium"><Icon className="mr-1 inline h-3.5 w-3.5 align-[-2px] text-muted-foreground" />{[p.method, p.account].filter(Boolean).join(" · ") || p.label}</p>
        <p className="text-xs text-muted-foreground">{[p.label, p.reference && `Ref ${p.reference}`].filter(Boolean).join(" · ")}</p>
        {p.note && <p className={cn("text-xs", p.reversed ? "text-red-600 dark:text-red-400" : "text-muted-foreground")}>{p.note}</p>}
      </div>
      <p className={cn("tabular-nums", p.reversed && "line-through")}>{money(p.amount, c)}</p>
    </div>
  );
}

function Payments({ w }: { w: Wallet }) {
  const c = w.currency;
  const owing = w.totals.balance > 0 && w.status !== "in_progress" && w.status !== "paused";
  if (!w.payments.length && !owing) return null;
  return (
    <Section title="Payments from finance" sub={w.finance.runNumbers.length ? `Payroll ${w.finance.runNumbers.join(", ")}` : undefined} icon={Landmark}>
      <div className="divide-y divide-border/60">
        {w.payments.map((p, i) => <PaymentRow key={i} p={p} c={c} />)}
        {owing && (
          <div className="grid grid-cols-[5.5rem_minmax(0,1fr)_auto] items-start gap-3 py-2.5 text-sm text-amber-700 dark:text-amber-300">
            <p className="text-xs font-medium">—</p>
            <p className="font-medium">Not paid yet</p>
            <p className="tabular-nums">{money(w.totals.balance, c)}</p>
          </div>
        )}
      </div>
    </Section>
  );
}

export function WalletView({ w }: { w: Wallet }) {
  const c = w.currency;
  return (
    <div className="space-y-4">
      {!w.finance.connected && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>Finance couldn't be asked, so payments and commission may be missing. {w.finance.error}</span>
        </div>
      )}
      {w.finance.onHold && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span>Finance has your pay on hold: {w.finance.onHold}</span>
        </div>
      )}
      <Headline w={w} />
      <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
        <Stat label="Credited" value={`+${money(w.totals.credited, c)}`} tone="text-emerald-600 dark:text-emerald-400" />
        <Stat label="Deducted" value={`−${money(w.totals.deducted, c)}`} tone="text-red-600 dark:text-red-400" />
        <Stat label="Paid to you" value={money(w.totals.paid, c)} />
        <Stat label="Balance" value={`${w.totals.balance < 0 ? "−" : ""}${money(w.totals.balance, c)}`} />
      </div>
      <SalaryDays w={w} />
      <CommissionRows w={w} />
      <OtherItems w={w} />
      <Payments w={w} />
    </div>
  );
}
