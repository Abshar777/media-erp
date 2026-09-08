# Direct-to-R2 File Uploads — Implementation & Porting Guide

How file uploading works in mediaERP, end to end, and how to reproduce it in another project.

Extracted from the live implementation:

| Layer | File |
|---|---|
| Config | `backend/app/config.py` |
| Storage helper | `backend/app/utils/storage.py` |
| HTTP endpoints | `backend/app/routers/media.py` |
| CORS bootstrap | `backend/scripts/set_r2_cors.py` |
| Browser upload lib | `frontend/lib/directUpload.ts` |
| React Query hook | `frontend/hooks/useUpload.ts` |
| Drag-drop UI | `frontend/components/shared/FileUploader.tsx` |
| Shared type | `frontend/types/project.ts` → `Attachment` |

Stack here is FastAPI + boto3 and Next.js + TypeScript, but the pattern is stack-agnostic — any
S3-compatible SDK and any browser can do this.

---

## 1. The core idea

**File bytes never pass through the application server.**

The naive approach is `browser → your API → object storage`. That makes your API a bottleneck: it
must buffer the whole file in RAM or on disk, it burns your bandwidth twice, request-body limits cap
file size (proxies like Vercel/Cloudflare/nginx typically cut off at 4–100 MB), and a slow uploader
holds a worker thread hostage for minutes.

The pattern used here is **pre-signed direct upload**:

1. Browser tells the backend *"I want to upload these files"* — names, MIME types, sizes only.
2. Backend signs a short-lived URL per file using the R2 secret key and returns it.
3. Browser `PUT`s the raw bytes **straight to Cloudflare R2**. The backend is not involved.
4. Browser sends the resulting metadata (public URL, key, size…) back to the backend to persist
   alongside whatever domain object owns it — a task, a chat message, a post.

Your API only ever handles a few hundred bytes of JSON. That is why this implementation supports
**1 GB per file** while the whole backend runs on 2 workers.

The R2 secret key never leaves the server. The pre-signed URL is the capability, and it expires.

---

## 2. Sequence

```
Browser                     Your Backend                   Cloudflare R2
   |                             |                              |
   |-- POST /media/presign ----->|                              |
   |   {files:[{filename,        |                              |
   |     content_type, size}],   |  auth check (JWT)            |
   |     prefix}                 |  validate count + size       |
   |                             |  key = root/folder/<ts>-<rnd>|
   |                             |  boto3.generate_presigned_url|
   |<-- [{upload_url, method, ---|                              |
   |     headers, public_url,    |                              |
   |     key, ...}]              |                              |
   |                             |                              |
   |------------- PUT upload_url  (raw file bytes) ------------->|
   |              Content-Type: <exact signed type>              |
   |<------------ 200 OK ----------------------------------------|
   |   (xhr.upload.onprogress drives the % bar)                  |
   |                             |                              |
   |-- POST /tasks {attachments:[{url,key,filename,size,...}]} ->|
   |                             |  persist metadata in Mongo   |
   |                             |                              |
   |   later: <img src={public_url}> loads straight from R2 -----|
```

Two round-trips to your API (sign, then persist). One direct transfer to storage.

---

## 3. Cloudflare R2 setup

### 3.1 Create the bucket

R2 dashboard → **Create bucket**. Note the name and your **Account ID** (top-right of the R2 page).

### 3.2 Create an API token

R2 → **Manage R2 API Tokens** → *Create API token* → permission **Object Read & Write**, scoped to
the bucket. You get an **Access Key ID** and a **Secret Access Key** — shown once, copy both.

### 3.3 Enable public read

Uploaded files are served directly to browsers via `public_url`, so the bucket needs public reads.
Bucket → **Settings** → *Public access* → either:

- **R2.dev subdomain** (dev): gives `https://pub-<hash>.r2.dev` — rate-limited, fine for testing.
- **Custom domain** (production): connect e.g. `files.yourdomain.com`. Faster, cacheable, no limits.

That hostname is `R2_PUBLIC_URL`.

> **mediaERP no longer does this.** As of 2026-09-08 its bucket is private and every read is a
> short-lived signed GET minted at read time — see `R2_SIGNED_ACCESS_MEDIAERP.md` and
> `backend/app/utils/storage.py` (`presign_get`, `key_from_url`, `sign_attachments`).
> Enable public access only if the content genuinely is public. The upload half of this guide is
> identical either way, and starting private is far easier than retrofitting it later.

