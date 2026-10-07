"use client";

/**
 * Overview banner: "📊 2 ad reports need numbers — Update now".
 * Renders nothing unless something of yours is waiting, so nobody else ever
 * sees it. Dismissible for the rest of the IST day (per person, per browser).
 */
import { useState } from "react";
import Link from "next/link";
import { BarChart3, X } from "lucide-react";
import { useAdToday } from "@/hooks/useAdReports";
import { istTodayKey } from "@/lib/datetime";
import { missingPhrase } from "@/lib/adReports";
import { useAuthStore } from "@/stores/authStore";

export function AdReportsBanner() {
  const { data } = useAdToday();
  const today = istTodayKey();
  // Per person: on a shared computer one person hiding it must not hide it for the next.
  const userId = useAuthStore((s) => s.user?.id ?? "");
  const KEY = `ad-reports:banner-dismissed:${userId}`;
  const [hiddenNow, setHiddenNow] = useState(false);
  const due = data?.my_due ?? [];
  if (!due.length || hiddenNow || !userId) return null;
  // Read at render (data only exists after hydration, so no SSR mismatch).
  let stored = false;
  try { stored = localStorage.getItem(KEY) === today; } catch { /* private mode */ }
  if (stored) return null;

  const first = due[0];
  const href = `/ad-reports?report=${first.id}&entry=1`;
  const text = due.length === 1
    ? <><span className="font-semibold">{first.name}</span> needs numbers for {missingPhrase(first.missing)}</>
    : <><span className="font-semibold">{due.length} ad reports</span> need numbers</>;

  return (
    <div role="status" className="flex items-center gap-3 rounded-xl border border-teal-500/30 bg-teal-500/5 px-4 py-3">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-teal-500/15 text-teal-700 dark:text-teal-400">
        <BarChart3 className="size-4" />
      </div>
      <p className="min-w-0 flex-1 text-sm">{text}</p>
      <Link href={href} className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90">
        Update now
      </Link>
      <button
        type="button"
        aria-label="Hide for today"
        onClick={() => { setHiddenNow(true); try { localStorage.setItem(KEY, today); } catch { /* private mode */ } }}
        className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
