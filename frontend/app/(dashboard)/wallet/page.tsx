"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, WalletCards } from "lucide-react";
import { Button } from "@/components/ui/button";
import { WalletView } from "@/components/wallet/WalletView";
import { useWallet, walletThisMonth } from "@/hooks/useWallet";

/**
 * My Wallet (2026-11-04) — the same wallet as in the HRMS: salary a day at a time, what came off and why, your
 * commission, and what finance has paid you. Your own only; a month at a time, back as far as you've been employed.
 */

const shift = (month: string, by: number) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + by, 1)).toISOString().slice(0, 7);
};
const monthLabel = (month: string) =>
  new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

export default function WalletPage() {
  const [month, setMonth] = useState(walletThisMonth);
  const { data: w, isLoading, isFetching, error } = useWallet(month);
  const first = w?.firstMonth ?? shift(walletThisMonth(), -12);
  const message = (error as { response?: { data?: { message?: string } } } | null)?.response?.data?.message;

  return (
    <div className="flex flex-col gap-5 pb-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight">
            <WalletCards className="size-5 text-primary" /> My Wallet
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Your pay a day at a time — what came off and why, your commission, and what finance has paid you.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-lg border">
            <Button variant="ghost" size="icon" aria-label="Previous month" disabled={month <= first} onClick={() => setMonth((m) => shift(m, -1))}>
              <ChevronLeft className="size-4" />
            </Button>
            <span className="min-w-[8.5rem] text-center text-sm font-medium">{monthLabel(month)}</span>
            <Button variant="ghost" size="icon" aria-label="Next month" disabled={month >= walletThisMonth()} onClick={() => setMonth((m) => shift(m, 1))}>
              <ChevronRight className="size-4" />
            </Button>
          </div>
          {isFetching && !isLoading && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>
      ) : error || !w ? (
        <div className="rounded-xl border bg-card p-6 text-center text-sm text-muted-foreground">
          {message ?? "Your wallet couldn't be loaded. Try again in a moment."}
        </div>
      ) : (
        <WalletView w={w} />
      )}
    </div>
  );
}
