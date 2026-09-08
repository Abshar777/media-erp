# R2 Media Storage — Public to Signed Access (mediaERP)

The media bucket was public. It is now private, and every read is signed at request time
instead of being a bare URL. This is what changed, why it was urgent, and what is left.

**Status:** All read paths converted; all uploads namespaced under `mediaERP/`. Verified across
1075 upload assertions (3 rounds x 7 methods), 37 route-level tests and 31 signed-access tests —
all passing. Two gaps remain — see §6.

Read §1 first: this was not a planned hardening. It was a repair.

---

## 1. Why this happened

mediaERP's R2 bucket is **`lms-delta` — the same bucket the Delta LMS project uses**, reached
through the same `pub-141ff…r2.dev` public host. The LMS turned public access off on that
bucket (see `../lms/docs/R2_SIGNED_ACCESS.md`), which silently invalidated every URL mediaERP
had ever stored.

Every attachment URL in the database had been built at upload time from one environment
variable:

```python
base = (settings.r2_public_url or "").rstrip("/")
public_url = f"{base}/{key}"       # the original read path
```

The access decision was therefore baked into stored data. When the bucket went private, all of
it died at once — task attachments, chat attachments, social previews.

Measured before the change:

| Probe | Result |
|---|---|
| Nonexistent key via `pub-…r2.dev` | `403` (a public bucket answers `404`) |
| **Real** key via `pub-…r2.dev` | `403` |
| Same key via `generate_presigned_url` | `200`, `image/jpeg`, 703,951 bytes |

The objects were never lost. Only the read path was.

So the fix is not a new URL format. It is moving the access decision out of stored data and
into **read time**, where the request has a user attached and the code has already decided what
that user may see.

---

## 2. The read paths

mediaERP has no genuinely-public content class, so — unlike the LMS, which needed three gates —
everything is signed. What differs is *when*.

| Content | Prefix | Signed | Where |
|---|---|---|---|
| Task attachments | `mediaERP/attachments/` | At read time, in the serializer | `project_service._serialize` |
| Chat attachments (DM) | `mediaERP/attachments/` | At read time | `models/chat.message_to_dict` |
| Chat attachments (group) | `mediaERP/attachments/` | At read time | `group_chat_service.group_message_to_dict` |
| Social image/video | `mediaERP/social/` | **At publish time** + on preview read | `routers/social.py`, `services/schedule_service.py`, `routers/schedule.py` |

**Why social is different.** Meta fetches `image_url` / `video_url` from its own servers, with no
credentials of ours — `platforms/facebook_pages.py` rejects anything that is not a reachable
`http(s)` URL. A scheduled post publishes hours after it was composed, so a URL signed at
schedule time would already be dead. The schedule therefore stores the **bare key** and signs
when the post actually fires, with a 1 h TTL — comfortably inside Instagram's ≤90 s
fetch-and-process window.

Every task read path — list, detail, leader queue, cross-team routing — funnels through
`project_service._serialize`, so there is exactly one place to get this right.

---

## 2.5 The mediaERP/ namespace

Everything mediaERP writes now lives under a single root prefix, and keys follow the same shape as
the LMS's `makeKey`:

```
mediaERP/attachments/1788877205631-88fba054b7717b97.jpg
^^^^^^^^ ^^^^^^^^^^^ ^^^^^^^^^^^^^ ^^^^^^^^^^^^^^^^
root     folder      epoch-millis  8 random bytes (16 hex)
```

`R2_ROOT_PREFIX` (default `mediaERP`) supplies the root; `_safe_key()` builds the rest. Set it to
`""` to write at the bucket root as before.

Two reasons this matters more than tidiness:

- **One prefix to fence off.** The LMS's unauthenticated `/assets/*` proxy blocks by prefix. With
  everything under `mediaERP/`, the LMS can exclude all of it by adding a single entry to its
  `BLOCKED_PREFIXES` — instead of trying to enumerate which root-level `attachments/` keys are ours.
- **No collisions with the co-tenant.** The LMS owns `images/ documents/ hls/ videos/ kyc/
  meeting-recordings/`; mediaERP owned root-level `attachments/`. Nothing overlapped by luck, not
  by design.

The folder segment is **untrusted** — it arrives in the `POST /media/presign` body — so
`_safe_folder()` reduces it to `[A-Za-z0-9_-]` segments and falls back to `misc`. This is not
theoretical: `strip("/")` alone let `prefix: "../../etc"` through, producing
`mediaERP/../../etc/…`. Object stores treat keys as opaque strings, so that is not a path escape,
but it is worse in practice — `presign_get`, `key_from_url` and `delete_object` all refuse keys
containing `..`, so the upload would have succeeded and then been permanently unreadable *and*
undeletable. The negative-case tests caught it.

**Legacy keys keep working.** The 424 objects written before this change still sit at root-level
`attachments/`, and nothing needed to move: keys are stored, so reads sign whatever key the row
holds. `scripts/migrate_r2_prefix.py` consolidates them when you want (§6).

---

## 3. The primitives

All in `backend/app/utils/storage.py`.

#### `key_from_url(url) -> str | None`

The linchpin. Recovers a storage key from a URL **already in the database**, so read-time code
can sign an object that was written as public. Accepts a bare key, the legacy `pub-*.r2.dev`
host, the configured public base, and the S3/signed form (`…/<bucket>/<key>?X-Amz-…`). Returns
`None` — meaning "not ours, pass it through" — for external hosts and the local-disk
`/uploads/` fallback, and for anything containing `..`: the result addresses storage, so
traversal is refused rather than sanitised.