### 3.4 The S3 endpoint

R2 speaks the S3 API at:

```
https://<ACCOUNT_ID>.r2.cloudflarestorage.com
```

Region is always the literal string `auto`, and you **must** use signature version `s3v4`.

### 3.5 CORS — the step everyone forgets

The browser is doing a cross-origin `PUT` to `r2.cloudflarestorage.com`. Without a CORS policy on
the bucket, the pre-flight `OPTIONS` fails and every upload dies with an opaque network error.

`backend/app/utils/storage.py` sets it programmatically:

```python
def ensure_bucket_cors(origins: list[str]) -> dict:
    """Idempotent — safe to call repeatedly. No-op when R2 is not configured."""
    if not settings.r2_enabled:
        return {"ok": False, "reason": "R2 not enabled"}
    client = _get_r2_client()
    cors = {
        "CORSRules": [
            {
                "AllowedOrigins": origins,           # exact scheme+host+port of your frontend
                "AllowedMethods": ["GET", "PUT", "HEAD"],
                "AllowedHeaders": ["*"],             # must permit Content-Type
                "ExposeHeaders": ["ETag"],
                "MaxAgeSeconds": 3600,
            }
        ]
    }
    client.put_bucket_cors(Bucket=settings.r2_bucket, CORSConfiguration=cors)
    return {"ok": True, "origins": origins}
```

Run once per bucket, and again whenever frontend origins change:

```bash
cd backend && python -m scripts.set_r2_cors
```

The script reads `ALLOWED_ORIGINS` and always appends localhost:3000/3001 for dev.

---

## 4. Environment variables

```dotenv
# backend/.env
R2_ACCOUNT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
R2_ACCESS_KEY_ID=xxxxxxxxxxxxxxxxxxxx
R2_SECRET_ACCESS_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
R2_BUCKET_NAME=my-bucket
R2_PUBLIC_URL=https://pub-xxxxxxxx.r2.dev     # or https://files.yourdomain.com

# Namespace everything this app writes: keys become <root>/<folder>/<file>.
# Essential when the bucket is shared with another project (see 8.8).
R2_ROOT_PREFIX=myapp
# TTL for read-time signed GET URLs, when serving from a PRIVATE bucket.
R2_GET_URL_TTL=3600

# Used by the local-disk fallback and by the CORS script
PUBLIC_BASE_URL=http://localhost:8000
ALLOWED_ORIGINS=http://localhost:3000,https://app.yourdomain.com
```

Pydantic settings (`backend/app/config.py`):

```python
r2_account_id:        str = ""
r2_access_key_id:     str = ""
r2_secret_access_key: str = ""
# Accept either R2_BUCKET or R2_BUCKET_NAME from the environment
r2_bucket: str = Field(default="", validation_alias=AliasChoices("r2_bucket", "r2_bucket_name"))
r2_public_url:        str = ""
r2_root_prefix:       str = "myapp"    # namespace; "" writes at the bucket root
r2_get_url_ttl:       int = 3600       # clamp this in a validator: 60 .. 86400

@property
def r2_enabled(self) -> bool:
    """True only when all required R2 credentials are present."""
    return bool(self.r2_account_id and self.r2_access_key_id
                and self.r2_secret_access_key and self.r2_bucket)

@property
def r2_endpoint(self) -> str:
    return f"https://{self.r2_account_id}.r2.cloudflarestorage.com"
```

`r2_enabled` is the single switch that flips the whole system between R2 and the local-disk
fallback. Nothing else in the codebase checks credentials individually.

Dependency: `boto3==1.35.99`.

---

## 5. Backend

### 5.1 The boto3 client

```python
_r2_client = None   # module-level, lazily created and reused

def _get_r2_client():
    global _r2_client
    if _r2_client is None:
        import boto3
        from botocore.config import Config
        _r2_client = boto3.client(
            "s3",
            endpoint_url=settings.r2_endpoint,
            aws_access_key_id=settings.r2_access_key_id,
            aws_secret_access_key=settings.r2_secret_access_key,
            config=Config(signature_version="s3v4", retries={"max_attempts": 3}),
            region_name="auto",
        )
    return _r2_client
```

