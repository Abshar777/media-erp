"""
Object storage helper.

Uploads files to Cloudflare R2 (S3-compatible) when R2 credentials are
configured; otherwise falls back to local disk storage under uploads/.

READ MODEL — the bucket is PRIVATE
----------------------------------
Public access is off, so a URL built from ``settings.r2_public_url`` returns 401
for every key. Reads therefore happen through short-lived **signed GET** URLs
minted at read time, after the caller's own authorisation check:

    presign_get(key)              -> signed GET URL for one key
    resolve_media_url(url_or_key) -> signed URL, or the input unchanged
    sign_attachments(list)        -> Attachment list with `url` re-signed

``key`` is the source of truth; ``url`` in a stored Attachment is derived and
disposable. ``key_from_url()`` recovers a key from rows written while the bucket
was public, so no backfill is needed.

Public functions
----------------
    presign_put(filename, content_type, prefix)  — browser → R2 direct upload
    presign_get(key, expires)                    — read-time signed GET
    key_from_url(url)                            — URL (or key) → storage key
    resolve_media_url(url, expires)              — sign if ours, else pass through
    sign_attachment(att) / sign_attachments(list) — Attachment read path
    canonicalize_attachments(list)               — Attachment write path
    upload_bytes(contents, filename, ...)        — server-side upload
    ensure_bucket_cors(origins)                  — one-off CORS bootstrap

The local fallback writes to <repo_root>/uploads/ and builds a URL from
settings.public_base_url (served by main.py's StaticFiles mount). Local files
cannot be signed — there is nothing to sign against — so every helper below
passes those URLs through untouched.
"""

import logging
import re
import secrets
import time
import uuid
from pathlib import Path
from urllib.parse import unquote, urlparse

from app.config import settings

logger = logging.getLogger(__name__)

# Hosts that mean "this object lives in our R2".
#   <account>.r2.cloudflarestorage.com/<bucket>/<key>   ← S3 API + signed URLs
#   pub-<hash>.r2.dev/<key>                             ← legacy public host
_R2_API_HOST_RE = re.compile(r"\.r2\.cloudflarestorage\.com$", re.I)
_R2_DEV_HOST_RE = re.compile(r"^pub-[0-9a-z]+\.r2\.dev$", re.I)

# Local fallback directory — repo_root/uploads/
_UPLOAD_DIR = Path(__file__).parent.parent.parent / "uploads"
_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

# Lazily-created boto3 client (reused across calls)
_r2_client = None


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


_FOLDER_SEGMENT_RE = re.compile(r"^[A-Za-z0-9_-]+$")


def _safe_folder(prefix: str | None) -> str:
    """
    Reduce a caller-supplied folder to safe path segments.

    `prefix` comes straight off the request body (`POST /media/presign`), so it
    is untrusted. Object stores treat keys as opaque strings — `..` is not
    resolved — but a key containing `..` is still a trap: `presign_get`,
    `key_from_url` and `delete_object` all refuse those keys, so such an upload
    would be permanently unreadable AND undeletable. Drop anything that is not
    a plain segment rather than trying to repair it.
    """
    segments = [
        s for s in (prefix or "").split("/")
        if s and s not in (".", "..") and _FOLDER_SEGMENT_RE.match(s)
    ]
    return "/".join(segments) if segments else "misc"


def _safe_key(filename: str, prefix: str = "attachments") -> str:
    """
    Build a collision-proof object key, preserving the file extension.

    Shape (matches the Delta LMS's `makeKey` so both projects in this bucket
    name objects the same way):

        <root>/<folder>/<epoch-millis>-<16 hex chars><ext>
        mediaERP/attachments/1757339000123-a1b2c3d4e5f6a7b8.jpg

    The leading `<root>` (settings.r2_root_prefix) namespaces everything this
    project writes, because the bucket is shared with the LMS. The timestamp
    makes keys sort chronologically; the random half makes them unguessable.
    """
    suffix = Path(filename or "file").suffix.lower()
    stamp = int(time.time() * 1000)
    random = secrets.token_hex(8)          # 8 bytes -> 16 hex chars, as in LMS
    root = (settings.r2_root_prefix or "").strip("/")
    base = f"{root}/{_safe_folder(prefix)}" if root else _safe_folder(prefix)
    return f"{base}/{stamp}-{random}{suffix}"


# ── Reading private objects ───────────────────────────────────────────────────

