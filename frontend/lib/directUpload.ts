"use client";

/**
 * Direct-to-R2 uploads.
 *
 * The browser asks the backend for a short-lived pre-signed PUT URL, then
 * uploads the file bytes **straight to Cloudflare R2** — the bytes never pass
 * through our backend, so uploads up to 1 GB are supported. The backend only
 * signs the URL (R2 secret stays server-side); the public bucket URL is used
 * for viewing afterwards.
 */
import api from "@/lib/axios";
import type { Attachment } from "@/types/project";

/** Hard cap enforced client- and server-side. */
export const MAX_UPLOAD_BYTES = 1024 * 1024 * 1024; // 1 GB

export interface PresignResult {
  upload_url: string;
  method: string;
  headers: Record<string, string>;
  public_url: string;
  key: string;
  filename: string;
  content_type: string;
  backend: string;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

async function presign(files: File[], prefix = "attachments"): Promise<PresignResult[]> {
  const { data } = await api.post<{ success: boolean; data: PresignResult[] }>(
    "/media/presign",
    {
      prefix,
      files: files.map((f) => ({
        filename: f.name,
        content_type: f.type || "application/octet-stream",
        size: f.size,
      })),
    }
  );
  return data.data;
}

/** Errors worth trying again: R2 answers 503 "ServiceUnavailable" now and then, and networks blip. */
class RetryableUploadError extends Error {}

/**
 * PUT with up to 4 attempts (0.8 s, 2 s, 4.5 s apart) on 5xx / 408 / 429 /
 * network errors. Safe: re-sending the same bytes to the same pre-signed URL
 * simply overwrites one object. Other errors (403 expired URL, 400) fail at once.
 */
async function putWithRetry(
  presigned: PresignResult,
  file: File,
  onProgress?: (pct: number) => void,
  signal?: AbortSignal
): Promise<void> {
  const waits = [800, 2000, 4500];
  for (let attempt = 0; ; attempt++) {
    try {
      return await putWithProgress(presigned, file, onProgress, signal);
    } catch (err) {
      if (!(err instanceof RetryableUploadError) || attempt >= waits.length || signal?.aborted) {
        throw err instanceof RetryableUploadError ? new Error(err.message) : err;
      }
      onProgress?.(0);
      await new Promise((r) => setTimeout(r, waits[attempt]));
    }
  }
}

/** PUT a single file to a pre-signed URL, reporting 0–100 progress. */
function putWithProgress(
  presigned: PresignResult,
  file: File,
  onProgress?: (pct: number) => void,
  signal?: AbortSignal
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(presigned.method || "PUT", presigned.upload_url);
    Object.entries(presigned.headers || {}).forEach(([k, v]) =>
      xhr.setRequestHeader(k, v)
    );
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      const msg = `Upload failed (HTTP ${xhr.status})`;
      const retry = xhr.status >= 500 || xhr.status === 408 || xhr.status === 429;
      reject(retry ? new RetryableUploadError(msg) : new Error(msg));
    };
    xhr.onerror = () => reject(new RetryableUploadError("Network error during upload"));
    xhr.onabort = () => reject(new DOMException("Aborted", "AbortError"));
    if (signal) {
      if (signal.aborted) return xhr.abort();
      signal.addEventListener("abort", () => xhr.abort());
    }
    xhr.send(file);
  });
}

export interface DirectUploadOptions {
  prefix?: string;
  /** Called as each file progresses: (fileIndex, 0–100). */
  onProgress?: (index: number, pct: number) => void;
  signal?: AbortSignal;
}

/**
 * Upload files directly to R2 and return Attachment metadata for each,
 * in the same order as the input.
 */
export async function uploadFilesDirect(
  files: File[],
  opts: DirectUploadOptions = {}
): Promise<Attachment[]> {
  const oversized = files.find((f) => f.size > MAX_UPLOAD_BYTES);
  if (oversized) {
    throw new Error(
      `"${oversized.name}" is ${formatBytes(oversized.size)} — the maximum is 1 GB per file.`
    );
  }

  const presigned = await presign(files, opts.prefix);
  const out: Attachment[] = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const p = presigned[i];
    await putWithRetry(p, file, (pct) => opts.onProgress?.(i, pct), opts.signal);
    out.push({
      url: p.public_url,
      key: p.key,
      filename: p.filename,
      size: file.size,
      content_type: p.content_type,
      backend: p.backend,
    });
  }
  return out;
}