Import inside the function so `boto3` is only loaded if storage is actually used, and cache the
client — constructing one per request is measurably slow.

### 5.2 Object keys

```python
_FOLDER_SEGMENT_RE = re.compile(r"^[A-Za-z0-9_-]+$")

def _safe_folder(prefix: str | None) -> str:
    """`prefix` comes off the request body, so it is untrusted. Drop anything
    that is not a plain segment rather than trying to repair it."""
    segments = [s for s in (prefix or "").split("/")
                if s and s not in (".", "..") and _FOLDER_SEGMENT_RE.match(s)]
    return "/".join(segments) if segments else "misc"

def _safe_key(filename: str, prefix: str = "attachments") -> str:
    """<root>/<folder>/<epoch-millis>-<16 hex chars><ext>"""
    suffix = Path(filename or "file").suffix.lower()
    stamp  = int(time.time() * 1000)
    random = secrets.token_hex(8)                  # 8 bytes -> 16 hex chars
    root   = (settings.r2_root_prefix or "").strip("/")
    base   = f"{root}/{_safe_folder(prefix)}" if root else _safe_folder(prefix)
    return f"{base}/{stamp}-{random}{suffix}"
```

Four deliberate choices:

- **Random, not the user's filename** — kills collisions, path traversal, and unicode/encoding
  problems in one move. The original name is stored separately as metadata and shown in the UI.
- **Timestamp prefix** — keys sort chronologically, which makes listing and lifecycle rules far
  easier to reason about than bare UUIDs.
- **Extension preserved** — so browsers and CDNs infer the type, and links look sane.
- **`<root>/<folder>/`** — R2 has no real folders, but a key prefix behaves like one. The `root`
  namespaces the whole application, which matters when a bucket is shared between projects: one
  prefix to grant, block, or migrate. `folder` separates content classes (`attachments/`,
  `social/`).

> **Sanitise the folder.** An earlier version of this code did `prefix.strip("/")`, which let a
> client send `prefix: "../../etc"` and mint the key `mediaERP/../../etc/…`. Object stores treat
> keys as opaque strings so that is not a path escape — but it is worse than it looks: the read,
> delete, and key-recovery helpers all *refuse* keys containing `..`, so such an upload becomes
> permanently unreadable **and** undeletable. Caught by the negative-case tests; see §8.7.

### 5.3 Signing — the heart of it

```python
def presign_put(filename: str,
                content_type: str = "application/octet-stream",
                prefix: str = "attachments",
                expires: int = 3600) -> dict:
    original_name = Path(filename or "file").name
    key = _safe_key(original_name, prefix)
    content_type = content_type or "application/octet-stream"

    if settings.r2_enabled:
        client = _get_r2_client()
        upload_url = client.generate_presigned_url(
            "put_object",
            Params={
                "Bucket": settings.r2_bucket,
                "Key": key,
                "ContentType": content_type,
            },
            ExpiresIn=expires,
        )
        base = (settings.r2_public_url or "").rstrip("/")
        public_url = f"{base}/{key}" if base else key
        return {
            "upload_url": upload_url,
            "method": "PUT",
            # The browser MUST send exactly this Content-Type or the signature fails.
            "headers": {"Content-Type": content_type},
            "public_url": public_url,
            "key": key,
            "filename": original_name,
            "content_type": content_type,
            "backend": "r2",
        }

    # ── Local-disk fallback (dev) — PUT lands on the backend's /media/local-blob ─
    base = settings.public_base_url.rstrip("/")
    unique_name = Path(key).name
    return {
        "upload_url": f"{base}/api/v1/media/local-blob/{key}",
        "method": "PUT",
        "headers": {"Content-Type": content_type},
        "public_url": f"{base}/uploads/{unique_name}",
        "key": key,
        "filename": original_name,
        "content_type": content_type,
        "backend": "local",
    }
```

**Why the response returns `method` and `headers` instead of hardcoding them client-side:** the
frontend becomes a dumb executor. It replays whatever the server tells it to. That is what lets the
same browser code work unchanged against R2 or against the local-disk dev fallback — and what would
let you swap in S3, GCS, or Backblaze later without touching the frontend at all.