def key_from_url(url: str | None) -> str | None:
    """
    Recover a storage key from a URL already stored in the database, so
    read-time code can sign an object that was written while the bucket was
    public.

    Accepts, in order:
      • a bare key                     "attachments/abc.jpg"
      • the legacy public host         "https://pub-<hash>.r2.dev/attachments/abc.jpg"
      • the configured public base     "https://files.example.com/attachments/abc.jpg"
      • the S3 API / signed-URL form   ".../<bucket>/attachments/abc.jpg?X-Amz-…"

    Returns None — meaning "not ours, pass the URL through untouched" — for
    external hosts and for the local-disk ``/uploads/`` fallback, which is
    served by StaticFiles and has nothing to sign against.

    Returns None for anything containing "..": the result addresses storage, so
    traversal is refused rather than sanitised.
    """
    if not url or not isinstance(url, str):
        return None
    raw = url.strip()
    if not raw:
        return None

    # Bare key — no scheme, no leading slash.
    if "://" not in raw and not raw.startswith("/"):
        key = unquote(raw).lstrip("/")
        return None if (not key or ".." in key) else key

    parsed = urlparse(raw)
    host = (parsed.netloc or "").lower()
    path = unquote(parsed.path or "").lstrip("/")
    if not path:
        return None

    # Local-disk fallback — not an R2 object.
    if path.startswith("uploads/"):
        return None

    public_base = (settings.r2_public_url or "").rstrip("/")

    if _R2_API_HOST_RE.search(host):
        # S3 endpoint form is /<bucket>/<key>; drop the bucket segment.
        bucket, _, key = path.partition("/")
        if not key:
            return None
    elif _R2_DEV_HOST_RE.match(host) or (
        public_base and raw.startswith(public_base + "/")
    ):
        key = path
    else:
        return None  # external host — not ours

    return None if (not key or ".." in key) else key


def presign_get(key: str | None, expires: int | None = None) -> str | None:
    """
    Mint a short-lived signed GET URL for a private-bucket object.

    Returns None when R2 is not configured or the key is unusable, so callers
    can fall back to whatever URL they already hold instead of emitting nothing.

    A signed URL is a bearer token for that object until it expires — only ever
    call this *after* the authorisation check that decides the caller may read
    it, never before.
    """
    if not settings.r2_enabled or not key or ".." in key:
        return None
    ttl = expires if expires else settings.r2_get_url_ttl
    try:
        return _get_r2_client().generate_presigned_url(
            "get_object",
            Params={"Bucket": settings.r2_bucket, "Key": key},
            ExpiresIn=ttl,
        )
    except Exception as exc:  # noqa: BLE001 — never break a read over signing
        logger.error("Failed to sign GET for key %s: %s", key, exc)
        return None


def resolve_media_url(url: str | None, expires: int | None = None) -> str | None:
    """
    Turn a stored media URL (or bare key) into something actually fetchable.

    Signs it when it resolves to one of our R2 keys; returns the input unchanged
    for external hosts and the local-disk fallback. Safe to call on any stored
    URL, including ones already signed — the key is re-extracted and re-signed.
    """
    if not url:
        return url
    key = key_from_url(url)
    if not key:
        return url
    return presign_get(key, expires) or url


def sign_attachment(att: dict, expires: int | None = None) -> dict:
    """Return a copy of one Attachment with `url` re-signed from its `key`."""
    if not isinstance(att, dict):
        return att
    key = att.get("key") or key_from_url(att.get("url"))
    if not key:
        return att
    signed = presign_get(key, expires)
    return {**att, "url": signed} if signed else att


def sign_attachments(atts, expires: int | None = None) -> list:
    """
    Re-sign every Attachment in a list — the read path for task and chat
    attachments. Call it in the serializer, after the route's own access check.
    """
    if not atts or not isinstance(atts, list):
        return atts if isinstance(atts, list) else []
    return [sign_attachment(a, expires) for a in atts]


def canonicalize_attachments(atts) -> list:
    """
    Normalise Attachments on the WRITE path, before they are persisted.

    Clients round-trip the objects they were given, so `url` arrives holding a
    read-time signed URL. Storing that would put an expiring bearer token in the
    database, so when we can resolve a key we keep the key and reduce `url` to
    it. Rows we cannot key — external hosts, local-disk files — keep their URL.
    """
    out: list[dict] = []
    for a in atts or []:
        if not isinstance(a, dict):
            continue
        key = a.get("key") or key_from_url(a.get("url")) or ""
        item = {**a, "key": key}
        if key:
            # `url` is derived, not authoritative — the read path signs from `key`.
            item["url"] = key
        out.append(item)
    return out


