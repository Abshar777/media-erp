"use client";

/**
 * FileUploader — a reusable drag-and-drop uploader that sends files
 * **directly to Cloudflare R2** (via pre-signed URLs; bytes never touch our
 * backend, so up to 1 GB per file). Shows live progress, previews images/video,
 * and lets the user view or remove uploaded files at any time.
 *
 * Controlled component: pass `value` (Attachment[]) and `onChange`.
 */
import { useCallback, useRef, useState } from "react";
import {
  Upload, Loader2, X, Trash2, ExternalLink, Eye,
  File as FileIcon, FileText, FileVideo, FileAudio, ImageIcon,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { uploadFilesDirect, formatBytes, MAX_UPLOAD_BYTES } from "@/lib/directUpload";
import { SignedImg } from "@/components/shared/SignedImg";
import { MediaLightbox, canPreview } from "@/components/shared/MediaLightbox";
import type { Attachment } from "@/types/project";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface FileUploaderProps {
  value: Attachment[];
  onChange?: (files: Attachment[]) => void;
  readOnly?: boolean;
  /** Max total files allowed (default 20). */
  maxFiles?: number;
  /** HTML input `accept` (e.g. "image/*,video/*"). Default: any file. */
  accept?: string;
  /** R2 key prefix / folder (default "attachments"). */
  prefix?: string;
  /** Dropzone helper label. */
  label?: string;
  className?: string;
  /** Smaller, denser layout for tight spaces (e.g. chat composer). */
  compact?: boolean;
}

interface Uploading {
  id: string;
  name: string;
  size: number;
  pct: number;
}

function kind(contentType: string): "image" | "video" | "audio" | "pdf" | "file" {
  if (contentType.startsWith("image/")) return "image";
  if (contentType.startsWith("video/")) return "video";
  if (contentType.startsWith("audio/")) return "audio";
  if (contentType.includes("pdf") || contentType.includes("document") || contentType.includes("text"))
    return "pdf";
  return "file";
}

function TypeIcon({ contentType, className }: { contentType: string; className?: string }) {
  const k = kind(contentType);
  if (k === "image") return <ImageIcon className={className} />;
  if (k === "video") return <FileVideo className={className} />;
  if (k === "audio") return <FileAudio className={className} />;
  if (k === "pdf") return <FileText className={className} />;
  return <FileIcon className={className} />;
}

export function FileUploader({
  value,
  onChange,
  readOnly = false,
  maxFiles = 20,
  accept,
  prefix = "attachments",
  label = "Click to upload or drag & drop",
  className,
  compact = false,
}: FileUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<Uploading[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const qc = useQueryClient();

  // Thumbnails are signed URLs with a 1 h TTL. If one expires while the modal
  // is open, refetch the queries that carry attachments so it re-signs.
  const refreshSignedUrls = () => {
    qc.invalidateQueries({ queryKey: ["projects"] });
    qc.invalidateQueries({ queryKey: ["chat"] });
  };

  const busy = uploading.length > 0;
  const atLimit = value.length + uploading.length >= maxFiles;

  const handleFiles = useCallback(
    async (fileList: FileList | null) => {
      if (!fileList || fileList.length === 0 || !onChange) return;
      let files = Array.from(fileList);

      // Enforce the total-count cap.
      const room = maxFiles - value.length - uploading.length;
      if (room <= 0) {
        toast.error(`You can attach at most ${maxFiles} file${maxFiles === 1 ? "" : "s"}.`);
        return;
      }
      if (files.length > room) {
        toast.error(`Only ${room} more file${room === 1 ? "" : "s"} can be added.`);
        files = files.slice(0, room);
      }

      // Enforce the 1 GB per-file limit up front.
      const tooBig = files.find((f) => f.size > MAX_UPLOAD_BYTES);
      if (tooBig) {
        toast.error(`"${tooBig.name}" is ${formatBytes(tooBig.size)} — the maximum is 1 GB per file.`);
        return;
      }

      const entries: Uploading[] = files.map((f, i) => ({
        id: `${Date.now()}-${i}-${f.name}`,
        name: f.name,
        size: f.size,
        pct: 0,
      }));
      setUploading((prev) => [...prev, ...entries]);

      try {
        const uploaded = await uploadFilesDirect(files, {
          prefix,
          onProgress: (index, pct) =>
            setUploading((prev) =>
              prev.map((u) => (u.id === entries[index].id ? { ...u, pct } : u))
            ),
        });
        onChange([...value, ...uploaded]);
        toast.success(`${uploaded.length} file${uploaded.length === 1 ? "" : "s"} uploaded`);
      } catch (err) {
        toast.error((err as Error)?.message || "Upload failed");
      } finally {
        setUploading((prev) => prev.filter((u) => !entries.some((e) => e.id === u.id)));
      }
    },
    [maxFiles, onChange, prefix, uploading.length, value]
  );

  function remove(i: number) {
    if (!onChange) return;
    onChange(value.filter((_, idx) => idx !== i));
  }

  const thumb = compact ? "size-14" : "size-24";

  // Which attachment the viewer is showing, or null when it is closed. Paging
  // runs over everything previewable, so Next never lands on a .docx.
  const viewable = value.filter((a) => canPreview(a.content_type));
  const [viewing, setViewing] = useState<number | null>(null);

  return (
    <div className={cn("space-y-3", className)}>
      {/* Uploaded files grid */}
      {(value.length > 0 || uploading.length > 0) && (
        <div className={cn("grid gap-2", compact ? "grid-cols-4 sm:grid-cols-6" : "grid-cols-3 sm:grid-cols-4")}>
          {value.map((a, i) => (
            <div key={a.key || a.url || i} className="group relative">
              {/* Previewable files open in the in-app viewer; everything else
                  still opens in a tab, where the browser can at least download
                  it. Rendered as a button vs. a link accordingly, so the hover
                  affordance matches what the click actually does. */}
              {canPreview(a.content_type) ? (
              <button
                type="button"
                onClick={() => setViewing(viewable.findIndex((v) => (v.key || v.url) === (a.key || a.url)))}
                title={`View ${a.filename}`}
                className={cn(
                  "flex w-full flex-col items-center justify-center overflow-hidden rounded-lg border bg-muted/30 hover:border-primary/50 transition-colors",
                  thumb
                )}
              >
                {kind(a.content_type) === "image" ? (
                  <SignedImg
                    src={a.url}
                    alt={a.filename}
                    className="h-full w-full object-cover"
                    onExpired={refreshSignedUrls}
                    fallback={
                      <div className="flex flex-col items-center justify-center gap-1 p-1 text-center">
                        <TypeIcon contentType={a.content_type} className="size-6 text-muted-foreground" />
                        <span className="line-clamp-2 break-all text-[9px] leading-tight text-muted-foreground">
                          {a.filename}
                        </span>
                      </div>
                    }
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center gap-1 p-1 text-center">
                    <TypeIcon contentType={a.content_type} className="size-6 text-muted-foreground" />
                    <span className="line-clamp-2 break-all text-[9px] leading-tight text-muted-foreground">
                      {a.filename}
                    </span>
                  </div>
                )}
                <span className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                  <Eye className="size-4 text-white drop-shadow" />
                </span>
              </button>
              ) : (
              <a
                href={a.url}
                target="_blank"
                rel="noopener noreferrer"
                title={`Open ${a.filename}`}
                className={cn(
                  "flex flex-col items-center justify-center overflow-hidden rounded-lg border bg-muted/30 hover:border-primary/50 transition-colors",
                  thumb
                )}
              >
                <div className="flex flex-col items-center justify-center gap-1 p-1 text-center">
                  <TypeIcon contentType={a.content_type} className="size-6 text-muted-foreground" />
                  <span className="line-clamp-2 break-all text-[9px] leading-tight text-muted-foreground">
                    {a.filename}
                  </span>
                </div>
                <span className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                  <ExternalLink className="size-4 text-white drop-shadow" />
                </span>
              </a>
              )}
              {/* filename + size caption for images */}
              {kind(a.content_type) === "image" && (
                <span className="absolute bottom-0 inset-x-0 truncate rounded-b-lg bg-black/45 px-1 py-0.5 text-[8px] text-white">
                  {a.filename}
                </span>
              )}
              {!readOnly && (
                <button
                  type="button"
                  onClick={() => remove(i)}
                  title="Remove"
                  className="absolute -right-1.5 -top-1.5 rounded-full bg-destructive p-0.5 text-white opacity-0 shadow transition-opacity group-hover:opacity-100"
                >
                  <X className="size-3" />
                </button>
              )}
            </div>
          ))}

          {/* In-flight uploads */}
          {uploading.map((u) => (
            <div
              key={u.id}
              className={cn(
                "flex flex-col items-center justify-center gap-1 rounded-lg border bg-muted/40 p-1.5 text-center",
                thumb
              )}
            >
              <Loader2 className="size-4 animate-spin text-primary" />
              <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${u.pct}%` }}
                />
              </div>
              <span className="text-[9px] font-medium text-muted-foreground">{u.pct}%</span>
            </div>
          ))}
        </div>
      )}

      {/* Dropzone */}
      {!readOnly && !atLimit && (
        <>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={accept}
            className="hidden"
            onChange={(e) => {
              handleFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              handleFiles(e.dataTransfer.files);
            }}
            disabled={busy}
            className={cn(
              "flex w-full flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed transition-colors",
              compact ? "py-3" : "py-6",
              dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-muted/30",
              busy && "pointer-events-none opacity-60"
            )}
          >
            {busy ? (
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            ) : (
              <Upload className="size-5 text-muted-foreground" />
            )}
            <span className="text-xs font-medium">{busy ? "Uploading…" : label}</span>
            {!compact && (
              <span className="text-[10px] text-muted-foreground">
                Any file type · up to 1 GB · uploaded straight to secure storage
              </span>
            )}
          </button>
        </>
      )}

      {readOnly && value.length === 0 && (
        <p className="text-xs italic text-muted-foreground/50">No files</p>
      )}

      {viewing !== null && viewable[viewing] && (
        <MediaLightbox
          items={viewable}
          index={viewing}
          onIndexChange={setViewing}
          onClose={() => setViewing(null)}
          onExpired={refreshSignedUrls}
        />
      )}
    </div>
  );
}

export default FileUploader;
