"use client";
import Link from "next/link";
import { ArrowUpRight, WalletCards } from "lucide-react";
import { useWallet, walletThisMonth } from "@/hooks/useWallet";
import { cn } from "@/lib/utils";

/*
 * The wallet on the dashboard, first in its row (2026-11-04): this month so far from the HRMS — earned, deducted,
 * paid — and a way into My Wallet. Nothing when there is no wallet to show (no HRMS record, not linked): the dashboard
 * is not where to say why. While impersonating, the impersonated person's (2026-11-04).
 */

const money = (n: number, c: string) => `${c} ${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function WalletCard({ className }: { className?: string }) {
  const { data: w } = useWallet(walletThisMonth());
  if (!w) return null;
  const c = w.currency;
  const [label, figure] =
    w.status === "paid" ? ["Paid in full", w.totals.paid]
    : w.status === "payslip" || w.status === "part_paid" ? ["Still to be paid", w.totals.balance]
    : ["Earned so far this month", w.totals.net];
  const lost = w.days.filter((d) => d.counted).flatMap((d) => d.deductions).reduce((s, x) => s + x.days, 0);
  return (
    <Link href="/wallet" className={cn("block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2", className)}>
      <div className="rounded-xl border bg-card p-5 delta-shadow transition-colors hover:border-primary/40">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary"><WalletCards className="h-5 w-5" /></div>
            <div>
              <p className="text-xs text-muted-foreground">My wallet · {String(label).toLowerCase()}</p>
              <p className="text-2xl font-bold tracking-tight tabular-nums">{w.status === "paused" ? "—" : money(Number(figure), c)}</p>
            </div>
          </div>
          <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
          <div><p className="text-muted-foreground">Credited</p><p className="font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">+{money(w.totals.credited, c)}</p></div>
          <div><p className="text-muted-foreground">Deducted</p><p className="font-semibold tabular-nums text-red-600 dark:text-red-400">−{money(w.totals.deducted, c)}</p></div>
          <div><p className="text-muted-foreground">Paid</p><p className="font-semibold tabular-nums">{money(w.totals.paid, c)}</p></div>
        </div>
        {lost > 0 && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{lost} day{lost === 1 ? "" : "s"} of pay lost this month — see why</p>}
      </div>
    </Link>
  );
}
