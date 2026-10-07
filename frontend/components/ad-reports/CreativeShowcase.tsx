"use client";

/**
 * The ad itself, at the top of a report — so anyone opening it recognises the
 * campaign by its creative before reading a single number.
 *
 * A square stage shows the selected creative whole (object-contain: ads are
 * 1:1, 4:5 or 9:16 and must not be cropped); a thumbnail strip switches
 * between variants; the first creative is the cover used on cards. Files go
 * straight to R2 (lib/directUpload) and are then registered with the report.
 * Click the stage for the full-screen viewer.
 */
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Expand, FileText, ImagePlus, Loader2, Play, Plus, Star, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { SignedImg } from "@/components/shared/SignedImg";
import { MediaLightbox } from "@/components/shared/MediaLightbox";
import { uploadFilesDirect } from "@/lib/directUpload";
import { adErrorMessage, useAddCreative, useRemoveCreative, useSetCover } from "@/hooks/useAdReports";
import type { AdCreative, AdReport } from "@/types/adReport";

const MAX = 12;
const ACCEPT = "image/jpeg,image/png,image/gif,image/webp,image/avif,image/heic,video/*,application/pdf";
const isImage = (c: { content_type: string }) => c.content_type.startsWith("image/");
const isVideo = (c: { content_type: string }) => c.content_type.startsWith("video/");
// Mirrors the server: images (not SVG, which can carry script), videos, PDFs.
const accepted = (f: File) =>
  (/^(image|video)\//.test(f.type) && f.type !== "image/svg+xml") || f.type === "application/pdf";

/**
 * A video from a signed URL. On error it asks for a fresh link ONCE per URL
 * (like SignedImg); a second failure shows the fallback instead of looping
 * refetch → new URL → error → refetch forever on a file the browser can't play.
 */
function SignedVideo({ src, className, onExpired, fallback }: {
  src: string; className?: string; onExpired: () => void; fallback: React.ReactNode;
}) {
  const retriedFor = useRef<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  if (failed) return <>{fallback}</>;
  return (
    <video
      src={`${src}#t=0.1`} muted playsInline preload="metadata" className={className}
      onError={() => {
        const base = src.split("?")[0];
        if (retriedFor.current === base) { setFailed(true); return; }
        retriedFor.current = base;
        onExpired();
      }}
    />
  );
}

/** Small creative tile for report cards (cover only). */
export function CreativeThumb({ creative, className }: { creative?: AdCreative; className?: string }) {
  const qc = useQueryClient();
  const refetch = () => qc.invalidateQueries({ queryKey: ["ad-reports"] });
  const box = cn("relative shrink-0 overflow-hidden rounded-lg border bg-muted", className);
  if (!creative) {
    return <div className={cn(box, "flex items-center justify-center text-muted-foreground")}><ImagePlus className="size-4 opacity-50" /></div>;
  }
  if (isImage(creative)) {
    return <div className={box}><SignedImg src={creative.url} alt="" onExpired={refetch} className="size-full object-cover"
      fallback={<FileText className="m-auto size-4 text-muted-foreground" />} /></div>;
  }
  if (isVideo(creative)) {
    return (
      <div className={box}>
        <SignedVideo src={creative.url} className="size-full object-cover" onExpired={refetch} fallback={<span className="block size-full bg-black/80" />} />
        <Play className="absolute inset-0 m-auto size-3.5 fill-white text-white drop-shadow" />
      </div>
    );
  }
  return <div className={cn(box, "flex items-center justify-center text-red-500")}><FileText className="size-4" /></div>;
}

interface Props {
  report: AdReport;
  meId: string;
  className?: string;
}

export function CreativeShowcase({ report, meId, className }: Props) {
  const qc = useQueryClient();
  const add = useAddCreative();
  const cover = useSetCover();
  const remove = useRemoveCreative();
  const input = useRef<HTMLInputElement>(null);

  const items = report.creatives ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [viewer, setViewer] = useState<number | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [drag, setDrag] = useState(false);
  const [progress, setProgress] = useState<number[] | null>(null);

  const idx = Math.max(0, items.findIndex((c) => c.id === selectedId));
  const current = items[idx];
  const canUpload = !!report.can_enter && (report.status !== "ended" || !!report.can_manage);
  const canRemove = !!current && canUpload && (report.can_manage || current.uploaded_by === meId);
  const refetch = () => qc.invalidateQueries({ queryKey: ["ad-reports"] });
  const busy = progress !== null;

  async function upload(list: FileList | File[] | null) {
    const files = Array.from(list ?? []);
    if (!files.length || busy) return;
    const good = files.filter(accepted);
    if (good.length < files.length) toast.error("Only images (JPG, PNG, GIF, WebP), videos and PDFs can be added as creatives.");
    const room = MAX - items.length;
    if (good.length > room) toast.error(`A report holds up to ${MAX} creatives — adding the first ${Math.max(room, 0)}.`);
    const batch = good.slice(0, Math.max(room, 0));
    if (!batch.length) return;
    setProgress(batch.map(() => 0));
    try {
      const uploaded = await uploadFilesDirect(batch, {
        prefix: "ad-creatives",
        onProgress: (i, pct) => setProgress((p) => (p ? p.map((v, j) => (j === i ? pct : v)) : p)),
      });
      let lastId: string | null = null;
      for (const f of uploaded) {
        const list2 = await add.mutateAsync({ id: report.id, key: f.key, filename: f.filename, size: f.size, content_type: f.content_type });
        lastId = list2[list2.length - 1]?.id ?? null;
      }
      if (lastId) setSelectedId(lastId);
      toast.success(uploaded.length === 1 ? "Creative added" : `${uploaded.length} creatives added`);
    } catch (e) {
      toast.error(e instanceof Error && !("response" in e) ? e.message : adErrorMessage(e, "Upload failed — please try again"));
    } finally {
      setProgress(null);
      if (input.current) input.current.value = "";
    }
  }

  const pct = progress ? Math.round(progress.reduce((a, b) => a + b, 0) / progress.length) : 0;
  const dropProps = canUpload ? {
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); setDrag(true); },
    onDragLeave: () => setDrag(false),
    onDrop: (e: React.DragEvent) => { e.preventDefault(); setDrag(false); upload(e.dataTransfer.files); },
  } : {};

  return (
    <div className={cn("space-y-2", className)}>
      <input ref={input} type="file" accept={ACCEPT} multiple hidden onChange={(e) => upload(e.target.files)} />

      {/* Stage */}
      <div
        {...dropProps}
        className={cn(
          "group relative aspect-[4/3] overflow-hidden rounded-xl border bg-muted/50 sm:aspect-square",
          drag && "border-primary ring-2 ring-primary/30",
        )}
      >
        {current ? (
          <button type="button" onClick={() => setViewer(idx)} aria-label={`View ${current.filename} full screen`}
            className="block size-full outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {isImage(current) ? (
              <SignedImg src={current.url} alt={current.filename} onExpired={refetch} className="size-full object-contain"
                fallback={<span className="flex size-full items-center justify-center text-xs text-muted-foreground">Preview unavailable</span>} />
            ) : isVideo(current) ? (
              <span className="relative block size-full bg-black">
                <SignedVideo src={current.url} className="size-full object-contain" onExpired={refetch}
                  fallback={<span className="flex size-full items-center justify-center px-4 text-center text-xs text-white/70">This video can&apos;t be previewed here — open it full screen or download it.</span>} />
                <span className="absolute inset-0 m-auto flex size-12 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm">
                  <Play className="size-5 fill-white" />
                </span>
              </span>
            ) : (
              <span className="flex size-full flex-col items-center justify-center gap-2 p-4 text-center">
                <FileText className="size-10 text-red-500" />
                <span className="line-clamp-2 text-xs font-medium">{current.filename}</span>
                <span className="text-[11px] text-muted-foreground">PDF · click to open</span>
              </span>
            )}
          </button>
        ) : canUpload ? (
          <button type="button" onClick={() => input.current?.click()} disabled={busy}
            className={cn("flex size-full flex-col items-center justify-center gap-2 border-2 border-dashed p-4 text-center transition",
              "rounded-xl border-muted-foreground/25 hover:border-primary/50 hover:bg-primary/5", drag && "border-primary bg-primary/5")}>
            <span className="flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary"><ImagePlus className="size-5" /></span>
            <span className="text-sm font-semibold">Add the ad</span>
            <span className="text-[11px] leading-snug text-muted-foreground">Image, video or PDF<br />drop here or click</span>
          </button>
        ) : (
          <div className="flex size-full flex-col items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
            <ImagePlus className="size-6 opacity-50" />No creative yet
          </div>
        )}

        {/* Badges */}
        {current && items.length > 1 && (
          <span className="pointer-events-none absolute right-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-medium text-white tabular-nums">
            {idx + 1}/{items.length}
          </span>
        )}
        {current && idx === 0 && items.length > 1 && (
          <span className="pointer-events-none absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-medium text-white">
            <Star className="size-2.5 fill-amber-400 text-amber-400" /> Cover
          </span>
        )}

        {/* Toolbar — always visible on touch, on hover/focus elsewhere */}
        {current && !busy && (
          <div className="absolute inset-x-2 bottom-2 flex items-center justify-end gap-1 transition sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
            {confirmRemove ? (
              <span className="flex items-center gap-1 rounded-lg bg-black/75 px-2 py-1 text-[11px] text-white backdrop-blur-sm">
                Remove?
                <button type="button" className="rounded px-1.5 py-0.5 hover:bg-white/15" onClick={() => setConfirmRemove(false)}>No</button>
                <button type="button" className="rounded bg-red-500 px-1.5 py-0.5 font-medium hover:bg-red-600"
                  onClick={() => { remove.mutate({ id: report.id, creativeId: current.id }); setConfirmRemove(false); setSelectedId(null); }}>
                  Remove
                </button>
              </span>
            ) : (
              <>
                {canUpload && idx > 0 && (
                  <ToolBtn label="Make this the cover" onClick={() => { cover.mutate({ id: report.id, creativeId: current.id }); }}>
                    <Star className="size-3.5" />
                  </ToolBtn>
                )}
                {canRemove && <ToolBtn label="Remove" onClick={() => setConfirmRemove(true)}><Trash2 className="size-3.5" /></ToolBtn>}
                <ToolBtn label="View full screen" onClick={() => setViewer(idx)}><Expand className="size-3.5" /></ToolBtn>
              </>
            )}
          </div>
        )}

        {/* Upload progress */}
        {busy && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background/80 backdrop-blur-sm">
            <Loader2 className="size-5 animate-spin text-primary" />
            <span className="text-xs font-medium">Uploading {progress!.length > 1 ? `${progress!.length} files` : "…"} {pct}%</span>
            <span className="h-1 w-2/3 overflow-hidden rounded-full bg-muted"><span className="block h-full bg-primary transition-all" style={{ width: `${pct}%` }} /></span>
          </div>
        )}
      </div>

      {/* Thumbnail strip */}
      {(items.length > 1 || (items.length > 0 && canUpload)) && (
        <div className="grid grid-cols-6 gap-1.5" role="listbox" aria-label="Creatives">
          {items.map((c, i) => (
            <button key={c.id} type="button" role="option" aria-selected={i === idx} title={c.filename}
              onClick={() => { setSelectedId(c.id); setConfirmRemove(false); }}
              className={cn("aspect-square rounded-lg outline-none transition focus-visible:ring-2 focus-visible:ring-ring",
                i === idx ? "ring-2 ring-primary ring-offset-1 ring-offset-card" : "opacity-75 hover:opacity-100")}>
              <CreativeThumb creative={c} className="size-full" />
            </button>
          ))}
          {canUpload && items.length < MAX && (
            <button type="button" onClick={() => input.current?.click()} disabled={busy} aria-label="Add creatives"
              className="flex aspect-square items-center justify-center rounded-lg border border-dashed text-muted-foreground transition hover:border-primary/50 hover:text-primary disabled:opacity-50">
              <Plus className="size-4" />
            </button>
          )}
        </div>
      )}

      {viewer !== null && items.length > 0 && (
        <MediaLightbox
          items={items.map((c) => ({ url: c.url, filename: c.filename, content_type: c.content_type, size: c.size }))}
          index={Math.min(viewer, items.length - 1)}
          onIndexChange={(i) => { setViewer(i); setSelectedId(items[i]?.id ?? null); }}
          onClose={() => setViewer(null)}
          onExpired={refetch}
        />
      )}
    </div>
  );
}

function ToolBtn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={(e) => { e.stopPropagation(); onClick(); }}
      className="flex size-7 items-center justify-center rounded-lg bg-black/60 text-white backdrop-blur-sm transition hover:bg-black/80">
      {children}
    </button>
  );
}
