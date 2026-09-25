"use client";

/**
 * Fund requests — ask finance for ad-spend money out of Marketing's budget.
 *
 * A request is saved here and handed to the finance app, where somebody
 * approves or rejects it; an approval is taken off Marketing's month there.
 * Decisions come back on their own (the server asks finance every minute), so
 * this page only has to show where each request has got to.
 */

import { useState } from "react";
import {
  AlertTriangle, CheckCircle2, Clock, CloudOff, Eye, Loader2, RefreshCw, Send, Wallet, XCircle,
} from "lucide-react";
import { useAuthStore } from "@/stores/authStore";
import {
  apiMessage,
  useCreateFundRequest,
  useFundRequestMeta,
  useFundRequests,
  useRetryFundRequest,
  type FundRequest,
  type FundRequestStatus,
} from "@/hooks/useFundRequests";
import { fmtDateTime } from "@/lib/datetime";
import { cn } from "@/lib/utils";

const inputCls =
  "w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30";

function thisMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(period: string): string {
  if (!/^\d{4}-\d{2}$/.test(period)) return period;
  return new Date(`${period}-01T00:00:00Z`).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

function money(minor: number, currency: string): string {
  return `${currency} ${(minor / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const STATUS_META: Record<FundRequestStatus, { label: string; icon: React.ElementType; cls: string }> = {
  pending:   { label: "Waiting to reach finance", icon: CloudOff,      cls: "bg-muted text-muted-foreground" },
  failed:    { label: "Not accepted",             icon: AlertTriangle, cls: "bg-rose-500/10 text-rose-600" },
  submitted: { label: "Waiting for approval",     icon: Clock,         cls: "bg-amber-500/10 text-amber-600" },
  approved:  { label: "Approved",                 icon: CheckCircle2,  cls: "bg-green-500/10 text-green-600" },
  rejected:  { label: "Rejected",                 icon: XCircle,       cls: "bg-rose-500/10 text-rose-600" },
};

function RequestForm({ platforms, currency }: { platforms: string[]; currency: string }) {
  const create = useCreateFundRequest();
  const [title, setTitle] = useState("");
  const [platform, setPlatform] = useState("");
  const [amount, setAmount] = useState("");
  const [period, setPeriod] = useState(thisMonth);
  const [purpose, setPurpose] = useState("");

  const valid =
    title.trim().length >= 3 &&
    !!platform &&
    Number(amount) > 0 &&
    /^\d{4}-\d{2}$/.test(period) &&
    purpose.trim().length >= 10;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || create.isPending) return;
    create.mutate(
      { title: title.trim(), platform, amount: amount.trim(), period, purpose: purpose.trim() },
      {
        // A refused request keeps what was typed, so it can be corrected
        // rather than typed out again.
        onSuccess: (req) => {
          if (req.status === "failed") return;
          setTitle(""); setPlatform(""); setAmount(""); setPurpose("");
        },
      }
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-2xl border bg-card p-4">
      <p className="text-sm font-semibold">New request</p>

      <label className="block space-y-1">
        <span className="text-xs font-medium text-muted-foreground">Title</span>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={120}
          placeholder="e.g. October open-day campaign"
          className={inputCls}
        />
      </label>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block space-y-1">
          <span className="text-xs font-medium text-muted-foreground">Platform</span>
          <select value={platform} onChange={(e) => setPlatform(e.target.value)} className={inputCls}>
            <option value="">Choose…</option>
            {platforms.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-medium text-muted-foreground">Month</span>
          <input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} className={inputCls} />
        </label>
      </div>

      <label className="block space-y-1">
        <span className="text-xs font-medium text-muted-foreground">Amount ({currency})</span>
        <input
          type="number"
          inputMode="decimal"
          min="0.01"
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00"
          className={cn(inputCls, "tabular-nums")}
        />
      </label>

      <label className="block space-y-1">
        <span className="text-xs font-medium text-muted-foreground">What it is for</span>
        <textarea
          value={purpose}
          onChange={(e) => setPurpose(e.target.value)}
          rows={4}
          maxLength={2000}
          placeholder="What the money will be spent on, and why."
          className={cn(inputCls, "resize-none")}
        />
      </label>

      <p className="text-[11px] text-muted-foreground">
        Once finance approves it, the amount is taken from Marketing&apos;s budget for that month.
      </p>

      <button
        type="submit"
        disabled={!valid || create.isPending}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity disabled:opacity-50"
      >
        {create.isPending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
        Send to finance
      </button>
    </form>
  );
}

function RequestCard({ r, showRequester, canRetry }: { r: FundRequest; showRequester: boolean; canRetry: boolean }) {
  const retry = useRetryFundRequest();
  const meta = STATUS_META[r.status] ?? STATUS_META.pending;
  const Icon = meta.icon;
  const decided = r.status === "approved" || r.status === "rejected";

  return (
    <div className="rounded-2xl border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{r.title}</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {r.platform} · {monthLabel(r.period)}
            {showRequester && r.requested_by.name && ` · ${r.requested_by.name}`}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-sm font-semibold tabular-nums">{money(r.amount_minor, r.currency)}</p>
          <span className={cn("mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium", meta.cls)}>
            <Icon className="size-3" /> {meta.label}
          </span>
        </div>
      </div>

      <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-xs text-foreground/75">{r.purpose}</p>

      {decided && (
        <p className="mt-2 rounded-lg bg-muted/40 px-2.5 py-1.5 text-[11px] text-muted-foreground">
          {r.status === "approved" ? "Approved" : "Rejected"} by {r.reviewed_by || "finance"}
          {r.reviewed_at && ` · ${fmtDateTime(r.reviewed_at)}`}
          {r.review_note && <>: <span className="text-foreground/80">{r.review_note}</span></>}
        </p>
      )}

      {(r.status === "failed" || r.status === "pending") && r.finance_error && (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-rose-500/5 px-2.5 py-1.5 text-[11px] text-rose-700 dark:text-rose-400">
          <span className="min-w-0 break-words">{r.finance_error}</span>
          {canRetry && (
            <button
              type="button"
              onClick={() => retry.mutate(r.id)}
              disabled={retry.isPending}
              className="flex shrink-0 items-center gap-1 rounded-md border border-rose-500/30 bg-background px-2 py-1 font-medium text-foreground hover:bg-muted disabled:opacity-50"
            >
              {retry.isPending ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
              Send again
            </button>
          )}
        </div>
      )}

      <p className="mt-2 text-[10px] text-muted-foreground/70">Requested {fmtDateTime(r.created_at)}</p>
    </div>
  );
}

export default function FundRequestsPage() {
  const user = useAuthStore((s) => s.user);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canCreate = hasPermission("fund_requests", "create");
  const [scope, setScope] = useState<"mine" | "all">("mine");
  const { data: meta } = useFundRequestMeta();
  const { data, isLoading, isError, error } = useFundRequests(scope);

  const items = data?.items ?? [];
  const canSeeAll = data?.meta.can_see_all ?? meta?.can_see_all ?? false;
  const configured = data?.meta.finance_configured ?? meta?.finance_configured ?? true;
  const waiting = items.filter((r) => r.status === "submitted").length;

  return (
    <div className="flex flex-col gap-5 pb-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight">
          <Wallet className="size-5 text-primary" /> Fund Requests
        </h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Ask finance for ad-spend money from Marketing&apos;s budget. Finance approves or rejects it here in the list.
        </p>
      </div>

      {!configured && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2.5 text-xs text-amber-700 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          Finance isn&apos;t connected on this server yet. Requests are saved and will be sent as soon as it is.
        </div>
      )}

      <div className={cn("grid grid-cols-1 gap-5", canCreate && "lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]")}>
        {canCreate && (
          <div className="lg:sticky lg:top-4 lg:self-start">
            <RequestForm platforms={meta?.platforms ?? []} currency={meta?.currency ?? "AED"} />
          </div>
        )}

        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex w-fit max-w-full gap-1 overflow-x-auto rounded-xl border bg-muted/50 p-1">
              {(["mine", "all"] as const)
                .filter((s) => s === "mine" || canSeeAll)
                .map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setScope(s)}
                    className={cn(
                      "flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition-all",
                      scope === s ? "border bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {s === "all" && <Eye className="size-3.5" />}
                    {s === "mine" ? "My requests" : "Everyone's"}
                  </button>
                ))}
            </div>
            {waiting > 0 && (
              <span className="rounded-full bg-amber-500/10 px-2.5 py-1 text-[11px] font-medium text-amber-600">
                {waiting} waiting for approval
              </span>
            )}
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-24">
              <Loader2 className="size-7 animate-spin text-muted-foreground" />
            </div>
          ) : isError ? (
            <div className="rounded-2xl border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
              {apiMessage(error, "Could not load fund requests")}
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border bg-card py-20 text-muted-foreground/60">
              <Wallet className="size-10" />
              <p className="text-sm font-medium">No fund requests yet</p>
              {canCreate && scope === "mine" && <p className="text-xs">Make one with the form — finance is told straight away.</p>}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
              {items.map((r) => (
                <RequestCard
                  key={r.id}
                  r={r}
                  showRequester={scope === "all"}
                  canRetry={canCreate && (r.requested_by.id === user?.id || canSeeAll)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