**`ContentType` in `Params` is load-bearing.** It becomes part of the signature. If the browser
sends a different `Content-Type` header than the one signed, R2 rejects the PUT with
`403 SignatureDoesNotMatch`. This is the #1 cause of "it works in Postman but not the browser".

### 5.4 The endpoint

```python
class PresignFile(BaseModel):
    filename: str
    content_type: str = "application/octet-stream"
    size: int = 0

class PresignRequest(BaseModel):
    files: list[PresignFile]
    prefix: str = "attachments"

MAX_DIRECT_BYTES = 1024 * 1024 * 1024   # 1 GB per file

@router.post("/presign")
async def presign_uploads(
    body: PresignRequest,
    current_user: dict = Depends(get_current_user),   # ← auth gate lives HERE
):
    if not body.files:
        return error_response("No files provided", status_code=400)
    if len(body.files) > 20:
        return error_response("Maximum 20 files per request", status_code=400)

    results = []
    for f in body.files:
        if f.size and f.size > MAX_DIRECT_BYTES:
            mb = f.size // (1024 * 1024)
            return error_response(
                f"'{f.filename}' is too large ({mb} MB). Maximum is 1 GB per file.",
                status_code=413,
            )
        meta = await run_in_threadpool(
            presign_put,
            f.filename or "file",
            f.content_type or "application/octet-stream",
            body.prefix or "attachments",
        )
        results.append(meta)

    return success_response(data=results, message="Pre-signed upload URLs issued")
```

Two things worth copying:

- **`run_in_threadpool`.** boto3 is synchronous. Calling it directly inside an `async def` blocks
  the event loop for every concurrent request. In FastAPI, always push blocking SDK calls to the
  threadpool. (Signing is local crypto — fast — but `put_object` in §5.6 genuinely does network I/O.)
- **Authorisation is on `/presign`, not on the upload.** Once a URL is signed, whoever holds it can
  upload for the next hour. That is the security model: gate the *issuing*, keep expiry short, and
  never expose signing to unauthenticated callers.

### 5.5 The local-disk fallback

So a new developer can `git clone && run` without Cloudflare credentials. When `r2_enabled` is
false, `presign_put` points `upload_url` at a backend endpoint that accepts the same raw `PUT`:

```python
@router.put("/local-blob/{key:path}")
async def local_blob_put(key: str, request: Request):
    """
    Local-disk fallback target for pre-signed uploads when R2 is not configured
    (development only). Stores the raw request body under uploads/. No auth —
    the pre-signed key is the capability. Never used when R2 is enabled.
    """
    if settings.r2_enabled:
        return error_response("Not available when R2 is enabled", status_code=404)
    body = await request.body()
    if len(body) > MAX_DIRECT_BYTES:
        return error_response("File too large (max 1 GB)", status_code=413)
    name = Path(key).name          # strips any directory traversal
    dest = UPLOAD_DIR / name
    await run_in_threadpool(_write_file, dest, body)
    return success_response(data={"key": key}, message="Stored")
```

Files are then served by a static mount in `main.py`:

```python
_UPLOADS_DIR = Path(__file__).parent.parent / "uploads"
_UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=str(_UPLOADS_DIR)), name="uploads")
```

> ⚠️ **If you port this, read §8.2 first.** This endpoint is unauthenticated by design and it is
> genuinely risky if it ever runs on a publicly reachable host.

### 5.6 Server-side upload (the proxied path, kept for small files)

`upload_bytes()` is the non-pre-signed path — bytes *do* go through the backend. mediaERP still uses
it for `POST /media/upload-attachments` (max 10 files, 25 MB each). It exists because some callers
already hold the bytes server-side (webhook payloads, generated PDFs, report exports).

