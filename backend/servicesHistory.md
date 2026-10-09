# Backend Services History

> Every service class and method ever created goes here.
> Read this before adding any new service method — it may already exist.
> Format: **Feature · File · Class · Method · Signature · Purpose**

---

## How to use

1. Before creating a service method, search this file for the class name + method name.
2. If it already exists, reuse it — do NOT create a duplicate.
3. After creating a new method, add it here immediately.

---

## Services

### `register_user(email, password, name, db)` (feature 1.9)
- **File:** `app/services/auth_service.py`
- **Signature:** `async def register_user(email: str, password: str, name: str, db: AsyncIOMotorDatabase) -> dict`
- **Purpose:** Hashes password, inserts new user. Raises `ValueError` if email taken.
- **Collections:** `users`

### `authenticate_user(email, password, db)` (feature 1.9)
- **File:** `app/services/auth_service.py`
- **Signature:** `async def authenticate_user(email: str, password: str, db: AsyncIOMotorDatabase) -> dict`
- **Purpose:** Verifies bcrypt password, checks `is_active`. Raises `ValueError` on any failure (generic — prevents email enumeration).
- **Collections:** `users`

### `hash_password(plain)` / `verify_password(plain, hashed)` (feature 1.9)
- **File:** `app/services/auth_service.py`
- **Purpose:** bcrypt helpers via passlib `CryptContext`

---

## Utility functions (1.7)

### `create_access_token(user_id: str) -> str`
- **File:** `app/utils/jwt.py`
- **Purpose:** Signs a 15-min access JWT with `sub=user_id`, `type=access`

### `create_refresh_token(user_id: str) -> str`
- **File:** `app/utils/jwt.py`
- **Purpose:** Signs a 7-day refresh JWT with `sub=user_id`, `type=refresh`

### `decode_access_token(token: str) -> dict`
- **File:** `app/utils/jwt.py`
- **Purpose:** Validates and decodes an access JWT; raises `JWTError` on failure

### `decode_refresh_token(token: str) -> dict` (feature 1.10)
- **File:** `app/utils/jwt.py`
- **Purpose:** Validates and decodes a refresh JWT; raises `JWTError` if type != "refresh"

### `encrypt(plaintext: str) -> str`
- **File:** `app/utils/encryption.py`
- **Purpose:** AES-256-GCM encrypt → base64(nonce+ciphertext); used for OAuth tokens

### `decrypt(token: str) -> str`
- **File:** `app/utils/encryption.py`
- **Purpose:** Inverse of `encrypt()`

---

### `create_connector(user_id, platform, name, sync_frequency, db)` (feature 2.1)
- **File:** `app/services/connector_service.py`
- **Signature:** `async def create_connector(user_id, platform, name, sync_frequency, db) -> dict`
- **Purpose:** Inserts a new connector document with status=disconnected. Returns the inserted doc with `_id`.
- **Collections:** `connectors`

### `get_connector(connector_id, user_id, db)` (feature 2.1)
- **File:** `app/services/connector_service.py`
- **Purpose:** Fetches connector by ObjectId, scoped to `user_id`. Returns None for invalid ID or ownership mismatch.

### `list_connectors(user_id, db)` (feature 2.1)
- **File:** `app/services/connector_service.py`
- **Purpose:** Returns all connectors for a user sorted by `created_at desc` (max 200).

### `update_connector(connector_id, user_id, updates, db)` (feature 2.1)
- **File:** `app/services/connector_service.py`
- **Purpose:** `find_one_and_update` with `$set`, auto-stamps `updated_at`. Returns updated doc or None.

### `delete_connector(connector_id, user_id, db)` (feature 2.1)
- **File:** `app/services/connector_service.py`
- **Purpose:** Deletes connector scoped to user. Returns True if deleted, False if not found.

### `save_tokens(connector_id, user_id, access_token, refresh_token, expires_at, platform_account_id, db)` (feature 2.1)
- **File:** `app/services/connector_service.py`
- **Purpose:** Encrypts tokens via `utils/encryption.encrypt()`, sets `status=connected`, persists via `update_connector`.

### `get_decrypted_tokens(connector)` (feature 2.1)
- **File:** `app/services/connector_service.py`
- **Signature:** `def get_decrypted_tokens(connector: dict) -> dict` (sync — no DB call)
- **Purpose:** Decrypts `encrypted_access_token` / `encrypted_refresh_token` fields using AES-256-GCM.

---

### `update_profile(user_id, updates, db)` (feature 7.1)
- **File:** `app/services/auth_service.py`
- **Signature:** `async def update_profile(user_id: str, updates: dict, db) -> dict`
- **Purpose:** Updates `name` and/or `email`. Checks email uniqueness against other accounts (409 if taken).
- **Collections:** `users`

### `update_password(user_id, current_password, new_password, db)` (feature 7.1)
- **File:** `app/services/auth_service.py`
- **Signature:** `async def update_password(user_id, current_password, new_password, db) -> None`
- **Purpose:** Verifies current password, rejects reuse of same password, bumps `token_version` to signal invalidation.
- **Collections:** `users`

---

### `sync_connector(connector_id)` (feature 3.3 — Celery task)
- **File:** `app/tasks/sync_tasks.py`
- **Signature:** `@app.task def sync_connector(connector_id: str) -> dict`
- **Purpose:** Full sync cycle: update status→syncing, call platform `fetch_data`, upsert marketing_data, emit notification.
- **Collections:** `connectors`, `marketing_data`, `notifications`

### `upsert_marketing_data(user_id, connector_id, platform, records, db)` (feature 3.3)
- **File:** `app/services/sync_service.py`
- **Purpose:** Bulk-upserts normalized marketing data records using the unique compound index.
- **Collections:** `marketing_data`

---

### `create_notification_sync(user_id, type, title, message, metadata, client)` (feature 7.2)
- **File:** `app/services/notification_service.py`
- **Signature:** `def create_notification_sync(user_id, notification_type, title, message, metadata, client) -> None`
- **Purpose:** Synchronous (PyMongo) notification insert — used from Celery tasks.
- **Collections:** `notifications`

### `list_notifications(user_id, limit, unread_only, db)` (feature 7.2)
- **File:** `app/services/notification_service.py`
- **Signature:** `async def list_notifications(user_id, limit, unread_only, db) -> dict`
- **Purpose:** Returns `{ items: [...], unread_count: N }`.
- **Collections:** `notifications`

### `mark_read(notification_id, user_id, db)` (feature 7.2)
- **File:** `app/services/notification_service.py`
- **Purpose:** Sets `read=True` on one notification. Returns `False` if not found or wrong user.
- **Collections:** `notifications`

### `mark_all_read(user_id, db)` (feature 7.2)
- **File:** `app/services/notification_service.py`
- **Purpose:** Sets `read=True` on all unread notifications for user.
- **Collections:** `notifications`

---

### `generate_pipeline(question, user_id)` (feature 6.1)
- **File:** `app/services/ai_service.py`
- **Signature:** `async def generate_pipeline(question: str, user_id: str) -> list[dict]`
- **Purpose:** Calls Gemini 2.5 Flash with schema + rules to generate a MongoDB aggregation pipeline. Validates and sanitises output; force-injects user_id match stage.
- **Model:** `gemini-2.5-flash`

