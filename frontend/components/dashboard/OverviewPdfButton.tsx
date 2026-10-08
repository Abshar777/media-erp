"use client";

/**
 * "PDF" — downloads exactly what the Overview is showing. Sits at the end of
 * the header's filter row: the filters pick what you see, this takes it with
 * you. A quiet secondary button with the pickers' height and radius, so it
 * never competes with them.
 */
import { Download, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDownloadOverviewPdf, type OverviewPdfParams } from "@/hooks/useOverviewPdf";

interface Props {
  params: OverviewPdfParams;
  disabled?: boolean;
  className?: string;
}

export function OverviewPdfButton({ params, disabled, className }: Props) {
  const download = useDownloadOverviewPdf();
  const busy = download.isPending;
  return (
    <button
      type="button"
      onClick={() => download.mutate(params)}
      disabled={disabled || busy}
      aria-busy={busy}
      title="Download this overview as a PDF"
      aria-label={busy ? "Preparing the PDF" : "Download this overview as a PDF"}
      className={cn(
        "inline-flex min-h-[42px] w-full items-center self-stretch justify-center gap-2 rounded-xl border bg-card px-4 text-sm font-medium shadow-sm transition",
        "hover:border-primary/40 hover:bg-primary/5 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
        "disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-border disabled:hover:bg-card disabled:hover:text-foreground sm:w-auto",
        className,
      )}
    >
      {busy ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
      {busy ? "Preparing…" : "PDF"}
    </button>
  );
}