```python
def upload_bytes(contents: bytes, filename: str,
                 content_type: str = "application/octet-stream",
                 prefix: str = "attachments") -> dict:
    original_name = Path(filename or "file").name
    size = len(contents)

    if settings.r2_enabled:
        key = _safe_key(original_name, prefix)
        try:
            client = _get_r2_client()
            client.put_object(
                Bucket=settings.r2_bucket,
                Key=key,
                Body=contents,
                ContentType=content_type,
                # Make object open in-browser rather than force-download
                ContentDisposition=f'inline; filename="{original_name}"',
            )
            base = (settings.r2_public_url or "").rstrip("/")
            return {"url": f"{base}/{key}" if base else key, "key": key,
                    "filename": original_name, "size": size,
                    "content_type": content_type, "backend": "r2"}
        except Exception as exc:
            logger.error("R2 upload failed, falling back to local disk: %s", exc)

    # ── Local disk fallback ────────────────────────────────────────────────────
    suffix = Path(original_name).suffix.lower()
    unique_name = f"{uuid.uuid4().hex}{suffix}"
    dest = _UPLOAD_DIR / unique_name
    dest.write_bytes(contents)
    base = settings.public_base_url.rstrip("/")
    return {"url": f"{base}/uploads/{unique_name}", "key": unique_name,
            "filename": original_name, "size": size,
            "content_type": content_type, "backend": "local"}
```

Note `ContentDisposition="inline"` — without it, browsers download PDFs and images instead of
displaying them. Set it at upload time; you cannot add it later without rewriting the object.

**For new integrations, prefer `/presign`.** Use `upload_bytes` only for server-originated files.

---

## 6. Frontend

### 6.1 The shared metadata contract

```ts
// types/project.ts — mirror of what the backend returns and later accepts back
export interface Attachment {
  url: string;           // public_url — what you render / link to
  key: string;           // object key — what you would delete by
  filename: string;      // ORIGINAL name, for display
  size: number;
  content_type: string;
  backend: string;       // "r2" | "local"
}
```

Keep `key` even though you render `url`. Without it you cannot delete or move the object later, and
you cannot re-sign a GET if you switch to a private bucket.

### 6.2 `lib/directUpload.ts` — the transport

```ts
"use client";
import api from "@/lib/axios";
import type { Attachment } from "@/types/project";

export const MAX_UPLOAD_BYTES = 1024 * 1024 * 1024; // 1 GB

export interface PresignResult {
  upload_url: string; method: string; headers: Record<string, string>;
  public_url: string; key: string; filename: string;
  content_type: string; backend: string;
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
```

`f.type` is what the browser sniffed. It is echoed back by the server as the signed `Content-Type`,
and replayed verbatim on the PUT — so the three always agree. Empty `f.type` (common for unusual
extensions) falls back to `application/octet-stream` on both sides.

**The PUT — and why it uses `XMLHttpRequest`, not `fetch`:**

```ts
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
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`Upload failed (HTTP ${xhr.status})`));
    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.onabort = () => reject(new DOMException("Aborted", "AbortError"));
    if (signal) {
      if (signal.aborted) return xhr.abort();
      signal.addEventListener("abort", () => xhr.abort());
    }
    xhr.send(file);
  });
}
```

`fetch()` has **no upload progress events**. For a 1 GB file that means a spinner with no feedback
for several minutes. `xhr.upload.onprogress` is still the only cross-browser way to get it, so XHR
stays. (Streaming request bodies via `fetch` are Chromium-only and require HTTP/2.)

Also note: it sends the raw `File` object — no `FormData`, no multipart wrapper. A pre-signed PUT
expects the naked bytes as the request body. Wrapping in `FormData` corrupts the object and breaks
the signature.

**Critically, this request does not carry your `Authorization` header.** It uses a bare `XHR` rather
than the configured axios instance, because sending an `Authorization` header to R2 would conflict
with the signature already embedded in the URL query string.

**The orchestrator:**

```ts
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

  const presigned = await presign(files, opts.prefix);   // ONE call for all files
  const out: Attachment[] = [];
  for (let i = 0; i < files.length; i++) {               // then upload sequentially
    const file = files[i];
    const p = presigned[i];
    await putWithProgress(p, file, (pct) => opts.onProgress?.(i, pct), opts.signal);
    out.push({
      url: p.public_url, key: p.key, filename: p.filename,
      size: file.size, content_type: p.content_type, backend: p.backend,
    });
  }
  return out;
}
```

One presign call covers the whole batch (that is why the endpoint takes an array), then files upload
**one at a time**. Sequential is deliberate: parallel uploads of large files saturate the uplink and
make every individual progress bar crawl, which reads as "frozen" to users. For many small files you
could parallelise with a concurrency cap of 3–4 — but keep the results in input order, since callers
rely on index alignment between `files[i]` and `presigned[i]`.

