"use client";

/**
 * Download the Overview as a PDF — same member + date filters as the page.
 * The server builds it from the very query that feeds the Overview, so the
 * PDF and the screen can't disagree. Goes through the shared axios client so
 * an expired access token is refreshed like any other request.
 */
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import api from "@/lib/axios";

export interface OverviewPdfParams {
  member_id?: string;
  date_filter?: string;
  date_from?: string;
  date_to?: string;
  /** Overview preset key ("last7", "last_month" …) — only labels the dates. */
  range_name?: string;
}

function filenameFrom(disposition: string | undefined): string {
  const m = /filename="?([^";]+)"?/i.exec(disposition ?? "");
  return m?.[1] || "overview.pdf";
}

export function useDownloadOverviewPdf() {
  return useMutation({
    mutationFn: async (params: OverviewPdfParams) => {
      const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => !!v));
      const res = await api.get<Blob>("/projects/overview/pdf", { params: clean, responseType: "blob" });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = filenameFrom(res.headers["content-disposition"] as string | undefined);
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Some browsers start the download asynchronously — don't pull the blob away under them.
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    },
    onSuccess: () => toast.success("Overview PDF downloaded"),
    onError: () => toast.error("Couldn't create the PDF. Please try again."),
  });
}