### `execute_pipeline(pipeline, db)` (feature 6.2)
- **File:** `app/services/ai_service.py`
- **Signature:** `async def execute_pipeline(pipeline: list[dict], db) -> list[dict]`
- **Purpose:** Runs the validated pipeline against `marketing_data`. Returns JSON-safe results (max 100 rows).
- **Collections:** `marketing_data`

### `explain_result(question, result)` (feature 6.2)
- **File:** `app/services/ai_service.py`
- **Signature:** `async def explain_result(question: str, result: list[dict]) -> str`
- **Purpose:** Second Gemini call — explains the result in 2-3 plain-English sentences for a non-technical audience.

### `run_ai_query(question, user_id, db)` (feature 6.2)
- **File:** `app/services/ai_service.py`
- **Signature:** `async def run_ai_query(question, user_id, db) -> dict`
- **Purpose:** Orchestrates generate → execute → explain → persist to `ai_queries`.
- **Collections:** `marketing_data`, `ai_queries`

---

### Template entry

```
### ServiceClass.method_name
- **Feature:** X.Y
- **File:** `app/services/service_file.py`
- **Signature:** `async def method_name(self, param: Type, db: AsyncIOMotorDatabase) -> ReturnType`
- **Purpose:** One-line description of what this method does
- **Collections touched:** collection_name
```

---

