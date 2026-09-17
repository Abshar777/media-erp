"use client";

/**
 * MediaLightbox — look at an attachment without leaving the page.
 *
 * Opening a new tab for every image meant losing the task you were reading and
 * coming back through the browser's back button. Anything we can render, we
 * render here; anything we can't (a .docx, a .zip) still opens in a tab,
 * because a viewer that shows a broken box is worse than an honest download.
 *
 * Portalled to the body: attachments live inside modals and scroll containers
 * that would otherwise clip a fixed overlay.
 */
import { useEffect, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, Download, ExternalLink, X } from "lucide-react";
import { SignedImg } from "@/components/shared/SignedImg";
import { cn } from "@/lib/utils";

export interface LightboxItem {
  url: string;
  filename: string;
  content_type: string;
  size?: number;
}

/** True when this file is something the lightbox can actually display. */
export function canPreview(contentType: string): boolean {
  const ct = (contentType || "").toLowerCase();
  return (
    ct.startsWith("image/") ||
    ct.startsWith("video/") ||
    ct.startsWith("audio/") ||
    ct === "application/pdf"
  );
}

function prettySize(bytes?: number): string {
  if (!bytes) return "";
  const units = ["B", "KB", "MB", "GB"];
  let n = bytes, i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i += 1; }
  return `${n < 10 && i > 0 ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
}

export function MediaLightbox({
  items,
  index,
  onIndexChange,
  onClose,
  onExpired,
}: {
  items: LightboxItem[];
  index: number;
  onIndexChange: (i: number) => void;
  onClose: () => void;
  /** Signed URLs expire; refetch so the backend re-signs them. */
  onExpired?: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const item = items[index];

  const go = useCallback((delta: number) => {
    if (items.length < 2) return;
    // Wrap, so paging past the end returns to the start rather than dead-ending.
    onIndexChange((index + delta + items.length) % items.length);
  }, [index, items.length, onIndexChange]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key === "ArrowRight") go(1);
    }
    window.addEventListener("keydown", onKey);
    // The page behind must not scroll while the viewer is up.
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [go, onClose]);

  if (!mounted || !item) return null;

  const ct = (item.content_type || "").toLowerCase();

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex flex-col bg-black/90 backdrop-blur-sm"
      onClick={onClose}
    >
      {/* Header */}
      <div
        className="flex shrink-0 items-center gap-3 px-4 py-3 text-white"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{item.filename}</p>
          <p className="text-[11px] text-white/60">
            {prettySize(item.size)}
            {items.length > 1 && `${item.size ? " · " : ""}${index + 1} of ${items.length}`}
          </p>
        </div>
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          title="Open in a new tab"
          className="rounded-lg p-2 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
        >
          <ExternalLink className="size-4" />
        </a>
        <a
          href={item.url}
          download={item.filename}
          title="Download"
          className="rounded-lg p-2 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
        >
          <Download className="size-4" />
        </a>
        <button
          type="button"
          onClick={onClose}
          title="Close"
          aria-label="Close"
          className="rounded-lg p-2 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
        >
          <X className="size-5" />
        </button>
      </div>

      {/* Stage */}
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-4 pb-4">
        {items.length > 1 && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); go(-1); }}
            aria-label="Previous"
            className="absolute left-2 z-10 rounded-full bg-black/50 p-2 text-white/80 transition-colors hover:bg-black/70 hover:text-white"
          >
            <ChevronLeft className="size-5" />
          </button>
        )}

        <div
          className="flex max-h-full max-w-full items-center justify-center"
          onClick={(e) => e.stopPropagation()}
        >
          {ct.startsWith("image/") ? (
            <SignedImg
              src={item.url}
              alt={item.filename}
              className="max-h-[80vh] max-w-full rounded-lg object-contain"
              onExpired={onExpired}
              fallback={<p className="text-sm text-white/70">Couldn&apos;t load this image.</p>}
            />
          ) : ct.startsWith("video/") ? (
            <video
              key={item.url}
              src={item.url}
              controls
              autoPlay
              playsInline
              className="max-h-[80vh] max-w-full rounded-lg"
            />
          ) : ct.startsWith("audio/") ? (
            <audio key={item.url} src={item.url} controls autoPlay className="w-[min(90vw,32rem)]" />
          ) : ct === "application/pdf" ? (
            <iframe
              key={item.url}
              src={item.url}
              title={item.filename}
              className="h-[80vh] w-[min(92vw,56rem)] rounded-lg bg-white"
            />
          ) : (
            <p className="text-sm text-white/70">This file can&apos;t be previewed.</p>
          )}
        </div>

        {items.length > 1 && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); go(1); }}
            aria-label="Next"
            className="absolute right-2 z-10 rounded-full bg-black/50 p-2 text-white/80 transition-colors hover:bg-black/70 hover:text-white"
          >
            <ChevronRight className="size-5" />
          </button>
        )}
      </div>

      {/* Filmstrip — only earns its space when there is something to page through */}
      {items.length > 1 && (
        <div
          className="flex shrink-0 justify-center gap-1.5 overflow-x-auto px-4 pb-4"
          onClick={(e) => e.stopPropagation()}
        >
          {items.map((it, i) => (
            <button
              key={it.url || i}
              type="button"
              onClick={() => onIndexChange(i)}
              className={cn(
                "size-12 shrink-0 overflow-hidden rounded-md border-2 transition-colors",
                i === index ? "border-white" : "border-transparent opacity-60 hover:opacity-100"
              )}
              title={it.filename}
            >
              {(it.content_type || "").startsWith("image/") ? (
                <SignedImg src={it.url} alt={it.filename} className="size-full object-cover" onExpired={onExpired} />
              ) : (
                <span className="flex size-full items-center justify-center bg-white/10 px-0.5 text-[8px] leading-tight text-white/70">
                  {it.filename.split(".").pop()?.toUpperCase() || "FILE"}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>,
    document.body
  );
}