### 6.3 `hooks/useUpload.ts` — React Query wrapper

```ts
export function useUploadAttachments() {
  return useMutation({
    mutationFn: (files: File[]): Promise<Attachment[]> => uploadFilesDirect(files),
    onError(err: unknown) {
      const msg =
        (err as { message?: string })?.message ||
        (err as { response?: { data?: { detail?: string; message?: string } } })?.response?.data?.detail ||
        (err as { response?: { data?: { detail?: string; message?: string } } })?.response?.data?.message ||
        "Failed to upload files";
      toast.error(msg);
    },
  });
}
```

Thin on purpose. The error unwrapping handles both shapes: plain `Error` from the XHR leg, and an
axios error envelope from the presign leg.

### 6.4 `FileUploader` — the reusable UI

A controlled component: `value: Attachment[]` + `onChange`. Drag-drop, click-to-browse, per-file
progress bars, image thumbnails, type icons, remove buttons.

```tsx
<FileUploader value={attachments} onChange={setAttachments} label="Upload files" />

// read-only view, e.g. on a completed task
<FileUploader value={task.attachments} readOnly />

// dense variant for a chat composer, images only, custom bucket folder
<FileUploader value={files} onChange={setFiles}
              compact accept="image/*" prefix="social" maxFiles={4} />
```

The upload handler, condensed:

```tsx
const handleFiles = useCallback(async (fileList: FileList | null) => {
  if (!fileList || fileList.length === 0 || !onChange) return;
  let files = Array.from(fileList);

  // 1. Enforce the total-count cap against already-attached + in-flight files
  const room = maxFiles - value.length - uploading.length;
  if (room <= 0) { toast.error(`You can attach at most ${maxFiles} files.`); return; }
  if (files.length > room) { toast.error(`Only ${room} more can be added.`); files = files.slice(0, room); }

  // 2. Enforce the per-file size cap up front — before any network call
  const tooBig = files.find((f) => f.size > MAX_UPLOAD_BYTES);
  if (tooBig) { toast.error(`"${tooBig.name}" is ${formatBytes(tooBig.size)} — max is 1 GB.`); return; }

  // 3. Optimistic placeholder rows that own the progress bars
  const entries = files.map((f, i) => ({
    id: `${Date.now()}-${i}-${f.name}`, name: f.name, size: f.size, pct: 0,
  }));
  setUploading((prev) => [...prev, ...entries]);

  try {
    const uploaded = await uploadFilesDirect(files, {
      prefix,
      onProgress: (index, pct) =>
        setUploading((prev) =>
          prev.map((u) => (u.id === entries[index].id ? { ...u, pct } : u))),
    });
    onChange([...value, ...uploaded]);          // 4. hand results to the parent form
    toast.success(`${uploaded.length} file(s) uploaded`);
  } catch (err) {
    toast.error((err as Error)?.message || "Upload failed");
  } finally {
    // 5. always clear placeholders, success or failure
    setUploading((prev) => prev.filter((u) => !entries.some((e) => e.id === u.id)));
  }
}, [maxFiles, onChange, prefix, uploading.length, value]);
```

Details worth keeping when you port it:

- The placeholder `id` is `timestamp-index-name`, not the index alone — selecting the same file
  twice in separate batches would otherwise collide and cross-wire the progress bars.
- `onProgress` maps back by `entries[index].id`, which is why `uploadFilesDirect` must preserve
  input order.
- Cleanup is in `finally`, so a failed upload never leaves a stuck 0% row.
- After a native file input fires, `e.target.value = ""` is reset — otherwise re-selecting the same
  file produces no `change` event.

### 6.5 Persisting the result

`FileUploader` only manages local state. Nothing is durable until the parent form submits the
`Attachment[]` array to your own API:

```ts
createTask.mutate({ title, description, attachments });   // attachments: Attachment[]
```

Backend stores it as-is on the owning document:

```python
# app/schemas/project.py
class CreateTaskRequest(BaseModel):
    ...
    attachments: Optional[list[Attachment]] = None

# app/services/project_service.py
"attachments": data.get("attachments") or [],
```

This is the step people miss: **a successful upload alone changes nothing in your database.** The
object is in the bucket; if the user closes the tab before submitting the form, it is orphaned
(see §8.3).