## projects router — leader queue + reedit return-to-origin (2026-07-15)
- `GET /projects/leader/queue` now returns a **`reedit`** list (status=reedit tasks in the leader's teams). Previously missing entirely → the frontend Reedit tab was always empty. Added to both the empty-state and normal responses.
- **Approve & route** now stamps the routed copy with `routed_by_id`, `routed_by_name`, `origin_team_id` (the routing leader's team).
- **`PUT /projects/{id}` → status=reedit:** if the task carries `origin_team_id` (i.e. it was routed here), it is returned home — `team_id` set back to `origin_team_id`, `assigned_to` cleared, `former_team_name` set to the returning team. Only a leader/admin of the current team may return it (`workflow.can_approve`). The reedit notification then fires to the origin team's leaders.
- Guarded the re-assignment notification so it only fires when a *new* assignee is set (skips the misleading "assigned" DM when clearing the assignee).

## project history recording restored + cross-team aggregation (2026-07-15)
- **Regression fixed:** the per-transition history append from commit d895a43 was lost in merge 782271a, so status changes recorded NO history. Restored in `edit_task` — every status change and assignment now pushes a history entry, each tagged with `team_id` + `team_name` (the team the action happened in; uses the pre-update team so a reedit-return is attributed to the team that raised it).
- **Chain linkage:** Approve & Route now (a) pushes a `routed` entry to the source task, (b) stamps the copy with `root_task_id` + `parent_task_id`, and (c) seeds the copy with a `received` history entry ("Received from <team>").
- **Aggregation:** new `project_service.get_chain_history(db, doc)` gathers the root + all copies sharing `root_task_id`, merges their histories chronologically (tagging each with its team), and derives a `team_flow` summary (ordered team stops with outcome). `GET /projects/{id}` now returns the merged `history` + `team_flow`.
- Verified end-to-end via API: a video→content(reedit)→video→content(approved) run produced the exact team_flow and a 15-entry merged history.

## media router — pre-signed direct-to-R2 uploads (2026-07-15)
- `POST /media/presign` (auth): issues short-lived pre-signed PUT URLs so the browser uploads file bytes straight to R2 (bypassing the backend → up to 1 GB/file). Body `{files:[{filename,content_type,size}], prefix?}`; returns `{upload_url, method, headers, public_url, key, ...}` per file. Enforces the 1 GB cap.
- `storage.presign_put()` generates the signed URL (R2) or a local-disk PUT fallback (`PUT /media/local-blob/{key}`) when R2 is disabled — identical frontend flow either way.
- `storage.ensure_bucket_cors()` + `scripts/set_r2_cors.py` configure the R2 bucket CORS (GET/PUT/HEAD for the app origins) so browser PUTs from localhost/prod succeed. Run once per bucket.
- Legacy multipart endpoints (`/media/upload`, `/media/upload-attachments`) remain but are no longer used by the frontend.

## Timezone: mediaERP now runs entirely on IST (2026-07-15)
- **Policy** (`app/utils/timezone.py`): storage stays **UTC instants**; every wall-clock decision is **IST** (Asia/Kolkata, UTC+05:30). Fixed +05:30 offset used (IST has no DST) so no `tzdata` dependency for the helpers. Helpers: `IST`, `now_ist`, `to_ist`, `to_utc`, `today_ist`, `ist_day_start_utc/…_end_utc`, `ist_period_start_utc`, `utc_iso`.
- **BUG FIXED — email schedules:** `_compute_next_send` treated `send_time` ("09:00") as **UTC**, so schedules fired at 14:30 IST. Now computed in IST wall-clock and stored as the UTC instant. `scripts/migrate_schedules_to_ist.py` recomputes legacy rows (dry-run by default; `--apply` to write).
- **BUG FIXED — naive serialization (widespread):** ~38 sites across routers/services emitted `dt.isoformat()` on Motor's timezone-**naive** datetimes, dropping the offset — JS then parsed them as *local* time (e.g. email logs showed 14:39 instead of 20:09 IST). All now go through `utc_iso()`. Calendar `date(...).isoformat()` deliberately untouched.
- **Task date filters:** `list_tasks` today/this_week/this_month/this_year now use **IST day boundaries** (also fixes a latent `this_week` crash at month boundaries).
- **Celery:** `timezone="Asia/Kolkata"`, `enable_utc=False` — beat crontabs are IST wall-clock (anomaly scan 02:00 IST). Added `tzdata` to requirements.txt (beat needs the IANA db; Windows/slim containers lack it).
- `group_chat_service` now imports the shared `IST` constant.

## Leader Desk — leader self-assign fixed (2026-07-15)
- **BUG:** a leader could not meaningfully assign work to themselves. `GET /projects/leader/queue`'s `incoming` matched `{"$or": [assigned_to in ["",None], assigned_to == uid]}`, so a task the leader assigned **to themselves** stayed in the "Assign Work" (to-distribute) queue forever — the card never moved, so it looked like the action failed. (The write itself always succeeded: `can_assign_to_others` already allows a team leader, and the API returned 200.)
- **FIX:** `incoming` now matches **unassigned pending work only**. Once assigned to anyone — including the leader themselves — the task leaves the distribute queue and appears on the assignee's board. The old `assigned_to == uid` clause existed so leaders could see routed tasks auto-assigned to them, but routed copies now arrive unassigned (see the reedit/routing change), so it was vestigial and actively harmful.

## Tasks disappearing — root causes fixed (2026-07-18)
- **BUG (main cause): `workflow.bump_other_started` bumped the whole TEAM.** The
  "one started task per person" rule fell back to `team_id` when a task had no
  assignee — so starting ONE unassigned task moved *every other started task in
  that team* to Break. Coordinators create unassigned tasks, so work kept
  vanishing from the Started column with no message. Now scoped strictly to the
  assignee; unassigned tasks bump nobody. Reproduced before (`A=break`) and
  verified after (two people both stay Started; same person still bumps).
- **`list_tasks` truncation is no longer silent.** Cap raised 500 → `TASK_LIST_LIMIT`
  (2000) and the function now returns `(tasks, total)`. `GET /projects` reports
  `meta: {total, returned, truncated}` and a "Showing X of Y tasks" message.
  Results are newest-first, so a cap always drops the OLDEST work.
- `success_response()` gained an optional `meta` dict (omitted unless supplied,
  so existing clients are unaffected).
- **Task creation now validated server-side** (POST /projects): title, team_id,
  due_date and assigned_to are all required, and the assignee must be a leader or
  member of the selected team. Routed copies still bypass this — they're created
  via `insert_one`, intentionally unassigned.

**Environment note:** ports 8000 and 3000 were both occupied by *other* projects
(a `bun --watch src/index.ts` server, and `Delta/lms/client`). mediaERP was being
tested against a foreign API. `bun --watch` respawns itself — kill the parent.

## Real pagination for tasks (2026-07-18)
- `GET /projects` accepts `page` (>=1) and `limit` (0-500), mirroring the
  existing `/users` convention. **`limit=0` (default) preserves the legacy
  behaviour** — everything up to `TASK_LIST_LIMIT` — so existing callers are
  untouched.
- `list_tasks()` applies `.skip()/.limit()` and always returns the true `total`.
- Pagination rides in `meta`, NOT in `data`: `{total, returned, page, limit,
  pages, has_more, truncated}`. `data` stays a plain array so nothing breaks.
- Verified lossless: walking 9 pages of 10 returned exactly 86 unique tasks with
  zero duplicates; per-column paging (`status=pending`, 6 pages of 5) returned
  all 28 with no gaps.

## Frontend same-origin API proxy (2026-07-19) — no backend change
Purely a frontend routing change (see frontend/componentsHistory.md). Noted here
because it affects how the backend is reached: in production, ALL browser
traffic (REST + WebSocket) now arrives via the frontend's Next.js server acting
as a reverse proxy, rather than directly from browsers. CORS on the backend can
eventually be tightened to just the frontend origin once this is confirmed live,
since direct cross-origin browser calls are no longer the intended path.

## Group report periods (daily/weekly/monthly) + PDF export (2026-08-01)
- `group_chat_service.py`: added `_period_range(period)` — "daily" is the IST
  calendar day (unchanged, what the 21:00 IST scheduler posts once a day);
  "weekly"/"monthly" are rolling windows (last 7/30 days from now, not
  calendar-aligned) so an on-demand report always reflects recent activity
  regardless of which day it's triggered. Extracted the team-level counting
  logic that used to live inline in `build_daily_report_text` into a shared
  `_team_report_stats(db, team, period)` so the chat-message report and the
  new PDF export can never drift apart. `build_daily_report_text`,
  `post_member_reports`, `post_daily_report`, and `_member_report_rows` all
  gained a `period: str = "daily"` param — every existing call site
  (including the 21:00 IST scheduler and the nightly employee email digest)
  is unaffected since the default preserves prior behaviour exactly.
- Added `build_group_report_pdf(db, team, period)` — reportlab-based PDF
  (title + summary line + one table row per member listing their completed
  and pending tasks for the period), following the same styling pattern as
  the existing campaign PDF export in `routers/export.py`.
- `routers/chat.py`: `POST /chat/groups/{id}/report/send-now` now takes an
  optional `period` query param (`Literal["daily","weekly","monthly"]`,
  default `"daily"`). Added `GET /chat/groups/{id}/report/export/pdf`
  (default `period="monthly"`) which streams the PDF as a download instead
  of posting to the group. Both endpoints share one `_resolve_report_group`
  helper for the group/team lookup and the Super Admin/Admin/Coordinator-or-
  team-leader access check (a pure extraction of the pre-existing send-now
  check — not a behavior change).
- Verified end-to-end against the live backend, not just code review: posted
  daily/weekly/monthly reports and exported daily/weekly/monthly PDFs across
  all 9 real chat groups (27 + 27 calls) — every combination returned 200
  with correctly period-labeled content (or a valid `%PDF-` PDF, correct
  `Content-Disposition` filename, non-trivial size scaling with member
  count). Confirmed the no-`period` call still defaults to daily
  (backward-compatible) and an invalid period value is rejected with 422.

## BUG FOUND & FIXED: `reportlab`/`openpyxl` missing from the real venv (2026-08-01)
User hit "Export failed" on the new monthly-report PDF button. Root cause was
**not** the new feature's code — `backend/.venv` (the actual environment
powering the live app the user runs) had neither `reportlab` nor `openpyxl`
installed, and **neither was ever listed in `requirements.txt`**. Both imports
are lazy (inside the function body), so every request re-attempted the import
and 500'd with a bare "Internal Server Error" the moment any export path
(the new group-report PDF, and the pre-existing campaign Excel/PDF export)
was actually exercised through that venv.

This also retroactively explains an earlier mystery from this same session:
`/export/campaigns/{excel,pdf}` 500'd "on the live server" but worked fine
from a standalone script — that was never a stale-process/state issue, it was
this same missing-dependency gap. The standalone script happened to run under
the system Python (which had both packages installed from earlier ad-hoc
work), not the project's `.venv`.

A separate, unrelated contributing factor found while debugging: **two
independent backend processes were both listening on port 8000** (one
`preview_start`-launched instance using system Python, one the user's own
`.venv`-based `uvicorn --reload`), left over from `preview_start` being
invoked multiple times across this long session without the prior instance
being stopped. Requests could land on either nondeterministically depending
on which loopback address Windows routed to. Stopped the redundant one —
only the user's own `.venv`-based process should be running against real app
data going forward.

**Fix:**
1. Added `openpyxl==3.1.5` and `reportlab==4.5.1` to `requirements.txt`.
2. `pip install`ed both into `backend/.venv` directly (no process restart
   needed — the imports are lazy, so the very next request picked them up).

**Verified:** re-ran the exact failing request (Content Studio, monthly PDF)
against the live server → 200, genuine `%PDF-1.4` file. Also re-verified the
pre-existing `/export/campaigns/excel` and `/export/campaigns/pdf` endpoints,
which were silently broken by the same gap and are now fixed too. Full
regression: 54/54 (9 groups × 3 periods × {send-now, export-pdf}) against the
real, single remaining backend process.

## R2 storage: public bucket → signed reads (2026-09-08)
- **Why:** the R2 bucket `lms-delta` is **shared with the Delta LMS project**, and the LMS turned public access off on it (see `../lms/docs/R2_SIGNED_ACCESS.md`). Every URL mediaERP had built from `R2_PUBLIC_URL` began returning 401/403, so all task/chat attachments and social previews were broken. Verified: real key via `pub-…r2.dev` → 403; same key via a signed GET → 200.
- **Model:** `key` is the source of truth; an Attachment's `url` is derived and disposable. Reads mint a short-lived **signed GET** *after* the route's own access check. No backfill was needed — `key_from_url()` recovers a key from rows written while the bucket was public.
- **New in `utils/storage.py`:** `presign_get(key, expires)`, `key_from_url(url)` (handles bare key, `pub-*.r2.dev`, the configured public base, and the S3/signed form; returns `None` for external hosts, the local `/uploads/` fallback, and anything with `..`), `resolve_media_url(url)`, `sign_attachment(s)`, `canonicalize_attachments()`.
- **Read paths (all three attachment serializers):** `project_service._serialize` (every task path — list, detail, leader queue, routing — funnels here), `models/chat.message_to_dict`, `group_chat_service.group_message_to_dict`.
- **Write paths:** `project_service.create_task`/`update_task`, `chat_service.save_message`, `group_chat_service.save_group_message` now run `canonicalize_attachments()` — clients round-trip the signed URL they were given, and storing that would leave an expiring bearer token in the DB. `url` is reduced to the key.
- **Social publishing:** Meta fetches `image_url`/`video_url` from its own servers, so those are signed **at publish time** (1 h TTL — inside Instagram's ≤90 s fetch+processing window), in `routers/social.py` (3 publish endpoints) and `services/schedule_service.py`. `routers/schedule.py` stores the bare key (`_store_media_url`) so a post scheduled for tomorrow signs fresh when it fires, and signs on read for the composer preview.
- **Config:** `R2_GET_URL_TTL` (default 3600, clamped 60 s–24 h). `R2_PUBLIC_URL` is now legacy — kept only so `key_from_url` can parse old rows.
- **Verified:** 31/31 across happy-path / edge / error / auth, against the live bucket — signed GET fetches the real 703 KB object, legacy keyless rows recover, external + local URLs pass through untouched, traversal refused, R2-disabled degrades to pass-through, and the public URL is confirmed **denied**.
- **⚠️ Still shared:** the LMS's own unauthenticated `/assets/*` proxy does not block the `attachments/` prefix, so it can serve mediaERP attachments with no auth. Signing here does not close that — mediaERP needs its own bucket.

## R2: mediaERP/ namespace + LMS key convention (2026-09-08)
- **Folder:** every object this app writes now lives under `R2_ROOT_PREFIX` (default `mediaERP`), because the bucket `lms-delta` is shared with the Delta LMS. Keys: `mediaERP/<folder>/<epoch-ms>-<16 hex><ext>` — the same shape as the LMS's `makeKey`, replacing the old `<folder>/<uuid4hex><ext>`.
- **Why it matters beyond tidiness:** the LMS's unauthenticated `/assets/*` proxy blocks by prefix (`videos/`, `kyc/`) and streams everything else out of the shared bucket with no auth. With all of ours under one prefix, they can fence it off by adding `'mediaERP/'` to `BLOCKED_PREFIXES` — one line.
- **BUG FIXED — unsanitised `prefix`:** `_safe_key` did `prefix.strip("/")`, so a client posting `prefix: "../../etc"` to `/media/presign` minted `mediaERP/../../etc/…`. Not a path escape (keys are opaque strings) but worse: `presign_get`, `key_from_url` and `delete_object` all refuse keys containing `..`, so the upload would succeed and then be permanently unreadable AND undeletable. New `_safe_folder()` keeps only `[A-Za-z0-9_-]` segments, falling back to `misc`. Found by the negative-case tests, not by review.
- **New helpers** (mirroring the LMS): `object_exists`, `delete_object`, `copy_object`. Nothing in the request path deletes — attachment removal only detaches the reference — so these serve migrations, cleanup and tests. `copy_object` is server-side, which is what makes relocating ~25 GB practical.
- **Backward compatible:** the 424 pre-existing objects stay at root-level `attachments/` and still read, because keys are stored and reads sign whatever key the row holds. No backfill required.
- **`scripts/migrate_r2_prefix.py`** consolidates them when wanted: report-only by default, `--apply` to copy + rewrite `project_tasks.attachments[]` / `messages.attachments[]` / `scheduled_posts.image_url|video_url`, `--delete-originals` as a separate explicit run. Copies never move; each copy is verified with `head_object` before any DB row changes. Dry run confirmed: 424 objects / 24.9 GB.
- **Verified:** 1075/1075 upload assertions over 3 rounds x 7 methods (presigned PUT, server-side put_object, local-disk fallback, 12-way concurrency, attachment write/read pipeline, negative cases, legacy-key compatibility) across 13 file types incl. 0-byte, 2 MB, unicode and space-bearing names; 37/37 route-level tests against the live endpoints; 31/31 signed-access; pytest 76 passed / 8 pre-existing failures. All 99 objects created per run are deleted again — cleanup batches, verifies by listing, and retries, after an early run leaked 66 objects when the network dropped mid-cleanup.

## R2 CORS: live-upload outage + merge-safe policy management (2026-09-08)
- **Outage:** file upload on `https://media-erp.deltainstitutions.com` failed with a 403 on the CORS **preflight**. Cause was a one-hyphen hostname mismatch — the bucket's `AllowedOrigins` held `https://mediaerp.deltainstitutions.com` (no hyphen) while the live site is `media-erp.`. `AllowedOrigins` is exact-match, so the browser never sent the bytes. The signed URL itself was fine.
- **Why local testing missed it:** every upload test ran from `localhost:3000`, which *was* allowed. A local suite is structurally blind to a production-origin CORS failure. `scripts/set_r2_cors.py` (dry-run) now prints the live-vs-allowed diff, and the preflight matrix covers each real origin.
- **`ensure_bucket_cors()` now MERGES (`replace=True` to opt out).** A bucket has ONE CORS policy and `put_bucket_cors` replaces it wholesale. `lms-delta` is shared with the Delta LMS, so writing only mediaERP's origins would have revoked the LMS's 4 origins **and** its `Content-Range`/`Accept-Ranges` expose-headers (its HLS video seeking depends on them). The old script would have traded this outage for one in the LMS.
- **`remove=[...]` / `--prune a,b`** drops stale origins after the merge, and **never** prunes an origin that is in our own `ALLOWED_ORIGINS` — verified by passing the live origin into a prune list and watching it get skipped. Writing an empty origin list is refused outright (it would lock every browser, including the co-tenant's, out of the bucket).
- **`get_bucket_cors()`** added for inspection; returns `[]` when unset/unreadable.
- **Final policy (10 origins):** 4 LMS + `media-erp.` + `media-erp-admin.` + localhost/127.0.0.1 :3000/:3001. Pruned the dead `mediaerp.deltainstitutions.com` and `api-mediaerp.deltainstitutions.com` (the latter is the backend origin — backends never issue browser preflights).
- **Verified:** 10/10 preflight checks (8 allowed with the origin echoed at HTTP 204, 2 pruned origins correctly 403); LMS expose-headers intact; 359/359 upload assertions; pytest 76 passed / 8 pre-existing. Note R2 answers a successful preflight with **204**, not 200 — an assertion expecting 200 will report false failures.

## Overview: Team Leader member filter + /projects member_id authorisation (2026-10-07)
- **Feature:** a scope picker on the Overview lets a Team Leader (and elevated roles) view any of their people's overview — every KPI, the pipeline, Recent Activity, Upcoming Deadlines and the Teams section re-scope to that person. Backend reuses the existing `GET /projects?member_id=`; no new stats endpoint, because the Overview is computed client-side from one task list.
- **SECURITY FIX (IDOR) — `routers/projects.py` `get_tasks`:** for a Team Leader with no `team_id`, `member_id` used to switch to that user's tasks **and clear the team scope**, with no check that the leader leads them — any leader could read any user's tasks across every team. Projects never triggered it (it always sends `team_id` too); the Overview filter would have been the first UI to. Now:
  - New helper `_teams_shared_with(db, team_ids, member_id)` — which of the leader's teams contain that person.
  - `leader_teams` (no team_id): refused unless they share a team; otherwise confined to the shared teams (`member_team_ids`).
  - `team` (team_id given): the same membership check — also closes the leak of a non-member's personal tasks via the Projects path.
  - Elevated roles and employees: untouched.
  - A refusal returns the normal empty envelope (`success:true`, `total:0`, "Tasks retrieved") so it never confirms the user exists.
- **`project_service.list_tasks`:** new optional `team_ids` param — confine to these teams **plus teamless work**, mirroring the existing `include_teamless` semantics (commit 2d993da: a personal task has no board and must stay visible to its approver). Defaults to `None`, so every other caller is unchanged.
- **Verified — no unintended change:** the same 21-case matrix was run against the original code (stashed) and the new code, then diffed. 15/21 byte-identical; the 6 that changed all trace to the one rule; **the change only ever removes access, never grants it.** Includes Media Schedule's exact request shapes — the other `member_id` consumer — whose team-scoped, "My Tasks" and admin calls are identical, and whose member overlay narrows as intended.
- **New permanent test `tests/test_member_scope.py`:** integration test on a throwaway Mongo DB (created + dropped; auto-skips without Mongo). It **fails against the original code** with the right message, so it genuinely tests the fix. pytest: 77 passed / 8 pre-existing failures. Before this, no test exercised `/projects` authorisation at all.
- **Found, NOT fixed (pre-existing, out of scope):** Media Schedule's "⭐ My Tasks" sends the literal string `"__me__"` as `member_id` to `/projects` (it maps `__me__` to the user id for its media query but not this one), so that overlay has always been empty. One-line fix: pass `resolvedAssignedTo`.

## Repeating tasks + multiple assignees (2026-10-07)
- **Plan:** `plan.md` (approved with decisions D1–D7: count includes today's copy; "until I stop it"; leaders/admins only; spawn at 00:00 IST; missed days caught up with their real dates; copy due same day or +N days; one copy per person).
- **`app/services/task_factory.py` (new) · `raise_task(db, data, current_user) -> dict` · `TaskRaiseError(message, status_code)`** — the body of `add_task`, moved verbatim so the single create, the batch and the scheduler all create tasks through one path (same validation, approver/verifier defaults, notifications, chat DM). `add_task` now just calls it. **Verified byte-identical:** an 18-case before/after matrix (response, stored doc, history, notifications, chat DMs) on a throwaway DB — identical on the old code, the new code, and again after the final edits.
- **`app/services/recurrence.py` (new):**
  - Date engine: `add_months`, `occurrence_date(frequency, anchor, index)` (always computed from the anchor, so no drift; monthly clamps to month end — the 31st → 28/29 Feb → 31 Mar), `first_index_on_or_after`, `today_ist`.
  - Rules: `can_create_series` (→ `workflow.can_assign_to_others`), `can_manage_series`, `validate_assignees` (dedupe, ≤25, active), `validate_repeat` (count ≤ 365 daily / 104 weekly / 36 monthly; due offset ≤ 60 days).
  - Lifecycle: `create_series` (anchor = today, first copy created immediately), `advance_series(db, series_id, today=None, cap=31)`, `resume_series` (skips the paused days), `_pause`, `serialize_series`.
  - Scheduler: `run_due` + `start_recurring_scheduler` — a daemon thread with its own event loop and Motor client, polling every 60 s (the `main.py` lifespan starts it as `recurring-task-scheduler`).
  - **Safe with 2 gunicorn workers:** copies are inserted first, and the partial unique index `unique_recurrence_copy` on `(recurrence.id, recurrence.date, assigned_to)` stops a duplicate. The series then moves forward with a compare-and-set on `next_index`, so a run that read the series before a pause/resume can't write over it and fill in the paused days. Both safeguards are mutation-tested (removing either one makes a test fail).
  - Self-protection: if the creator loses the right to assign, the series pauses; an inactive assignee is skipped; if every assignee fails, the series pauses.
  - **Collections:** `recurring_tasks` (new); tasks gain an optional `recurrence {id, frequency, index, total, date}` and `batch_id`.
- **`routers/projects.py`:** `POST /projects/batch` (multi-assign with or without repeat; a non-leader gets 403 when asking for repeat; if the first copy fails, no series is left behind), `GET /projects/recurring`, `GET /projects/recurring/{id}`, `PATCH /projects/recurring/{id}` (edit future copies; pause / resume / stop; 409 once ended). All are registered before `/{task_id}`.
- **`project_service.create_task`:** stores `recurrence` / `batch_id` only when present — every existing caller writes the same document as before.
- **`database.create_indexes`** → `recurrence.ensure_indexes`. The index is partial (`recurrence.id` must be a string), so it covers 0 of the existing tasks.
- **Tests:** `tests/test_recurrence.py`, 29 integration tests on a throwaway DB (date edge cases, limits, batch rules, leader-only, daily/weekly/monthly lifecycles, run-twice and two-worker no-duplicates, pause/resume race, downtime catch-up, stop, edit-future-only, creator demoted, inactive assignee, permissions). Full suite: 106 passed / 8 pre-existing failures (auth-middleware, connectors, Facebook OAuth — unchanged).
- **Cross-checked:** the server and client date engines agree on 1,680 generated dates.
- **QA pass 2 (same day) — FIX: `GET /projects/recurring/{id}` had no access check.** Any signed-in user with a series id could read its title, description and assignee names (the list endpoint was scoped; this one wasn't). New `recurrence.can_view_series`: managers (creator / team leader / admin), current assignees, and anyone a copy names as assignee, approver or verifier. Everyone else gets the same 404 as a missing id, so existence isn't confirmed. Test `test_reading_one_series_is_limited_to_the_people_it_involves` fails with only the check removed. Live API pass: 65/66 (the 1 is a wording difference between "1 task created" and "Task created"); time-travel on live QA series 12/12; pytest 107 passed / 8 pre-existing.
- **Found during QA, not a code bug:** the dev DB's `email_settings` holds live Gmail SMTP, so every task created while testing emails the admins ("New task assigned to a team"). Pause it (park the `smtp` doc) before any QA that creates tasks.

## Ad Reports — Meta "Performance overview", entered daily (2026-10-07)
- **Plan:** `plan.md` (approved; D1 yesterday's full-day numbers · D2 reminders 12:00 person / 17:00 person + leader · D3 no reminders Sundays/holidays · D4 Leads + Amount spent → CPL, extras optional · D5 leaders + admins create · D6 person corrects last 7 days, leader any, all edits kept · D7 owner + optional backup).
- **`app/services/ad_report_service.py` (new):**
  - Rules: `expected_days` (start → min(end, yesterday), minus pauses), `missing_days`, `day_status` (updated/due/missing/paused/ended/not_started), `to_paise` (exact `Decimal`, ≤2 decimals), `computed` (CPL/CTR/CPM/CPC from totals — never averages of averages), `validate_entry/assignees/times`.
  - Permissions: `can_manage` (elevated or leader of the report's team), `can_enter` (+ assignees), `visible_query`.
  - `series(db, report, lo, hi, granularity)` — totals, previous period (**only when the report fully covered it**), day/week/month points; a missed day is `values: None` + listed in `missing` (a gap, not zero); `edited` / `off` markers.
  - Reminders: `run_reminders(db, now, holidays)` — working days only (`worktime.is_working_day` + `company_holidays`); stage 1 → assignees, stage 2 → assignees + team leaders; one per report/stage/day listing every missing date; if both stages are due at once only stage 2 is sent. **Exactly-once:** `claim()` inserts into `ad_report_reminders` (unique `report_id, on_date, stage`) first. `auto_end` ends a report once its end date is past and every day is in.
  - `deliver(db, …)` — bell row + web push + opted-in email using only the passed `db` (safe from the scheduler thread). `start_ad_report_scheduler` (daemon thread, own loop/client, 60 s), started in `main.py` lifespan.
  - **Collections:** `ad_reports`, `ad_report_entries` (unique `report_id, date`; money in paise; `edits[]` audit, last 50), `ad_report_reminders` (TTL 40 days).
- **`app/routers/ad_reports.py` (new):** `GET/POST /api/v1/ad-reports`, `GET /today` (sidebar badge, banner, leader strip), `GET/PATCH /{id}` (edit; pause/resume/end with status compare-and-set), `GET /{id}/series`, `GET /{id}/entries`, `PUT /{id}/entries/{date}` (insert-or-edit with race retry; 7-day rule for non-managers; ended = read-only for assignees), `POST /{id}/remind` (leader, atomic 1-hour rate limit → 429). Anyone a report doesn't involve gets the same **404** as a missing id.
- **Touch points (additive):** `main.py` router + thread; `database.py` indexes; `notification_prefs._ALL_TYPES` + `web_push_service.ALERT_TYPES` gain `ad_report_due`, `ad_report_overdue`.
- **FIX found while researching (pre-existing, affected the repeating-task scheduler):** `chat_notify._send_dm` → `chat_service.save_message` / `resolve_task_snapshots` used the global Motor client, which is bound to the main event loop; from the scheduler thread it raised "attached to a different loop" after writing the first DM, so the rest of that task's DMs were skipped. Both now take an optional `db` and `_send_dm` passes its own. Proven before/after from a thread loop: 1 → 2 DMs stored, warning gone. Existing callers unchanged (default `None` = old behaviour).
- **Tests:** `tests/test_ad_reports.py` — 21 tests on a throwaway DB with a frozen IST clock (money, CPL maths, expected days/pauses, status chip, create permissions + validation, entry rules, 7-day window, strangers 404 on every endpoint, series gaps/weeks/previous-period rule, reminder ladder, Sunday/holiday/paused/done skip, late start → stage 2 only, 4 workers at once → each reminder once, pause skips days, auto-end, remind rate limit, today summary). **Mutation-tested:** breaking the claim, the access check, the 7-day rule or the gap rule each turns tests red. Full suite: 128 passed / 8 pre-existing failures.
- **Live check:** on the dev server the scheduler sent stage 1 at 16:19 IST to the owner and backup, once; 0 emails (SMTP paused for QA).
- **QA pass 2 (same day):**
  - **FIX (pre-existing, affects every notification email): `notification_service._notif_email_html` didn't escape its title/message.** Task titles, report names and people's names went into the HTML raw, so anyone could put a link or markup into a mediaERP email (e.g. a task titled `<a href=…>Verify your account</a>`). Now `html.escape`d; none of the 22 callers send HTML, so nothing changes for normal text. Test `test_notification_email_escapes_user_text`.
  - Live API pass on Ad Reports: 51/51 (26 hostile inputs incl. NaN/Infinity/1e20/30 Feb/operator injection, 3 concurrency races — 10 simultaneous first saves → 1 row; 5 simultaneous "Remind" → one 200 + four 429; 4 simultaneous pauses → one 200 + three 409 — lifecycle, 6-persona access, month grouping; list of 47 reports 153 ms, /today 16 ms).
  - **Live reminder ladder on the dev server:** stage 1 at 16:49 to the owner; stage 2 at 17:00:39 to the owner **and** the team leader; once each; 0 emails (SMTP paused).
  - Note: `uvicorn --reload` also watches `tests/` — editing a test restarts the dev server mid-request.
  - pytest: 129 passed / 8 pre-existing failures.

## Ad Reports — creatives (the ad itself) + ratio fix (2026-10-07)
- **Creatives:** `ad_reports.creatives[]` `{id, key, url(=key), filename, content_type, size, uploaded_by(_name), uploaded_at}`; first = cover. Endpoints: `POST /ad-reports/{id}/creatives` (assignees + leaders; ended → leaders only; cap 12 enforced in the update filter so concurrent adds can't overshoot), `POST /{id}/creatives/{cid}/cover` (compare-and-set on the list read), `DELETE /{id}/creatives/{cid}` (uploader or leader; **detaches only** — house rule, objects are never deleted from the shared bucket). Read path signs each key (`serialize_creatives` → `sign_attachment`).
- **`validate_creative` — shared-bucket guard:** the key must start with `<r2_root_prefix>/ad-creatives/` (no `..`), type image/* · video/* · application/pdf, and `object_exists` must confirm the upload (HEAD, run in a thread). Without the prefix check, a caller could register any key in the bucket the LMS shares and receive a signed link to it. ⚠ Task and chat attachments (`canonicalize_attachments`) have no such check — flagged, not changed here.
- **FIX — ratios mixed populations:** CTR/CPM/CPC divided all-days spend/clicks by only the days that recorded impressions (turning Impressions on mid-campaign gave CPM ₹3,16,942 and CTR > 100%). `_sum` now computes each ratio from days that recorded both parts (`_pair`); CPL unchanged.
- **Validation:** reach > impressions and link clicks > impressions are refused (422).
- **Tests:** +5 (paired ratios, reach/clicks limits, creatives add/cover/remove permissions, creative rules incl. foreign key, `..`, wrong type, missing object, cap, ended). Mutation-tested: dropping the prefix guard or the pairing turns a test red. Suite: 133 passed / 8 pre-existing.

## Repeating tasks — choose the weekday / day of the month (2026-10-07)
- `RepeatSpec` gains `weekday` (weekly; Monday 0 … Sunday 6) and `month_day` (monthly; 1–31). Omitted = the day it's created (old behaviour, unchanged).
- `recurrence.first_date(frequency, today, weekday, month_day)` — today, or the next chosen weekday / date (31st in February → 28 Feb). `create_series` anchors there and stores `month_day` / `weekday`; today's copy is created only if the first day is today.
- **`month_day` is stored, not derived:** a series for the 31st that starts in February anchors on the 28th; `occurrence_date(..., month_day)` (also used by `advance_series` and `resume_series`) returns to the 31st afterwards instead of drifting to the 28th forever. Mutation-tested.
- `POST /projects/batch` with a future first day returns 201 "the first task is created on Fri 9 Oct" (no copies yet, not the "nothing could be created" failure path) and pre-checks the approver rule that the first copy would hit later. `validate_repeat` rejects a weekday on non-weekly / out-of-range, a month_day on non-monthly / outside 1–31.
- Tests: +9 in `tests/test_recurrence.py` (first-date maths, clamped-anchor survival, weekly Monday start, monthly 31st Oct→Jan, chosen day = today creates now, validation, future start + bad approver, resume keeps the 31st, 31st started in February). Client/server engines cross-checked on 2,860 cases / 27,500 dates — 0 mismatches.
- **QA pass (same day) on creatives + chosen weekday/date:**
  - **FIX — creatives trusted the client's claims.** The upload signer lets the browser pick the Content-Type, and `validate_creative` checked the type the request *claimed*: an HTML page uploaded as text/html and claimed as image/png was accepted, as was SVG (can carry script), and `size` came from the client. New `storage.object_meta(key)` (HEAD → real ContentType + ContentLength); `validate_creative` now takes type and size from storage, refuses SVG, and ignores the claim. Test `test_creative_type_and_size_come_from_storage`, mutation-checked.
  - **FIX — `weekday: true` was accepted as Tuesday** (pydantic lax mode turns JSON true into 1). `RepeatSpec.weekday` / `month_day` are `StrictInt`; "3" and true are refused.
  - Live API pass: 52/52, run twice (permissions for owner/backup/leader/4 outsiders, signed link really serves the bytes, 10 hostile keys incl. LMS paths, other app folders, `..`, case tricks, URLs, operator injection; 14 simultaneous adds never exceed 12; 6 simultaneous "make cover" lose nothing; ended rules; ratio fix; reach/clicks limits; every weekday and month days 1/7/31; until-stopped + 2 people + due offset with a future start; pause→resume before the first day keeps the weekday).
  - Time-travelled the real Friday and 31st series day by day to March: copies only on Fridays (9 Oct → 6 Nov, completed after 5) and on 31 Oct, 30 Nov, 31 Dec, 31 Jan.
  - Suites: new-feature suites 66/66 ×3; full suite 143 passed / 8 pre-existing ×2.

## Ad accounts, with ads underneath (2026-10-07)
- **Model:** `ad_reports.kind` = `"ad"` (default — existing reports unchanged) | `"account"`; ads get `account_id`; accounts get `ad_account_ref` (e.g. act_…). Index on `account_id`.
- **An account's numbers are its ads added up — never typed.** `series(..., children=…)` merges every ad's rows day by day (`by_day` now holds lists), a day is "missing" when any ad owes it, ratios use the existing paired rule across ads, metrics = union of the ads', range start = earliest ad. Adds `breakdown` (one row per ad: totals for the range, day status, owners, cover).
- **Rules:** an ad may join only an open account of **its own team** (`_check_account`; otherwise a leader could read another team's spend through an account's totals — mutation-tested). Accounts are visible to the team's leaders + admins only (an ad owner sees the account *name* on their ad, not its totals). Accounts have no people/dates/metrics/reminders: entries → 422, remind → 409, pause/resume → 409, people/dates edits → 422; End archives an account (its ads keep running). Excluded from the reminder scheduler, auto-end, "today" counts and badges (`AD_ONLY`).
- **API:** `POST /ad-reports` `kind:"account"` (name, team, optional ad account ID) or an ad with `account_id`; `PATCH` `account_id` / `clear_account` (ads), `ad_account_ref` (accounts); `GET /{account}/series` → roll-up + breakdown.
- **Also:** the status chip now uses the same IST day as the rest of the report (`now_on(today)`), which the roll-up exposed (real clock vs report day could disagree).
- **Tests:** +6 (create rules, same-team join, roll-up maths + missing days + breakdown, accounts have no numbers/reminders, moving an ad, owner sees name not totals). Live: account = delta + reel exactly (204 leads, ₹35,697.25). Suite 149 passed / 8 pre-existing ×2.

## Saved tasks — task-name suggestions (2026-10-08)
- **Why:** 52% of tasks in the dev DB reuse an existing title; leaders were retyping routine work.
- **`app/services/task_preset_service.py` + `app/routers/task_presets.py` (new), collection `task_presets`** `{team_id|null (company), team_key, title, title_key, description, priority|null, created_by…}`, unique (team_key, title_key) → no duplicates per list, any case/spacing; ≤200 per list; names ≤120.
- `GET /task-presets/suggest?team_id` — one call per team: `saved` (that team's — or all your teams' when none is picked, labelled), `company`, `recent` (titles from the last 90 days of **teams you belong to + your own tasks only**, minus names already saved, with use counts), `can_save`. The browser filters as you type. "Used N×" and "recent" are counted from `project_tasks`; task creation is untouched.
- Management: `GET/POST/PATCH/DELETE /task-presets` — a team's leaders + admin roles for team lists; admin roles for the company list.
- Tests `tests/test_task_presets.py` (7): who can save, name-only + duplicate rules, **no cross-team leakage** (mutation-checked), no-team-picked labelling, saved names not repeated as recent + use counts, edit/delete rules, limit. Suite 156 passed / 8 pre-existing ×2.

## Overview PDF — download the Overview with its filters (2026-10-08)
- **`query_scoped_tasks(current_user, db, *, search, status, priority, date_filter, date_from, date_to, team_id, member_id, scope, page, limit)`** — `app/routers/projects.py`. The one place that decides which tasks a user may see with every filter applied (visibility, Team Leader member authorisation, member + date filters). Moved verbatim out of `GET /projects`; a refused member browse returns `([], 0)`, which `GET /projects` answers exactly as before. **Reuse this for any new view of "the tasks I can see"** — never re-implement the rules.
- **`GET /api/v1/projects/overview/pdf`** — params `member_id`, `date_filter`, `date_from`, `date_to`, `range_name` (display only). Same tasks as the Overview (asserted in tests), PDF built with reportlab in `asyncio.to_thread`. Names a member only when the viewer may browse them (a refused id → empty, nameless "Member overview"). `Content-Disposition` filename: `overview_{mine|<name-slug>|member}_{all-time|this-month|YYYY-MM-DD|from_to_to}.pdf`.
- **`app/services/overview_report_service.py`** — `summarize(tasks, today)` (pure; the Overview's formulas: in progress = started+break, overdue = due < IST today and not approved, avg over approved with time, JS-style rounding), `team_rows`, `describe_period` (labels the filter actually applied — an unparseable date is "All time"), `pdf_text` (cp1252-safe for Helvetica + escaping + clipping), `build_pdf` (A4: header, KPI tiles, pipeline bar + legend, teams, upcoming deadlines, all tasks with repeating header, "Page X of Y" footer).
- **Gotchas:** a table row taller than a page raises reportlab `LayoutError` — long text is clipped (`TITLE_MAX`) and tables use `splitInRow=1`. Helvetica can't draw emoji/other scripts, so they're dropped (today's data is plain text; swap in a bundled Unicode TTF if that changes).
- **Tests:** `tests/test_overview_pdf.py` (formulas, period labels, 5,000-char title + 300-task stress, endpoint = list for leader/member/admin/employee, refusal nameless) — mutation-checked.

## "Ad not performing" — send a weak ad to a team leader to recreate (2026-10-08)
- **`app/services/ad_flag_service.py`** (collection `ad_flags`): `leader_directory(db, exclude_uid)` (teams → active leaders, the "Send to" list), `default_recipient` (last recipient for this ad, else the sender's last), `snapshot(db, report)` (last 7 complete days vs the 7 before via `ad_report_service.series` + 14-day leads — frozen on the flag), `create(...)`, `serialize(...)` (signs the ad's *current* creatives), `summaries_for(db, report_ids)` (status line per ad), `act(db, user, flag, action, note)` (start / done / decline — reason required / withdraw — sender, open only; compare-and-set), `ensure_indexes` (unique partial `report_id` where `active: true` = one open flag per ad).
- **`app/routers/ad_flags.py`**: `GET /ad-reports/{id}/flag-draft`, `POST /ad-reports/{id}/flags`, `GET /ad-flags/inbox`, `GET|PATCH /ad-flags/{id}`. Who may flag = `ad_report_service.can_enter` (assignees, the ad's team leaders, admin roles); recipient = an active leader of the chosen team, not yourself; act = recipient or admin roles; view = recipient, sender, the ad's people, admin roles (others get 404).
- **Notifications** via `ad_report_service.deliver`: `ad_flagged` → the chosen leader (link `/leader?tab=ads&flag=<id>`; also on withdraw), `ad_flag_update` → sender + the ad's assignees (link `/ad-reports?report=<id>`). Added to `notification_prefs._ALL_TYPES`; `ad_flagged` added to web-push `ALERT_TYPES`.
- **`GET /ad-reports` rows** gain `flag` (open flag, else one closed in the last 14 days) — additive.
- **Tests:** `tests/test_ad_flags.py` (draft/recipients/snapshot, validation + permissions, one-open rule, notifications, inbox, full lifecycle incl. withdraw/decline/admin) — mutation-checked (6 mutants).
- **2026-10-08 fix:** `GET /ad-flags/inbox?scope=to_me|sent|all` (`all` = admin roles; others fall back to `to_me`) + `counts` (open) and `recent` (14 days) per scope; `leader_directory` adds `email` when a leader's name is shared by any other account; create message names where it went.
- **2026-10-08 — task table in the team-report layout:** `overview_report_service.task_timeline(task, holidays, now)` (pure) gives Assigned (last assigned/transferred, else created) · Started (first started) · Ended (last timer stop, else last submission) · Completed (last approval) · Time took (timing.total_seconds, as the Overview) · Late by (WORKING seconds via `worktime.working_seconds` from the end of the due day IST to completion, or to now = "so far"); `fmt_duration` (37h 03m · 50m · 8s). The PDF's "All tasks" moves to landscape pages (`BaseDocTemplate` with portrait + landscape templates); all tables use a light grey header band. The endpoint passes `load_holidays(db)` and names for tasks with no stored assignee name. Verified against two rows of the team's own report (30h 33m / 8s, 37h 03m / 11h 18m) and a real dev row (34h 52m).
- **2026-10-08 fix:** approved tasks from before history was kept (24 of 37 in dev) have no "approved" entry → `task_timeline` uses `updated_at` as Completed, flagged `completed_estimated` (shown with * and a note under the table). Download names now end with the IST generation time (`overview_<who>_<period>_YYYY-MM-DD_HHMM.pdf`) so a fresh download is never confused with an older same-named file (the user opened a 17:47 file made before the new table existed).

### Ad Reports — several teams, up to 6 people, account people, delete + undo (2026-10-09)
- **Files:** `app/services/ad_report_service.py`, `app/routers/ad_reports.py`, `app/schemas/ad_report.py`, `app/services/ad_flag_service.py`, `tests/test_ad_reports.py`.
- **Teams:** `team_ids` (≤5, main team first) beside `team_id` (= `team_ids[0]`, kept for flags / notifications / old code). `teams_of(r)` falls back to `[team_id]` for older reports — no migration. `can_manage` = admin roles or a leader of ANY of its teams (`leads_any`); `visible_query` matches `team_id` or `team_ids`; stage-2 reminders go to the leaders of every team (`teams_leader_ids`). Create: `team_ids` (or `team_id`), each one checked with `can_assign_to_others`. `PATCH team_ids`: non-admins may add/remove only teams they lead (403) and must keep one of their own (422); an account can't drop a team its ads rely on; an ad in an account must keep a shared team.
- **People:** `MAX_ASSIGNEES` 2 → 6 (owner first). Accounts may now have `assignees` (optional, `validate_assignees(required=False)`): they see the account and every ad in it (`visible_query` adds their accounts' ads) and may enter those ads' numbers (`can_enter` → `looks_after_account`); never reminded (reminders stay AD_ONLY; `/today` "mine" is AD_ONLY too).
- **Account join rule:** an ad may join an open account that shares at least one team (`_check_account(db, account_id, team_ids)`).
- **Delete:** `DELETE /ad-reports/{id}?with_ads=` (managers; ended too). `delete_report` copies the report(s) to `ad_reports_deleted` and their entries to `ad_report_entries_deleted` under one `batch`, THEN removes them (crash = duplicate, never loss). Account: detaches its ads (default) or takes them along (`with_ads`, must manage each — else 403, nothing deleted). Open/closed flags of a deleted ad keep `creatives_archived` + `report_deleted`; an open one gets a `report_deleted` history line and stays with the media leader (`fl.serialize` falls back to the archived creatives).
- **Undo:** `POST /ad-reports/deleted/{batch}/restore` (deleter or admin roles): same ids back, entries back (dup-safe), detached ads re-attached, an account link that no longer exists is cleared. Trash rows removed after; a second restore → 404.
- **Tests:** 8 new (multi-team visibility/manage, 6 people + escalation to every team's leaders, team edits / lock-out guard, account people, shared-team join, delete+undo ad (incl. flag), account keep/take ads, with_ads permission + gone account). 11 mutants: 10 caught, 1 equivalent (`/today` AD_ONLY is a second guard — `expected_days` already returns nothing for accounts). Full suite 183 passed / the same 8 old failures.
- **Fix (2026-10-09):** `delete_report` claims each report atomically (`deleting: {batch, at}`, expires after `DELETE_CLAIM_TTL` 10 min) before copying — a concurrent second delete gets 409 instead of a duplicate trash entry. Live QA matrix (68 checks, 11 QA accounts, every role) all pass.

### Tasks — optional "Project" (ad account) (2026-10-09)
- **Files:** `app/services/task_project_service.py` (new), `app/routers/task_projects.py` (new, `GET /api/v1/task-projects`), `app/services/task_factory.py`, `app/services/project_service.py`, `app/services/recurrence.py`, `app/schemas/project.py`, `app/routers/projects.py`, `app/main.py`, `tests/test_task_projects.py`.
- **Data:** `task_projects` {key (unique), name, platform meta|google|snapchat, group, order, active}. Seeded at startup with the 12 ad accounts (`ensure_seed`, idempotent by `key` — a rename/archive in the DB survives restarts). Tasks store `project_id` + `project_name` (looked up server-side, never from the request), only when chosen.
- **Rules:** validated once in `raise_task` (single, batch, repeating copies); `project_id` is a recurrence template field. `PUT /projects/{id}` `project_id` sets / changes (`""` clears, stored as empty strings because update_task only $sets). Unknown/archived id → 422. Tests: 7 (seed order + idempotency, with/without/bad/archived, employee's own task, batch + repeating copies + series template, edit set/change/clear, auth); 4 mutants — 2 caught, 2 equivalent (schema drops a spoofed `project_name`; the unique index blocks a duplicate seed).
- **Security fix (2026-10-09):** task edit (`PUT /projects/{id}`) now requires the same access as viewing; task delete requires admin role / creator / team leader (was: anyone signed in). `tests/test_task_access.py`.