**This is why no backfill was needed.** Legacy rows still holding dead public URLs sign
correctly, so the change deployed in one step.

#### `presign_get(key, expires=None) -> str | None`

A short-lived signed GET, defaulting to `R2_GET_URL_TTL`. Returns `None` when R2 is not
configured or the key is unusable, so callers fall back to whatever URL they hold rather than
emitting nothing.

#### `resolve_media_url(url, expires=None)`

Signs a single stored URL (or bare key) if it resolves to one of ours; returns the input
untouched otherwise. Safe on already-signed URLs — the key is re-extracted and re-signed.

#### `sign_attachment(att)` · `sign_attachments(list)`

The Attachment read path. Re-signs `url` from `key`, falling back to `key_from_url(url)` for
keyless legacy rows, and preserves all other metadata.

#### `object_exists(key)` · `delete_object(key)` · `copy_object(src, dest)`

Mirrors the LMS's `objectExists` / `deleteFromR2` / server-side copy. Nothing in the request path
deletes — removing an attachment only detaches the reference — so these exist for migrations,
cleanup jobs and tests. `copy_object` is a server-side copy: bytes never transit the process, which
is what makes relocating ~25 GB practical.

#### `canonicalize_attachments(list)`

The Attachment **write** path. Clients round-trip the objects they were handed, so `url` arrives
holding a signed URL; persisting that would store an expiring bearer token. When a key resolves,
`url` is reduced to it. Rows we cannot key keep their URL.

---

## 4. The rule that matters

**`key` is the source of truth. `url` is derived and disposable.**

Sign *after* the authorisation check, never before — a signed URL is a bearer token for that
object until it expires. Every call site above sits downstream of the route's own access check.

---

## 5. Environment

| Variable | Default | Role |
|---|---|---|
| `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | — | All three required for `r2_enabled`. Absent ⇒ local-disk storage, nothing signed. |
| `R2_BUCKET_NAME` | — | Currently `lms-delta`. Public access **off**. See §6. |
| `R2_GET_URL_TTL` | `3600` | Seconds. Clamped 60 … 86400. |
| `R2_ROOT_PREFIX` | `mediaERP` | Namespace for every key this app writes. `""` = bucket root (legacy). |
| `R2_PUBLIC_URL` | — | **Legacy.** Kept only so `key_from_url` can parse rows written while the bucket was public. Nothing is served from it. |

`NEXT_PUBLIC_R2_PUBLIC_URL` was removed from `frontend/.env` — it was set but never read, and
the frontend needs no R2 value at all now.

---

## 6. What is still unfinished

**New uploads are namespaced; the 424 legacy objects are not yet.** They remain at root-level
`attachments/` and read correctly (covered by the "legacy keys" test group). To consolidate:

```bash
cd backend
python -m scripts.migrate_r2_prefix                     # dry run — reports, writes nothing
python -m scripts.migrate_r2_prefix --apply             # server-side copy + rewrite DB refs
python -m scripts.migrate_r2_prefix --delete-originals  # only after verifying the app
```

424 objects / ~24.9 GB. The script copies (never moves), verifies each copy with `head_object`
before touching a DB row, rewrites `project_tasks.attachments[]`, `messages.attachments[]` and
`scheduled_posts.image_url/video_url`, and is re-runnable. Originals stay until you explicitly
delete them, so rollback is reverting the DB.

**The bucket is still shared with the LMS.** The namespace narrows the blast radius but does not
remove it:

- **The LMS's proxy still serves mediaERP files.** `src/routes/assets.routes.ts` blocks only
  `videos/` and `kyc/`, and streams anything else out of the shared bucket with **no auth** and a
  7-day immutable cache header. Now that everything of ours is under one prefix, the fix on their
  side is one line — add `'mediaERP/'` to `BLOCKED_PREFIXES` (and keep root-level `attachments/`
  blocked until the migration above is done). Signing in mediaERP does not close this.
- **A dedicated bucket** remains the complete fix: create `mediaerp-media` (private), copy the
  `mediaERP/` prefix across, flip `R2_BUCKET_NAME`, re-run `scripts/set_r2_cors`. Keys are
  unchanged, so stored rows keep resolving, and rollback is flipping the variable back.

## 7. Things that bite

- **403/401 on a missing key means the bucket, not the object.** A public bucket answers 404 for
  a key that does not exist. That single probe separates "bucket is private" from "object is gone".

- **Signed URLs are bearer tokens.** Anyone holding one can fetch until it expires. Keep them out
  of logs and referrers, and sign only after the authorisation check.

- **Never persist a signed URL.** Clients hand back what you gave them. Without
  `canonicalize_attachments` on the write path, expiring tokens accumulate in the database as
  permanently dead links. This is the easiest mistake to make here.

- **Sign scheduled media at fire time, not at schedule time.** A URL signed when a post is
  composed is long dead by the time the post publishes.

- **Signed URLs defeat caching.** Each read mints a new URL, so browsers treat it as a new
  resource. Acceptable here; it is the reason the LMS proxies its genuinely-public assets instead.

- **They also expire mid-session.** A tab open past the TTL holds dead URLs.
  `components/shared/SignedImg.tsx` handles this: on load failure it refetches the owning query
  once per src, then falls back to a file-type icon rather than retrying forever.

- **Local disk cannot be signed.** `/uploads/` files have nothing to sign against, so
  `key_from_url` returns `None` and every helper passes them through. Any new signed path needs
  the same fallback or local development breaks.

- **Not every stored URL is ours.** Some point at external hosts (Instagram CDN, picsum). Every
  call site checks `key_from_url` for `None` and passes the original through untouched.