---

## 7. Endpoint reference

| Endpoint | Auth | Path of bytes | Limits | Use |
|---|---|---|---|---|
| `POST /api/v1/media/presign` | JWT | **Browser → R2 direct** | 20 files/req, 1 GB/file | ✅ Default for all browser uploads |
| `POST /api/v1/media/upload-attachments` | JWT | Browser → backend → R2 | 10 files/req, 25 MB/file | Legacy/simple multipart path |
| `POST /api/v1/media/upload` | JWT | Browser → backend → **local disk only** | 1 file, 50 MB, `image/*` `video/*` | Social publishing; needs a public URL Instagram can fetch. Note: does **not** use R2. |
| `PUT /api/v1/media/local-blob/{key}` | **None** | Browser → backend → local disk | 1 GB | Dev fallback only; 404s when R2 is enabled |

---

## 8. Gotchas

### 8.1 `Content-Type` must match the signature exactly

The single most common failure. `ContentType` is in the signed `Params`, so the browser's header
must be byte-identical. Symptom: `403 SignatureDoesNotMatch`, often surfacing as a bare CORS error
because the error response itself lacks CORS headers. Never let the client "improve" the MIME type
between signing and uploading — always replay `presigned.headers` verbatim.

### 8.2 `/local-blob` is unauthenticated

By design ("the pre-signed key is the capability"), but the key is a plain UUID with no signature or
expiry — it is not actually a capability token. Combined with the public `/uploads` static mount,
anyone who can reach the backend can write up to 1 GB to your disk and serve it from your API's
origin, with no file-type restriction. It is guarded only by `if settings.r2_enabled`.

**If you port this:** either configure R2 in every environment that is publicly reachable, or add a
real signed token (HMAC of key + expiry) to the fallback URL, or drop the endpoint entirely and
require R2. Do not deploy it as-is behind a tunnel or public host.

### 8.3 Nothing is ever deleted

There is **no delete path anywhere in this codebase** — no `delete_object` call, no endpoint.
`FileUploader`'s remove button only splices the array in React state. Every abandoned upload, every
removed attachment, and every deleted task leaves its bytes in the bucket forever.

At R2's ~$0.015/GB/month this is cheap to ignore for a long time, which is exactly why it goes
unnoticed. If you want it handled in the new project, pick one:

- **Lifecycle rule** on the bucket: auto-expire objects under a `tmp/` prefix after N days, and
  upload there first, then copy to the permanent prefix on form submit.
- **Reference-count sweep**: a periodic job listing bucket keys and deleting any not referenced by
  a document.
- **Explicit delete endpoint** taking `key`, called when an attachment is removed *from a saved*
  record — with an ownership check, since `key` would otherwise be an IDOR handle to any object.

### 8.4 Size limits live in three places

`MAX_UPLOAD_BYTES` (client), `MAX_DIRECT_BYTES` (server), and any proxy body limit. The client check
is UX; the server check is enforcement — but note that with direct upload **the server check is
advisory only**, since it validates the `size` the client *claims* at presign time. R2 will happily
accept a larger body against a valid signature. To enforce hard, add a `ContentLengthRange`
condition using pre-signed **POST policies** (`generate_presigned_post`) instead of pre-signed PUT.

### 8.5 CORS `AllowedOrigins` is exact-match

No wildcards for subdomains. Vercel preview deployments each get a unique hostname — they will fail
CORS unless you add them or use a wildcard entry. Re-run the CORS script after any origin change.

### 8.6 `ExposeHeaders: ["ETag"]`

Not needed for this simple flow, but required the moment you add multipart uploads (>5 GB, or
resumable) — the client must read each part's ETag to complete the upload. Cheap to leave in.

### 8.7 A caller-supplied folder is untrusted input

If your presign endpoint takes a `prefix`/`folder` from the request body, sanitise it to plain
segments. `strip("/")` is not enough — `../../etc` survives it. The damage is not a path escape
(keys are opaque strings) but a **write-only object**: every helper that reads, deletes, or
recovers a key refuses `..`, so the upload succeeds and then can never be read or cleaned up.
Whitelist `[A-Za-z0-9_-]` per segment and fall back to a default folder.

### 8.8 Namespace the bucket if anything else shares it