def presign_put(
    filename: str,
    content_type: str = "application/octet-stream",
    prefix: str = "attachments",
    expires: int = 3600,
) -> dict:
    """
    Generate a short-lived pre-signed URL the browser can PUT a file to
    **directly** (bytes never pass through this backend).

    Returns:
        {upload_url, method, headers, public_url, key, filename,
         content_type, backend}

    When R2 is not configured, falls back to a backend PUT endpoint that
    stores to local disk (dev only) — same interface, so the frontend flow
    is identical regardless of backend.
    """
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
        # The bucket is private, so there is no public URL to hand back. Return a
        # signed GET instead — it lets the composer preview the file it just
        # uploaded. It expires; every later read re-signs from `key`.
        view_url = presign_get(key) or key
        return {
            "upload_url": upload_url,
            "method": "PUT",
            # The browser MUST send exactly this Content-Type or the signature fails.
            "headers": {"Content-Type": content_type},
            # Field name kept as `public_url` for frontend compatibility; the
            # value is a short-lived signed GET, not a public URL.
            "public_url": view_url,
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


def object_exists(key: str) -> bool:
    """
    True when the object is really there. Mirrors the LMS's `objectExists` — it
    tells a reference whose object is genuinely MISSING from one that is merely
    un-migrated. Those read identically in the database and mean very different
    things.
    """
    if not settings.r2_enabled or not key or ".." in key:
        return False
    try:
        _get_r2_client().head_object(Bucket=settings.r2_bucket, Key=key)
        return True
    except Exception:
        return False


def delete_object(key: str) -> bool:
    """
    Permanently remove one object. Mirrors the LMS's `deleteFromR2`.

    Nothing in the request path calls this — attachment removal only detaches
    the reference — so it exists for migrations, cleanup jobs and tests. Returns
    False rather than raising when R2 is unconfigured or the key is unusable.
    """
    if not settings.r2_enabled or not key or ".." in key:
        return False
    try:
        _get_r2_client().delete_object(Bucket=settings.r2_bucket, Key=key)
        return True
    except Exception as exc:  # noqa: BLE001
        logger.error("Failed to delete key %s: %s", key, exc)
        return False


def copy_object(source_key: str, dest_key: str) -> bool:
    """
    Server-side copy within the bucket — the bytes never transit this process.
    Used by the prefix migration (scripts/migrate_r2_prefix.py) to relocate
    objects into the mediaERP/ namespace without re-uploading ~25 GB.
    """
    if not settings.r2_enabled:
        return False
    if not source_key or not dest_key or ".." in source_key or ".." in dest_key:
        return False
    try:
        _get_r2_client().copy_object(
            Bucket=settings.r2_bucket,
            CopySource={"Bucket": settings.r2_bucket, "Key": source_key},
            Key=dest_key,
        )
        return True
    except Exception as exc:  # noqa: BLE001
        logger.error("Failed to copy %s -> %s: %s", source_key, dest_key, exc)
        return False


def ensure_bucket_cors(origins: list[str]) -> dict:
    """
    Configure the R2 bucket's CORS policy so browsers on the given origins may
    PUT (upload) directly via pre-signed URLs and GET/HEAD (view) objects.
    Idempotent — safe to call repeatedly. No-op when R2 is not configured.
    """
    if not settings.r2_enabled:
        return {"ok": False, "reason": "R2 not enabled"}
    client = _get_r2_client()
    cors = {
        "CORSRules": [
            {
                "AllowedOrigins": origins,
                "AllowedMethods": ["GET", "PUT", "HEAD"],
                "AllowedHeaders": ["*"],
                "ExposeHeaders": ["ETag"],
                "MaxAgeSeconds": 3600,
            }
        ]
    }
    client.put_bucket_cors(Bucket=settings.r2_bucket, CORSConfiguration=cors)
    return {"ok": True, "origins": origins}


def upload_bytes(
    contents: bytes,
    filename: str,
    content_type: str = "application/octet-stream",
    prefix: str = "attachments",
) -> dict:
    """
    Upload raw bytes and return file metadata including a public URL.

    Uses R2 when configured, else local disk.
    """
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
                # Make object readable when bucket has public access enabled
                ContentDisposition=f'inline; filename="{original_name}"',
            )
            # Private bucket — hand back a signed GET, not a public URL.
            return {
                "url": presign_get(key) or key,
                "key": key,
                "filename": original_name,
                "size": size,
                "content_type": content_type,
                "backend": "r2",
            }
        except Exception as exc:  # noqa: BLE001 — fall back to disk on any R2 error
            logger.error("R2 upload failed, falling back to local disk: %s", exc)

    # ── Local disk fallback ────────────────────────────────────────────────────
    suffix = Path(original_name).suffix.lower()
    unique_name = f"{uuid.uuid4().hex}{suffix}"
    dest = _UPLOAD_DIR / unique_name
    dest.write_bytes(contents)
    base = settings.public_base_url.rstrip("/")
    return {
        "url": f"{base}/uploads/{unique_name}",
        "key": unique_name,
        "filename": original_name,
        "size": size,
        "content_type": content_type,
        "backend": "local",
    }