One prefix per application (`myapp/attachments/…`). It costs nothing up front and it is the
difference between "block one prefix" and "audit every key" when you need to fence the app off
from a co-tenant. Retrofitting it means copying every object and rewriting every stored key.

### 8.9 Public bucket = public forever — and retrofitting is painful

mediaERP learned this the hard way: the bucket went private (a change made by *another project* sharing
it) and every stored URL died at once, because the access decision had been baked into data at write
time. Signing at read time is the fix — see `R2_SIGNED_ACCESS_MEDIAERP.md`. Prefer it from day one.


Anyone with the URL can read the object, indefinitely, with no auth. Filenames are UUIDs so they are
unguessable, but treat this as "unlisted", not "private". For anything genuinely sensitive, keep the
bucket private and serve pre-signed GET URLs.

---

## 9. Porting checklist

**Cloudflare**

- [ ] Bucket created; Account ID noted
- [ ] R2 API token with Object Read & Write; access key + secret saved
- [ ] Public access enabled (r2.dev subdomain or custom domain) → `R2_PUBLIC_URL`
- [ ] CORS policy applied for every frontend origin (dev, staging, prod, previews)

**Backend**

- [ ] Install the S3 SDK (`boto3`, or your language's equivalent)
- [ ] Config: 5 R2 vars + an `r2_enabled` all-or-nothing predicate + `r2_endpoint` property
- [ ] Cached client: `endpoint_url`, `region="auto"`, `signature_version="s3v4"`
- [ ] `_safe_key()` — `prefix/<uuid><ext>`, never the user's filename
- [ ] `presign_put()` returning the full `{upload_url, method, headers, public_url, key, …}` envelope
- [ ] `POST /media/presign` — **authenticated**, batch, count + size validation, blocking SDK call
      off the event loop
- [ ] Decide on the dev fallback: R2 everywhere, a properly signed local endpoint, or none (§8.2)
- [ ] Accept and persist `Attachment[]` on whatever domain object owns the files

**Frontend**

- [ ] `Attachment` type shared across the app — keep `key`, not just `url`
- [ ] `presign()` → `putWithProgress()` (XHR, raw `File` body, replayed headers, no auth header)
- [ ] `uploadFilesDirect()` — one presign call, ordered results, client-side size guard
- [ ] Reusable controlled `FileUploader` with progress, previews, and `finally` cleanup
- [ ] Parent form submits the returned metadata — uploading alone persists nothing

**Verify**

- [ ] Upload a small image → appears in the bucket under the right prefix; `public_url` renders
- [ ] Upload a ~500 MB file → progress bar moves smoothly, backend logs show no request body
- [ ] Upload a file with no extension and an empty MIME type → no signature error
- [ ] Call `/media/presign` without a token → 401
- [ ] Upload from a browser origin not in the CORS policy → confirm it fails (proves CORS is live)
- [ ] Check your backend's memory during a large upload — it should be flat

---

## 10. Minimal port (no framework specifics)

If you want the smallest possible version to build on:

```python
# server
import os, uuid, boto3
from botocore.config import Config

s3 = boto3.client("s3",
    endpoint_url=f"https://{ACCOUNT_ID}.r2.cloudflarestorage.com",
    aws_access_key_id=ACCESS_KEY, aws_secret_access_key=SECRET_KEY,
    config=Config(signature_version="s3v4"), region_name="auto")

def sign(filename, content_type):
    key = f"uploads/{uuid.uuid4().hex}{os.path.splitext(filename)[1].lower()}"
    url = s3.generate_presigned_url("put_object",
        Params={"Bucket": BUCKET, "Key": key, "ContentType": content_type},
        ExpiresIn=3600)
    return {"upload_url": url, "public_url": f"{PUBLIC_URL}/{key}", "key": key,
            "headers": {"Content-Type": content_type}}
```

```js
// browser
const meta = await (await fetch("/api/presign", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ filename: file.name, content_type: file.type }),
})).json();

await fetch(meta.upload_url, {
  method: "PUT",
  headers: meta.headers,   // must match what was signed
  body: file,              // raw File — never FormData
});

console.log("live at", meta.public_url);
```

Everything else in this document — progress bars, batching, the local fallback, size caps, the
component — is refinement on top of those ~20 lines.
