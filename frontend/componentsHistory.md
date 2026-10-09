# Frontend Components History

> Every reusable component ever created goes here.
> Read this before building any new component — it may already exist.
> Format: **Feature · File · Component · Props · Purpose**

---

## How to use

1. Before creating a component, search this file by name.
2. If it exists, import it — do NOT create a duplicate.
3. After creating a new component, log it here immediately.

---

## Shared / UI Components

### ThemeToggle
- **Feature:** 1.12
- **File:** `components/shared/ThemeToggle.tsx`
- **Props:** none
- **Purpose:** Sun/Moon button that toggles light/dark via `next-themes`. Renders a 36×36px placeholder until mounted to avoid hydration mismatch.
- **Animations:** none (CSS `transition-colors`)

### PageHeader
- **Feature:** 1.12
- **File:** `components/shared/PageHeader.tsx`
- **Props:** `{ title: string; subtitle?: string; action?: React.ReactNode }`
- **Purpose:** Section heading with optional subtitle and right-aligned action slot.
- **Animations:** none

### LoadingSkeleton
- **Feature:** 1.12
- **File:** `components/shared/LoadingSkeleton.tsx`
- **Props:** `{ lines?: number; className?: string }`
- **Purpose:** Animated pulse skeleton lines. Last line is 3/4 width. Default 3 lines.
- **Animations:** Tailwind `animate-pulse`

### EmptyState
- **Feature:** 1.12
- **File:** `components/shared/EmptyState.tsx`
- **Props:** `{ icon: LucideIcon; title: string; description: string; action?: React.ReactNode }`
- **Purpose:** Centered icon + title + description + optional CTA for empty collections.
- **Animations:** none

---

## Connector Components (Feature 2.8 – 2.11)

### SyncStatusBadge
- **Feature:** 2.8
- **File:** `components/shared/SyncStatusBadge.tsx`
- **Props:** `{ status: ConnectorStatus }`
- **Purpose:** Colored pill badge for connector status (connected/disconnected/syncing/error).
- **Animations:** none

### ConfirmDialog
- **Feature:** 2.8
- **File:** `components/shared/ConfirmDialog.tsx`
- **Props:** `{ open; onOpenChange; title; description; confirmLabel?; onConfirm; loading? }`
- **Purpose:** shadcn Dialog wrapper for destructive confirmations. Renders Cancel + destructive Confirm buttons.
- **Animations:** shadcn Dialog built-in

### ConnectorCard
- **Feature:** 2.8
- **File:** `components/shared/ConnectorCard.tsx`
- **Props:** `{ connector: Connector }`
- **Purpose:** Card showing platform initials, name, status badge, sync frequency, last synced date. Connect button (OAuth) shown when status is disconnected/error. Remove triggers ConfirmDialog.
- **Animations:** none

### AddConnectorModal
- **Feature:** 2.9
- **File:** `components/connectors/AddConnectorModal.tsx`
- **Props:** `{ open: boolean; onOpenChange: (v: boolean) => void }`
- **Purpose:** shadcn Dialog with platform picker grid + name input + sync frequency Select. On submit: creates connector then immediately starts OAuth redirect via `useStartOAuth`.
- **Animations:** shadcn Dialog built-in

### OAuthCallback
- **Feature:** 2.11
- **File:** `components/connectors/OAuthCallback.tsx`
- **Props:** none
- **Purpose:** Client component (renders null). Reads `?connected=` and `?error=` search params on mount, shows toast, invalidates `["connectors"]` query, strips params from URL without navigation.
- **Animations:** none

### ConnectorGrid
- **Feature:** 2.10
- **File:** `components/connectors/ConnectorGrid.tsx`
- **Props:** `{ connectors: Connector[] | undefined; isLoading: boolean; onAdd: () => void }`
- **Purpose:** 1–3 column responsive grid of ConnectorCards. Shows LoadingSkeleton while loading, EmptyState (with icon=Cable) when empty.
- **Animations:** none

---

## Template entry

```
### ComponentName
- **Feature:** X.Y
- **File:** `components/shared/ComponentName.tsx`
- **Props:** `{ propA: type; propB?: type }`
- **Purpose:** One-line description
- **Animations:** which Framer Motion variant it uses
```

---

### ApproveRouteModal (Leader Desk — Approve Task)
- **File:** `app/(dashboard)/leader/page.tsx`
- **Change (2026-07-15):** Removed the "Assign to leader" dropdown. Approval now only asks for "Route to team". The approved copy is created `pending` + unassigned in the destination team, so it surfaces to that team's leader(s) in their Leader Desk *incoming* queue (`/projects/leader/queue`). Dropped `nextLeaderId` state and the `next_leader_id`/`next_leader_name` payload fields (backend still accepts them; no backend change). `useAssignableUsers` import retained — still used by the Reedit modal.

### ReeditModal (Leader Desk — Send to Reedit)
- **File:** `app/(dashboard)/leader/page.tsx`
- **Change (2026-07-15):** Removed the "Assign to leader" dropdown; modal now only asks for a reason. Payload = `{status:"reedit", reedit_reason}`. Dropped `leaderId` state and the `useAssignableUsers` import (no longer used anywhere in this file). Backend now returns a routed reedit to the routing leader's team, so no manual leader-picking is needed here.

### TaskDetailModal — cross-team History + Team Flow (2026-07-15)
- **File:** `components/projects/TaskDetailModal.tsx`
- **Change:** History tab now shows the FULL routing-chain story (aggregated across every task doc in the chain) plus a new **Team Flow ribbon** at the top summarising the journey, e.g. `video → content (reedit) → video → content (approved)`. Each timeline entry now carries a **team label chip** (deterministic per-team colour) so you see who did what in which team. Added `received` action meta ("Received by Team"). `HistoryTimeline` gained a `teamFlow` prop fed from `taskDetail.team_flow`.
- **Types:** `TaskHistoryEntry` gained `team_id`/`team_name`; new `TeamFlowStep`; `Task.team_flow?`.
- **Note:** History tab uses `AnimatePresence mode="wait"`; verified rendering via DOM (the CI/preview pane had a stalled rAF loop that blocks framer exit-animations + screenshots — not a code issue).

### FileUploader (shared) — direct-to-R2 uploads (2026-07-15)
- **File:** `components/shared/FileUploader.tsx` (+ `lib/directUpload.ts`)
- **What:** Reusable controlled uploader (`value: Attachment[]`, `onChange`). Uploads files **directly to Cloudflare R2** via backend-issued pre-signed PUT URLs — bytes never pass through the backend, so up to **1 GB** per file. Drag-and-drop + click, live per-file progress, image/video thumbnails, file-type icons, remove, and click-to-view (opens the public R2 URL in a new tab). `readOnly` mode = view-only gallery. `compact` variant for tight spaces.
- **Migration:** `useUploadAttachments` (useUpload.ts) and `useUploadMedia` (useSocial.ts) now call `uploadFilesDirect` — so **every existing caller** (chat, social, task modals) uploads direct-to-R2 with no code change. `TaskDetailModal` + `AddTaskModal` swapped their bespoke upload UIs for `<FileUploader>` (removed the old `AttachmentList` + upload buttons). No frontend path hits the backend multipart endpoints anymore.
- **Security:** R2 secret keys stay server-side; frontend `.env` holds only `NEXT_PUBLIC_R2_PUBLIC_URL` (public, for viewing).

### lib/datetime.ts — IST-locked date rendering (2026-07-15)
- **File:** `lib/datetime.ts`. mediaERP renders **every** date/time in IST regardless of the viewer's browser timezone.
- **Helpers:** `fmtDateTime`, `fmtDate`, `fmtTime`, `fmtDateTimeIST` (adds an "IST" suffix), `fmtDateOnly`, `istDateKey`, `istTodayKey`, `isSameIstDay`, `isBeforeIstToday`. All force `timeZone: "Asia/Kolkata"` — passed **last** so a caller can't override it.
- **Never** call `toLocaleString()/toLocaleDateString()/toLocaleTimeString()` directly — a bare call uses the browser's timezone. All 36 call sites across 25 files were migrated.
- **`fmtDateOnly` vs `fmtDateTime`:** `task.due_date` and `marketing_data.date` are **date-only** "YYYY-MM-DD" strings, not instants. `new Date("2026-06-17")` parses as UTC midnight and rendered as the *previous day* west of UTC — a real pre-existing bug. Use `fmtDateOnly` for those; never timezone-shift them.
- **`isTaskOverdue`** (types/project.ts) now compares IST date keys instead of `Date#setHours()` (which used the browser's timezone). Chat "Today/Yesterday" grouping likewise uses `istDateKey`.

### AssignCard (Leader Desk › Assign Work) — self-assign feedback (2026-07-15)
- **File:** `app/(dashboard)/leader/page.tsx`
- **Change:** `assign()` was fire-and-forget with **no toast** (unlike `ReeditCard`), so assigning gave zero feedback. Now awaits the mutation, shows `Assigned to you — "<task>"` when the leader assigns to themselves (via `useAuthStore().user.id`) or `Assigned to <name>` otherwise, and resets the dropdown. Combined with the backend `incoming` fix, a self-assigned task now visibly leaves the queue and lands on the leader's own board.

### PWA install — works on all devices/browsers (2026-07-15)
- **New `lib/pwa.ts`** — single source of truth for install support: `isStandalone()`, `isIOS()`, `detectPlatform()`, `getInstallGuide()`, `getInstallBlockers()`.
- **BUG FIXED — iPadOS never got a prompt.** Detection was `/iphone|ipad|ipod/i`, but **iPadOS 13+ reports a "Macintosh" UA**, so iPads fell into the Chromium branch where Safari never fires `beforeinstallprompt` → no prompt at all. Now `isIOS()` also matches `/macintosh/ && navigator.maxTouchPoints > 1` (a real Mac has 0, so it stays non-iOS).
- **New `components/InstallAppRow.tsx`** — an always-available "Install app" row in the sidebar footer (auto-hides once installed). Opens a dialog that fires the **native** prompt when Chromium offers one, otherwise shows exact per-browser steps (Android Chrome / Samsung / Firefox Android / desktop Chromium / macOS Safari / iOS) and honest blockers (e.g. "not served over HTTPS"). This is what makes install reachable on Firefox, Safari, and any session where `beforeinstallprompt` already fired or was dismissed.
- **GOTCHA (cost me a bug):** never wrap a `createPortal(...)` in `<AnimatePresence>` — it filters children through `isValidElement()`, which is **false** for a portal, so the dialog silently never renders. Render the portal directly; animate with the `motion.div` inside.
- `app/layout.tsx` — added legacy `apple-mobile-web-app-capable` (Next 16 only emits the modern `mobile-web-app-capable`; iOS < 16.4 needs the legacy tag or a home-screen launch opens in a browser tab).
- `PWARegister.tsx` — SW still prod-only by default, but now opt-in via `NEXT_PUBLIC_ENABLE_SW=1` so installability can be tested from a phone over an HTTPS tunnel without a prod build.

**Why a phone shows no prompt on the dev server (not a bug):** browsers only expose `navigator.serviceWorker` in a **secure context** — `https://` or `localhost`. A LAN URL like `http://192.168.x.x:3000` can never install. Use the HTTPS deploy or a tunnel.

### KanbanBoard + AddTaskModal — tasks disappearing / creation validation (2026-07-18)
- **BUG: board silently dropped tasks.** `useEffect(... if (!draggingRef.current) setLocalTasks(tasks))`
  skipped server updates that arrived MID-DRAG and never retried, so anything
  created during a drag stayed invisible. Now a missed sync is recorded
  (`pendingSyncRef`) and applied on drag end; the optimistic cross-column update
  re-bases onto the fresh server list instead of discarding it.
- **AddTaskModal validation:** Title, Team, Assigned To and Due Date are all
  required (marked `*`); Create is disabled with a tooltip naming what's missing.
  Mirrors the new server rules.
- **BUG found while adding that validation:** `canAssignOthers` only counted
  Super Admin, so a Coordinator/Admin was forced to self-assign — and the team
  dropdown only listed teams they *belong to*. A Coordinator would have been
  unable to create any task once a team+assignee became mandatory. Both now
  mirror the backend: elevated roles (Super Admin/Admin/Coordinator) can assign
  to anyone and pick any team. "No team (personal)" → "Select a team…".

### Projects — real pagination (2026-07-18)
- **`useTasksPaged(filters, page, limit)`** — flat paged list returning
  `{items, meta}`; `placeholderData` keeps the current page visible while the
  next one loads.
- **`useBoardColumns(filters, pageSize)`** — the Kanban board pages **each
  column independently** via `useQueries`. A flat page-1 slice is just the newest
  N tasks overall, which would fill the six columns unevenly; per-column paging
  is what Jira/Trello do. Each column reports `{total, loaded, hasMore}` and gets
  a "Load more · showing X of Y" button, so a column can never quietly hide work.
- Column badges and the page header now show **server totals**, not just what is
  loaded — the header previously under-reported whenever a list was capped.
- Table view gained a real pager ("Showing 1–25 of 86", Page N of M,
  Previous/Next). Verified paging 1→2 shows 26–50.
- `useTasks()` is left unchanged for any other callers.

### Projects — mobile scrolling & responsive board (2026-07-18)
- **BUG (why "tasks were missing" on phone): every card had `touch-action: none`.**
  `KanbanCard` set it unconditionally for dnd-kit. On a phone the cards cover the
  screen, so nearly every touch began on a card and the browser was told never to
  scroll from it — BOTH axes were dead, so off-screen tasks were unreachable and
  looked missing. The board's TouchSensor uses a *delay* activation constraint,
  so dnd-kit only needs `touch-action: none` **while dragging**; before that the
  user must be free to pan. Now `isDragging ? "none" : "manipulation"`.
  Measured: elements blocking touch **86 → 0**.
- **Responsive board.** A 6-column horizontal strip is unusable at 375px (it was
  1260px wide × 4000px tall). Columns now **stack vertically on phones** and
  become the classic side-by-side board from `md` up. No horizontal trap
  (`horizontalOverflow: false`).
- **Columns now have a definite max-height** (`max-h-[60vh]`,
  `md:max-h-[calc(100vh-23rem)]`). They previously relied on an `h-full` chain;
  when no ancestor had a definite height the columns grew to fit every card and
  the *whole page* scrolled instead of each column scrolling internally. This was
  a pre-existing desktop issue too — page overflow **3114px → 8px**.
- Added `overscroll-behavior: contain` so column scrolling doesn't chain to the
  page, and made the Table view horizontally scrollable on small screens.

### Same-origin API proxy — backend domain/IP no longer exposed to the browser (2026-07-19)
- **Problem:** the deployed app called the backend's real domain directly from
  the browser (visible in Network tab / DNS / TLS SNI), which let network
  filters block the app by that domain/IP. A rewrite existed in
  `next.config.ts` but never fired in production (`lib/axios.ts` only used it
  when `window.location.hostname === "localhost"`, which is never true on a
  real deployment), and 6 hooks + the chat WebSocket bypassed it entirely.
- **Fix:** every browser-originated call — REST and WebSocket — now goes to
  same-origin `/api/v1/...`. `next.config.ts`'s rewrite (server-side only, reads
  a new **server-only** `BACKEND_API_URL` env var) forwards it to the real
  backend. Touched: `lib/axios.ts`, `useChat.ts` (WS via `window.location.origin`),
  `useBilling/useClients/useEmailReports/useExport/useRules/useWhitelabel.ts`,
  `useReports.ts` (shared-report fetch).
- **BUG caught while verifying, not just theorized:** an initial version kept a
  `typeof window !== "undefined" ? "/api/v1" : process.env.NEXT_PUBLIC_API_URL`
  fallback "for SSR". Rebuilding and grepping `.next/static` showed the literal
  backend URL **still shipped in the JS bundle** — Next.js inlines a
  `NEXT_PUBLIC_*` var's value for every reference at build time, regardless of
  whether the branch is reachable at runtime. Fixed by removing the reference
  entirely (these are all `"use client"` hooks with no real SSR caller).
  Verified: `grep -r "127.0.0.1:8000" .next/static/` → **zero matches** after
  the fix (was present before).
- `BACKEND_API_URL` documented in `frontend/.env` and `docker-compose.yml`;
  `NEXT_PUBLIC_API_URL` kept only as a placeholder for a genuine future
  server-side caller, not read by any client code.

## Full functional test pass (post-proxy) — `useBoardColumns` dedup hardening

- **Investigated:** a task briefly appeared as two cards in two columns right
  after a status change (e.g. Pending + Started at once). Root-caused via live
  React fiber inspection: `useBoardColumns` (`hooks/useProjects.ts`) runs one
  independent React Query per status column; right after a mutation they
  invalidate and refetch asynchronously, so there's a window where the moved
  task is still cached under its old column while already present under the
  new one.
- **Fix:** when flattening the six column results into one `tasks` array,
  de-dupe by `id`, keeping whichever copy has the newer `updated_at`. Column
  badge counts are untouched (they already come from each query's own
  server-side `meta.total`, not the flattened array).
- Note: the specific *visible* duplicate-card symptom that triggered this
  investigation turned out to be a test-harness artifact (the automated
  browser tab reports `document.hidden = true`, which pauses
  `requestAnimationFrame` and freezes every framer-motion transition
  site-wide — confirmed harmless via React state inspection showing the
  correct single de-duped task the whole time). The dedup change is kept
  regardless as a real hardening against the underlying per-column cache race.

## Chat — messages disappearing (`hooks/useChat.ts`)

- **Reported:** chat messages (1:1 and group) would visibly vanish after
  being delivered, and could also seem to arrive late.
- **Root-caused:** `useChatMessages`/`useGroupMessages`/`useAdminMessages`
  all use `staleTime: 0`, so every remount (e.g. switching conversations,
  since the chat window is keyed by partner id) or window-focus event fires
  a fresh `GET /chat/messages/...`. The WebSocket handler pushes new
  messages straight into the same React Query cache entry. The REST
  query's `queryFn` had no merge logic — it just replaced the cached array
  outright. If a GET was issued (or refetched) around the same time a
  message arrived over the socket, its response reflected an older DB
  snapshot and silently wiped the WS-delivered message when it landed.
  Verified server-side: messages are never deleted (`mark_read` only flips
  a `read` flag) — this was purely a client-side cache-overwrite race, not
  data loss.
- **Fix:** added `mergeMessages()` — the REST `queryFn` now reads whatever
  is already cached via `qc.getQueryData(queryKey)` and unions it with the
  fresh response (keyed by `id`), instead of replacing wholesale. Any
  message already in the cache but absent from a stale REST snapshot
  survives. Still-`"sending"` optimistic placeholders are reconciled away
  by sender + content match once the confirmed (real-id) message shows up
  in a fresh response, so no duplicate appears while waiting for the WS
  echo. Applied to all three REST message queries (`useChatMessages`,
  `useGroupMessages`, `useAdminMessages`) — the group and admin-monitor
  variants poll on an interval (12s / 8s) on top of `staleTime: 0`, making
  them the most exposed to this race.
- Verified directly against the real backend + live React Query cache
  (not just code review): seeded a synthetic WS-pushed message into the
  cache, confirmed a plain overwrite (the old behavior) would have dropped
  it, and confirmed the new merge logic preserves it; also checked a
  normal empty-cache fresh load and the "sending"-placeholder-to-confirmed
  reconciliation path both behave correctly with no regression.

## Group chat — "Send report now" → daily/weekly/monthly dropdown

- **Feature:** the group-chat header's "Send report now" button (previously
  a single action that always posted the daily activity report) is now a
  small dropdown (`SendReportMenu` in `app/(dashboard)/chat/page.tsx`) with
  Daily / Weekly / Monthly options — same conditional-render popover
  pattern the file already uses for its @mention picker (no
  `AnimatePresence`, plain outside-click-to-close), not the animated
  `NotificationBell` style, to stay consistent with this file's own
  existing popovers.
- **Backend:** `POST /chat/groups/{id}/report/send-now` now takes an
  optional `period: "daily" | "weekly" | "monthly"` query param (FastAPI
  `Literal`, defaults to `"daily"` — the 21:00 IST scheduler's existing
  call site is untouched and keeps behaving exactly as before).
  `group_chat_service.py` gained `_period_range()`: "daily" is the IST
  calendar day (unchanged), "weekly"/"monthly" are rolling windows (last
  7 / 30 days from now, not calendar-aligned) so an on-demand report always
  reflects "recent activity" regardless of which day it's triggered.
  `build_daily_report_text` / `post_member_reports` / `post_daily_report`
  all take the new `period` param and adjust their header, date range, and
  "Done today/this week/this month" wording accordingly.
- **Frontend:** `useSendGroupReportNow` now takes `{ groupId, period }`
  instead of just `groupId`; added `REPORT_PERIOD_OPTIONS` (shared between
  the dropdown's labels and the mutation) and an exported `ReportPeriod`
  type in `hooks/useChat.ts`.
- Verified backend end-to-end via direct API calls (not just code
  review): posted daily/weekly/monthly reports against a real group and
  confirmed each produced the correct header, date range, and per-member
  wording; confirmed the no-`period` call still defaults to daily
  (backward-compatible with the cron); confirmed an invalid period value
  is rejected with 422. The dropdown itself couldn't be visually
  screenshotted in this session's browser pane — it's blocked by the same
  pre-existing `document.hidden`/frozen-`AnimatePresence` test-harness
  artifact documented earlier in this file, unrelated to this change.
- **Regression pass across every real group:** re-ran the daily/weekly/
  monthly send-now call against all 9 chat groups in the database (27 calls
  total, spanning 1-member up to 4-member teams) — every combination
  returned 200 with a valid posted message, no edge cases broke.

### Added — Export monthly report as PDF

- **Feature:** the dropdown gained a 4th, visually separated item, "Export
  monthly report (PDF)" (`FileText` icon), which downloads a PDF instead of
  posting to chat. New `useExportGroupReportPdf()` hook in `hooks/useChat.ts`
  — plain `fetch` + blob + synthetic `<a download>` click, same pattern as
  the existing campaign export in `hooks/useExport.ts`.
- **Backend:** new `GET /chat/groups/{id}/report/export/pdf` endpoint
  (`period` query param, default `"monthly"`, same
  `daily`/`weekly`/`monthly` `Literal`). Streams a `StreamingResponse` with
  `Content-Disposition: attachment`. Reuses the exact same access check as
  send-now via a new shared `_resolve_report_group()` helper (pure
  extraction, not a behavior change) — Super Admin/Admin/Coordinator or the
  team's leader only.
- `group_chat_service.py` gained `build_group_report_pdf(db, team, period)`
  — reportlab `SimpleDocTemplate`/`Table`, styled to match the existing
  campaign PDF export in `routers/export.py` (dark header row, zebra-striped
  body, `Helvetica`). One table row per team member with their completed
  and pending task counts + titles for the period.
- Verified against the live backend across all 9 groups × all 3 periods
  (27 calls, not just the monthly path the UI exposes): every response was
  a genuine PDF (`%PDF-` magic header), correct `application/pdf`
  content-type and filename, and PDF size scaled up with member count
  (single-member groups ~2.0–2.1 KB, the 4-member "design team" ~2.6 KB) —
  confirming the per-member table actually grows rather than silently
  truncating. The permission check itself wasn't independently re-tested
  with a live low-privilege account (no working demo credentials on hand
  for a non-leader employee at verification time) — confirmed instead by
  direct diff against the already-verified `send-now` check, since both
  endpoints now call the identical extracted `_resolve_report_group()`.

## BUG FOUND & FIXED: chat messages stuck in "sending" forever (2026-08-01)

User sent two messages in a group that stayed on the clock/"sending" icon
indefinitely. Confirmed via direct DB query that neither message ever
persisted — the WebSocket send genuinely never reached the server, this
wasn't a UI-only glitch.

**Root cause:** `useChatSocket`'s reconnect logic (`hooks/useChat.ts`) read
`localStorage.getItem("access_token")` fresh on every `connect()` call, but
had no way to get a *new* token if the stored one had expired — access
tokens live only 15 minutes (`access_token_expire_minutes: int = 15` in
`backend/app/config.py`), well within a normal chat session length. When the
server rejects an expired/invalid token it closes with code `4001`
(`backend/app/routers/chat.py`'s `chat_ws` handler), and the old client code
explicitly gave up on that code (`if (evt.code === 4001) return;` — no
retry). REST calls self-heal because axios's response interceptor refreshes
on 401, but nothing analogous existed for the WebSocket — once its reconnect
attempt hit an expired token, the whole chat channel was silently and
permanently dead until a full page reload, with zero visible error.

**Fix:**
- `lib/axios.ts`: extracted the interceptor's refresh logic into an exported,
  single-flight `refreshAccessToken()` function (concurrent callers share one
  in-flight refresh — important because the backend rotates the refresh
  token on every use, so two independent refresh calls racing on the same
  stored refresh_token would have the second one fail). The REST interceptor
  now just calls this function instead of duplicating the logic inline.
- `hooks/useChat.ts`: `useChatSocket`'s `ws.onclose` now calls
  `refreshAccessToken()` on a `4001` close and, if it succeeds, immediately
  calls `connect()` again with the new token — instead of giving up. A
  genuinely expired session (refresh also fails) still redirects to
  `/login` via the existing `_clearAuth()` path, so there's no infinite loop.

**Verified live, not just by code review:** logged into a real running
instance, captured the actual `wsRef` from the mounted `useChatSocket` hook
via its React fiber, corrupted the stored access token to garbage (keeping
the refresh token valid), and force-closed the live socket with code `4001`
— exactly reproducing what the server sends on an expired token. Confirmed:
a brand-new WebSocket connection opened automatically carrying a genuinely
different, valid token (proving `refreshAccessToken()` ran and
`connect()` retried), and a message sent immediately afterward was found
persisted in the real `messages` collection — the full recovery path works
end-to-end, not just "the socket reconnects."


### SignedImg (shared) — self-healing images for the private R2 bucket (2026-09-08)
- **File:** `components/shared/SignedImg.tsx`
- **Why:** attachment URLs are now short-lived signed GETs (1 h). A tab left open past the TTL holds expired URLs, so images 403 on load.
- **What:** an `<img>` that, on load failure, calls `onExpired()` **once per src** to refetch the query that supplied the URL, then re-renders with the fresh one. A second failure for the same src renders the optional `fallback` instead — a genuinely missing object 404s forever and must not retry in a loop.
- **Wired into:** `chat/page.tsx` `MessageExtras` (invalidates `["chat"]`) and `FileUploader` thumbnails (invalidates `["projects"]` + `["chat"]`, falling back to the file-type icon + filename).
- **Also:** removed the dead `NEXT_PUBLIC_R2_PUBLIC_URL` from `frontend/.env` — it was set but never read by any client code, and the bucket is private now.


### "Ad not performing" — FlagAdModal, FlagStatusStrip, FlagNumbers, AdFlagCard (2026-10-08)
- **Files:** `components/ad-reports/FlagAdModal.tsx`, `FlagStatusStrip.tsx`, `FlagNumbers.tsx`, `components/leader/AdFlagCard.tsx`, `hooks/useAdFlags.ts`, `types/adFlag.ts` (all new); `app/(dashboard)/ad-reports/page.tsx` (button, strip, rail chip), `app/(dashboard)/leader/page.tsx` (tab **Ads to redo**), notification bell / settings / browser alert types.
- **Button:** red outline "⚠ Ad not performing" at the far right of the ad's action row (`sm:ml-auto`; full width on phones) — the left buttons keep the report running, this one escalates the ad. Shown to whoever can work on the ad, ads only, hidden while a flag is open.
- **FlagAdModal** (`ModalShell`): cover + last-7-days numbers, **Send to** (`<select>` with team `<optgroup>`s, pre-selected default), reason chips (`aria-pressed`), optional note; needs a reason or a note; "Send to <first name>".
- **FlagStatusStrip:** red while open ("sent to X (team) · date · Waiting / Being recreated", Withdraw for the sender), green "Recreated…", amber "couldn't recreate…" for 14 days.
- **FlagNumbers:** `snap` + `compact` (rows — never truncates money) / tiles; same formatting and better/worse colouring as the Performance overview.
- **AdFlagCard:** media on top (image/video, "+N more", opens `MediaLightbox` with every creative), reasons, note, numbers, sender, actions Start recreating → Mark recreated (optional note) / Decline (reason required), "Report" link only when the viewer can open it.
- **Leader Desk:** `?tab=ads&flag=<id>` read via `useSearchParams` in a Suspense'd watcher (in-app navigation renders before `window.location` updates); highlighted card scrolled into view; "Recently closed" `<details>` opens when it holds the highlighted flag. The task filters are hidden on this tab.
- **2026-10-08 fix:** Ads to redo has views **Sent to me / Sent by me / All** (`aria-pressed` segmented control, opens on the view with recent items; badge = open "sent to me"); `AdFlagCard` shows "With <leader> · team" for non-recipients and a confirmed Withdraw for the sender (leader buttons only for the recipient, or an admin who isn't the sender); `FlagStatusStrip` Withdraw confirms; `FlagAdModal` shows email for same-name leaders. `PWARegister`: in dev, unregisters a leftover `/sw.js` + `mediaerp-*` caches and reloads once.
- **Query keys** under `["ad-reports", "flags"]` so Ad Reports refreshes (incl. re-signing expired creative links) refresh flags too.

### OverviewPdfButton + useDownloadOverviewPdf (2026-10-08)
- **Files:** `components/dashboard/OverviewPdfButton.tsx` (new), `hooks/useOverviewPdf.ts` (new), `app/(dashboard)/dashboard/page.tsx`.
- **Props:** `{ params: OverviewPdfParams /* member_id, date_filter, date_from, date_to, range_name */; disabled?: boolean; className?: string }`.
- **What:** "⬇ PDF" at the end of the Overview header's filter row — **[📅 range] [👤 member] [⬇ PDF]**: the filters pick what you see, this takes it with you. Quiet secondary button (outline, pickers' radius, stretches to the row height); "Preparing…" + spinner while busy; disabled until the Overview has loaded; full-width on phones.
- **Data:** the page passes exactly the filters it used for its own request (`rangeToFilters(range)` + the resolved member), and the server builds the PDF from the same query (`query_scoped_tasks`), so the PDF always equals the screen. Download goes through the shared axios client (`responseType: "blob"`, token refresh included); the filename comes from `Content-Disposition`.

### DateRangeFilter + Overview date filter (2026-10-08)
- **Files:** `components/dashboard/DateRangeFilter.tsx` (new), `lib/overviewRange.ts` (new), `app/(dashboard)/dashboard/page.tsx`.
- **Props:** `{ value: OverviewRange; onChange: (r) => void; today: string /* IST YYYY-MM-DD */; className?: string }`.
- **What:** a button in the Overview header's right corner, beside the MemberScopePicker (when, then who). Neutral on "All time"; primary-tinted with an × (Clear dates) when a range is on. Popover: All time, Today, Yesterday, Last 7 days, This week, This month, Last month, This year, then a Custom range (From / To + Apply; To ≥ From, nothing after today). Closes on outside click / Escape. Full width and stacked on mobile.
- **Counting rule:** tasks **created** in the period, the same as the Projects date filter. `rangeToFilters()` maps presets to the existing `GET /projects` params (`today/this_week/this_month/this_year` server presets; the rest become an IST `custom` from–to). "All time" adds nothing, so the default request is unchanged. Combines with `member_id`.
- **URL state:** `?range=this_month` or `?from=YYYY-MM-DD&to=YYYY-MM-DD`, next to `?member=` — read by a lazy initializer, written with `replaceState`. Invalid values fall back to All time.
- **Page copy:** subtitle row "Tasks created **{phrase}** · Clear dates" (its own row under "Viewing X's overview"); empty state "No tasks were created {phrase} for {Name}." The Overview's "today" is now the IST day (it was UTC).
- **QA hardening (2026-10-08):** `parseRange()` accepts only real days (rejects 2026-02-31 / 2026-13-01 — the first used to show all-time numbers under a date heading, the second crashed the page), From ≤ To, nothing after today (a later To is clamped); a bad link is tidied in the address bar. A `UrlWatcher` (useSearchParams in its own Suspense, so `/dashboard` stays static) re-reads `?member=`/dates when the URL changes under the mounted page, so the sidebar "Overview" link resets the filters and the page never disagrees with the address bar. The header wraps (`flex-wrap` + `min-w-[20rem]` on the greeting) instead of squeezing the greeting, and the panel opens from the left when the button sits at the left edge.
- **Known framework quirk (Next 16.2.4):** after a *hard load* of `/dashboard?…`, Next's route cache stores that URL as the canonical URL for `/dashboard` (key = pathname) for its static stale time (5 min), so `<Link href="/dashboard">` lands on the same filtered link during that window. Pre-existing for `?member=`; page and URL stay consistent.

### MemberScopePicker + Overview member filter (2026-10-07)
- **Files:** `components/dashboard/MemberScopePicker.tsx` (new), `app/(dashboard)/dashboard/page.tsx`.
- **What:** single-select, searchable, team-grouped picker. "My overview" first, then each team (colour dot + count) with members (initials, designation, a "Lead" badge). Search matches name, designation **or team name**. WAI-ARIA combobox: focus starts in the search box, arrow keys move the highlight, Enter picks, Escape closes, and focus returns to the trigger.
- **Placement:** right side of the page header on the greeting's row — it scopes the whole page, so it sits above everything it affects, and sharing the row keeps the KPI cards above the fold. On mobile it stacks under the greeting at full width. When someone else is selected the trigger turns primary-tinted with their initials, and the subtitle reads "Viewing {Name}'s overview · {teams} · Back to mine", so their numbers are never mistaken for your own.
- **Who sees it — mirrors the backend exactly:** elevated roles (all teams) and the **"Team Leader" role** (teams where `my_role === "leader"`). An Employee-*role* user who leads a team by membership does NOT get it: the backend gives them "own" visibility and ignores `member_id`, so offering it would show "Viewing Amith" over their own tasks. Everyone else sees zero change.
- **URL state:** `?member=<id>` — refresh-, share- and back-safe. Read once via a lazy `useState` initializer (the Projects page's pattern — avoids the `useSearchParams` Suspense requirement), written with `window.history.replaceState` (Next 16 syncs native history with its router; replace, not push, so Back leaves the page). A hand-edited id not in your list silently falls back to your own overview and is stripped from the URL.
- **No stale numbers:** while a `?member=` is unresolved the page shows loading, never one person's figures under another's name (deliberately no `keepPreviousData`).
- **Avatars are initials on purpose:** member `avatar` values may be legacy public R2 URLs, which the private bucket answers with 401.
- **Verified in the browser** with a temporary seeded leader/members/outsider (since removed): correct people offered (outsider and self excluded); each member's KPIs, pipeline and lists exact; keyboard selection; refresh persistence; tampered URL → falls back; "Back to mine"; an Employee sees no picker and a crafted URL can't hang the page; mobile stacks full-width. Note: the preview pane throttles `requestAnimationFrame` (~2 frames/500 ms), which makes open popovers look see-through in its screenshots — the DOM is opaque and topmost (verified with `elementFromPoint`).
- **DEFECT FOUND IN QA + FIXED (same day):** the first version listed each person once, under the first team they appeared in. That made a team **vanish from the picker** whenever all its members also belonged to a team listed earlier — reproduced as a Super Admin, where "QA Video Team" disappeared entirely — and team-name search could not find people deduped into another group. It also hid it from my own test: a "design" search passed only because a member's job title was "Motion Designer". Fix: list each person under **every** team they belong to. Team headers make a repeat obviously the same person; both rows show as selected; option ids stay unique.
- **QA campaign (2026-10-07):** 43/43 live-API cases (per-persona scoping, cross-team symmetry, hostile input incl. NoSQL-injection-shaped/5,000-char/emoji ids, forged JWT/API key, ~11 ms p50) + browser tests across Team Leader, Super Admin, impersonation, an Employee-role team lead, and an Employee: picker contents, search, full keyboard model, per-member data accuracy, empty state, rapid switching (0 name/number mismatches), refresh, Back behaviour, tampered URLs, light + dark WCAG AA contrast, mobile layout, no cache bleed across impersonation (`qc.clear()` on both switches), and a regression sweep of Projects, Media Schedule, Leader Desk and the Teams member report.

### Repeating tasks + multiple assignees (2026-10-07)
- **New files:** `components/projects/RepeatField.tsx` (Once/Daily/Weekly/Monthly segmented radiogroup, count or "until I stop it", "Each copy due" select, live `aria-live` summary such as "Every Wednesday · 5 times / 7 Oct → 4 Nov / 2 people × 5 = 10 tasks"), `RepeatBadge.tsx` ("↻ 3/5" on Kanban cards), `RecurrenceStrip.tsx` (detail-modal strip with a "Manage" link), `RecurringDrawer.tsx` (side drawer: pause/resume, two-step stop, edit future copies), `hooks/useRecurring.ts`, `lib/recurrence.ts` (client mirror of the backend date engine).
- **AddTaskModal:** the assignee field now takes several people (chips + "Add more"; the first person still drives the existing approver/verifier logic). Repeat is shown only to elevated roles or the leader of the selected team; a leader who hasn't picked one of their teams gets a hint instead. Submit routing: 1 person + Once → the original `POST /projects` (unchanged); several people or a repeat → `useCreateTaskBatch` (`POST /projects/batch`). Button label: "Create Task" / "Create N tasks" / "Start repeating". Due date hides while repeating (each copy gets its own).
- **Projects page:** a "Repeating" button with an active-series count (elevated roles or leaders only) opens the drawer; `?repeating=<id>` deep-links to a highlighted series (lazy `useState` read + `replaceState`, same pattern as the Overview filter). KanbanCard row 2 wraps badges and hides when empty; TaskDetailModal shows the strip.
- **DEFECT FOUND IN QA + FIXED:** at 375 px the new button pushed "Add Task" off-screen. Fix: the button is icon-only below `sm` (keeps `aria-label="Repeating tasks"`), and the button row wraps. Verified at 375 px (Add Task fully on screen, no page overflow) and 1024 px (one row, full label).
- **Verified in the browser** (seeded leader/members/employee, since removed): single create unchanged; multi-assign creates 3 tasks; weekly ×5 for 2 people; drawer pause/resume/edit; the live scheduler created copy 2 with the edited title/priority/due while copy 1 stayed untouched; badge tooltip, strip and deep link; an Employee sees no repeat controls and the API returns 403 for a crafted request.
- **QA pass 2 — FIX: RepeatField count box.** Clearing the box snapped it to 1 at once, so backspacing and typing "3" gave 13. It now keeps what you type while focused (a `draft`), commits each valid number (clamped), caps at the frequency's max as you type, and restores the last valid count on blur. Verified: clear → "", type 3 → 3, 999 → 365, blank + Tab → last valid. `useRecurringSeries` no longer retries a 404 (the series isn't shared with that viewer; the strip shows the copy number only).
- **QA pass 2 — verified OK:** a team switch resets Repeat to Once; a Daily count above the weekly/monthly cap is clamped when switching (200 → 36 sent); weekly/monthly/until-stopped summaries; edit (blank title disables Save; edits leave existing copies alone); two-step Stop with Cancel; bad `?repeating=` id; Escape clears the deep link; strip for creator (Manage) vs assignee (no Manage); Employee: no Repeat, no Repeating button; Employee-role team lead: Repeat only in the team she leads; light mode; 375 px.

### Ad Reports — Meta "Performance overview", entered daily (2026-10-07)
- **New:** `app/(dashboard)/ad-reports/page.tsx` (rail of report cards with status chip + sparkline · Meta-style overview · day-by-day table · leader strip "N of M up to date · Missing … [Remind]"); `components/ad-reports/` — `PerformanceOverview` (KPI tiles switch the chart like Meta; Day/Week/Month; 7/14/30/This month/Lifetime/Custom; gaps + hollow "Not reported" markers; ✎ corrected markers; tooltip), `EntryModal` (missing-day chips, "Save & next day", previous values beside each box, Enter → next box / save, 5× typo guard → "Save anyway", campaign-off, 7-day lock), `ReportFormModal` (create/edit; teams you lead; owner + backup via `UserPicker`; extras; reminder times), `ModalShell`, `StatusChip`, `Sparkline`, `AdReportsBanner`; `hooks/useAdReports.ts` (keys under `["ad-reports"]`); `lib/adReports.ts` (`formatINR` with Indian grouping from paise, `compactIN` K/L/Cr axis, metric meta); `types/adReport.ts`.
- **Touch points (additive):** Sidebar item "Ad Reports" under Media Schedule, shown when `/ad-reports/today.visible`, badge = my due count; Overview banner between greeting and KPIs (only when something of yours is due; dismissible for the day; hidden while viewing a member); bell icons + deep link to `?report=…&entry=1`; desktop-alert types; settings email-pref rows; notification type union.
- **URL:** `?report=` / `&entry=1`, written with `replaceState`; the page reads `useSearchParams` (inside `<Suspense>`) so a reminder clicked while already on the page still switches report and opens the form.
- **DEFECTS FOUND IN QA + FIXED:** (1) at 1024 px the side-by-side layout clipped KPI values → rail moves to `xl`, tile type scales; (2) "0%" shown red → |Δ| < 0.5% reads "No change"; (3) "+319% vs previous" when the previous period was mostly before the report existed → backend compares only fully covered periods; (4) phones hid "Amount spent" in a scroll row → 2-column grid; (5) a newly created report wasn't selected (fallback ran before the list refetched) → fallback waits for `isFetching`; (6) extra-metric chips were named by their tooltip for screen readers → hint moved to visible text.
- **Verified in the browser** (QA leader / owner / backup / admin / outsider / other leader): totals match the Meta screenshot exactly (83 leads · ₹16,200.32 · ₹195.18); bell reminder → form opens on the oldest missing day; typo guard; Save & next; campaign-off zero vs missing gap; status chips missing → due → updated; badge + banner clear when done; correction ✎ in table + chart; 7-day Edit links; pause/resume/edit/two-step end; Escape; 375 px; light + dark; fresh-tab regression of Overview, Ad Reports, Settings, Projects — 0 console errors, all API 200.
- **QA pass 2 — FIXES:** (1) `ModalShell` had no focus trap: Tab walked out of the entry form onto the page behind it, and focus wasn't returned on close. Now Tab/Shift+Tab cycle inside the dialog and focus goes back to the opener (verified with 25 Tabs each way). (2) The Overview banner's "hide for today" was stored per browser, so on a shared computer one person hiding it hid it for the next; the key now includes the user id and is read at render.
- **Verified:** Omar (newly assigned) gets the sidebar item, badge and banner; Kofi's leader strip + Remind (second click within the hour refused with a clear message); Week / Month / Lifetime views; an empty report's tiles and table.

### Ad Reports — creatives showcase + hero layout (2026-10-07)
- **New `components/ad-reports/CreativeShowcase.tsx`:** square stage (4:3 on phones) showing the selected creative whole (`object-contain` — 1:1, 4:5, 9:16 ads aren't cropped); video with play badge; PDF tile; "Cover" + "n/m" badges; hover/focus toolbar (always visible on touch): make cover · remove (inline confirm) · full screen (`MediaLightbox`); thumbnail strip + "+" tile; drag-and-drop or click to upload (multi-file, progress overlay, 12-file cap, type filter) via `uploadFilesDirect(prefix "ad-creatives")` then `useAddCreative`. `CreativeThumb` (cover on rail cards). `SignedVideo` asks for a fresh signed URL once per URL, then shows a fallback — no refetch loop on an unplayable file.
- **Page:** report header → **hero card**: creative on the left, Meta tag + status, large name, a Team / Updated by / Runs / Reminders fact grid, missing-days notice, actions with "Update numbers" first. Rail cards show the cover thumbnail so a campaign is recognised by its ad.
- **`lib/directUpload.ts` (shared — tasks, chat, ads):** PUTs now retry up to 4 times (0.8 s / 2 s / 4.5 s) on 5xx / 408 / 429 / network errors. Found in QA: R2 intermittently answered `503 ServiceUnavailable` (1 of 3 direct backend PUTs, then 12/12 fine) and every upload in the app failed on the first one. Verified by forcing two 503s in the browser: 3 attempts, upload succeeded.
- **Verified in the browser:** image (1:1, 1 MB) and 4:5 portrait, PDF, unplayable video (fallback shown, refetches bounded), set cover (rail thumb follows), remove with confirm, full-screen viewer with 4 items, 375 px layout, no overflow. Reach tile hint explains summed daily reach.

### Repeat field — weekday picker + day-of-month calendar (2026-10-07)
- **Weekly:** "On" row of Mon–Sun chips (radiogroup, full day names for screen readers, a dot under today); defaults to today. **Monthly:** "On day" 7-column 1–31 calendar grid (selected filled, today outlined); 29–31 shows the shorter-months note.
- Summary is computed from the real first day (`lib/recurrence.firstDate`, mirrors the server): "Every Friday · 9 Oct → 6 Nov · The first task is created on Fri 9 Oct" / "Every month on the 31st · 31 Oct → 28 Feb · next 30 Nov, 31 Dec". `occurrenceDate`, `describePattern`, `needsMonthEndNote` take the chosen month day; the Repeating drawer labels use the stored `month_day`.
- Verified in the browser: defaults, Friday, 31st, 1st (rolls to next month), a real weekly-Friday series created with no task today and the drawer showing "next: Fri 9 Oct · 0/5".
- **QA pass (same day):** client file filter now mirrors the server (no SVG; explicit image types in `accept`) so a refused file is never uploaded; day-picker buttons are taller on phones (weekday ~44 px, calendar 40 px). Verified: wrong types stopped before upload, 12-file cap ("adding the first 9" → 12, "+" hidden → back at 11), removing the cover promotes the next one (card thumbnail follows), viewer arrows 1→2→3→2 of 11 with the strip in sync, owner sees Remove only on their own uploads, weekday/date choices kept across Weekly↔Monthly, other team → Repeat hidden → back = Once, keyboard (Tab/Space/Enter, Enter doesn't submit), 375 px, delta tiles show the corrected CPM/CPC, production build passes, fresh-tab regression clean.

### Ad accounts → ads (2026-10-07)
- **New report:** a "What are you tracking?" card switch — *Ad / campaign* (daily numbers) or *Ad account* (groups ads, adds them up). Ad → existing form + an **Account** select (*None* first; only open accounts of the chosen team; clears itself if the team changes). Account → name, team, platform, ad-account ID (mono) and a note that nothing is typed for it. Editing hides the switch; an ad's Edit can move it between accounts or to none. Toast says "Ad account created" for accounts.
- **Rail = tree:** account row (blue gradient building tile, name, "N ads · M missing", fold chevron) → its ad cards indented on a guide line → "Ads without an account". Phones: the report dropdown uses `<optgroup>` per account with an "— all ads" entry.
- **`components/ad-reports/AccountView.tsx`:** hero with a soft brand wash, "Ad account" tag + roll-up status, Team · Ad account ID · Ads (active/missing) · Since, actions **+ Add ad** (opens the form preset to this account), Edit, two-step End; empty state with "Add an ad"; the Performance overview of the sum with **Ads in this account** under the chart (via the new `PerformanceOverview.renderBelow` slot, same range): thumbnail, owners, today status, leads, spent, per lead, share-of-spend bar, sorted by spend, rows open the ad (keyboard: Enter/Space).
- **Ad hero:** an "in *Account*" chip — a button back to the account for leaders, plain text for owners.
- Verified in the browser: create account, move "delta" in, "+ Add ad" preset, tree, roll-up tiles + breakdown (68% / 32%), row → ad → chip → account, mobile groups; production build passes.

### Saved tasks — Task name suggestions (2026-10-08)
- **`components/projects/TaskNameCombobox.tsx`** replaces the Add Task title input (ARIA combobox). Opens on click / typing / ↓ — **not** when the form auto-focuses it; nothing highlighted until ↓ (Enter keeps its job); ↑↓ Enter/Tab pick, Esc closes only the list; never forces a choice; hidden when there's nothing to suggest. Rows: ★ saved (team chip when no team is picked, "+ details"), 🏢 company, 🕘 recent ("used N×", ☆ to save for leaders); matched letters bold. Footer "★ Save “…” for <team>" — name only, one click, no dialog.
- **Matching (`lib/taskPresets.ts`):** whole name starts with it → every typed word starts a word ("a" → Apple, "Monthly **a**d report"; "mon ad") → plain contains only from 3 letters (so "a" doesn't match "Banana"); then saved > company > recent, most used; duplicates across lists collapse.
- **Picking fills only what's empty:** name always; description if empty; priority if still the default; team if none chosen (and only teams you can pick). "Filled description, priority & team from the saved task · Undo" restores everything but the name.
- **`components/projects/SavedTasksManager.tsx`** in Team → Settings (team list) and Settings → **Saved tasks** (admin roles, company list): quick add (name only; "More options" folds description/priority away), "Often used in this team — save with one click" chips, search over 8 rows, inline edit, two-step remove, friendly empty state.
- Verified in the browser as Lena: add/duplicate/chip save, suggestions on click, "a"/"tr"/"zzz", pick + fill + Undo, typed values kept on a second pick, keyboard, inline save then instantly suggested, 375 px. Live API: employee sees but can't save; another team's leader sees none of Video's saved tasks; company list visible to all.

### Projects — Team view / My work switch (2026-10-09)
- **File:** `app/(dashboard)/projects/page.tsx`.
- **What:** a segmented radiogroup at the start of the filter card — **Team view** (admins: **All tasks**) | **My work** — shown only to people whose board shows more than their own tasks (admin roles, anyone leading a team). My work = `scope=assigned_to_me` (what an employee sees); the team / member selectors and quick chips step aside; the redundant "Assigned to me" chip is hidden while the switch is shown.
- **State:** remembered per user (`localStorage projects:work-mode:<uid>`) and `?view=mine`; applied on top of the team filters (`effective`), so returning to Team view restores team / member / chip; Reset in My work clears only the visible filters.
- **QA fixes (2026-10-09):** the page now follows the address bar (`UrlParams` — useSearchParams in its own Suspense): "Open Task Board" (`?team_id=`) opened on the remembered My work and, separately, never applied the team at all on an in-app jump (pre-existing — the URL was read before it changed); a task's Repeating "Manage" link (`?repeating=`, same page) didn't open the drawer. A team link now opens that team's Team view (applied once per team id, so it never fights later choices; `?view=` wins). No Team-view flash while teams load when My work is remembered. The switch is a `role="group"` of `aria-pressed` toggle buttons (was a radiogroup without arrow keys).
- **Saved tasks (TaskNameCombobox):** "already saved" is checked per team — a name saved for one team can still be saved for another; a company name covers everyone.

### Ad Reports — team-first people picking, several teams, delete + undo (2026-10-09)
- **`components/ad-reports/ReportFormModal.tsx`** (rewritten, same props): Name → **Teams** (chips; first = "main", ★ makes another main; "+ Add team" lists teams you lead / all for admins; teams you don't lead are 🔒 in Edit; your last own team and the last team can't be removed in Edit) → Account (accounts sharing a team) → **People** (avatar chips, first = 👑 owner, "Make owner"; picker = members of the chosen teams via `useTeams().members`, "Show everyone" widens to the directory; stays open for several picks, Done / "+ Add people"; "· other team" on people outside the teams; 6 max) → dates / metrics / reminders. Accounts: "Who looks after it — optional". "+ Add ad" on an account pre-fills its teams (that you lead) and people; picking an account with nobody chosen copies its people.
- **`components/ad-reports/DeleteReportDialog.tsx`** (new): danger-tone `ModalShell`; what goes (days of numbers via `useAdEntries`, creatives, who loses it / ads inside, people); account → radio "Keep its N ads" (default) / "Delete the N ads too"; note when an open "Ad not performing" request stays with the media team.
- **Trash button** (icon-only, quiet until hover-red) at the end of the action row on `ReportHero` (page.tsx) and `AccountHero` (AccountView.tsx), for managers — ended reports too.
- **`hooks/useAdReports.ts` `useDeleteAdReport`**: removes the report(s) from the cached lists at once (no flash), refreshes everything except the gone report's series/entries (would 404), toast with **Undo** (10 s) → `POST /deleted/{batch}/restore`; restore's `onSuccess` awaits the refetch and the reselect uses `mutateAsync().then`, so it works even if the dialog unmounted.
- **`components/ad-reports/TeamChips.tsx`** (new) for the facts row ("Teams" when >1); `lib/adReports.ts` `teamsLabel` ("Media +1", rail) and `peopleLabel` ("Asha (owner), Mira"). `ModalShell` gains `tone="danger"`. Leader Desk flag card shows "Report deleted" instead of the Report link (`AdFlag.report_deleted`).
- **Fix (2026-10-09):** "+ Add team" is now an in-form `TeamList` (was a hidden native `<select>` whose options rendered white-on-white in dark mode); `app/globals.css` sets `color-scheme` per theme and themes `<option>` colours app-wide.

### Tasks — "Project" picker (2026-10-09)
- **`components/projects/ProjectPicker.tsx`** (new): field-style button ("No project" / platform badge + name + × to clear) → in-form list (search, the 3 groups split by dividers in the given order, Meta/Google/Snap badges, ↑ ↓ Enter Esc; Enter never submits the form). `PlatformBadge` exported. Data: `hooks/useTaskProjects.ts` (`GET /task-projects`, cached 10 min).
- **AddTaskModal:** "Project · Optional" right after Description; sent as `project_id` on single and batch/repeating creates.
- **TaskDetailModal:** "Project" row after Description — picker that saves on pick (reverts if refused) for editors, a chip when read-only.
- **KanbanCard:** muted one-line project label under the title, only when the task has one.
- **(2026-10-09)** Board card + table: the delete (trash) icon only shows for who may delete — admin roles, the task's creator, its team's leaders (`hooks/useCanDeleteTask.ts`, mirrors `_can_delete_task`).

### Projects — manage the list (2026-10-09)
- **`components/projects/ProjectsManager.tsx`** (new): add (name + Meta/Google/Snapchat/Other chips, Enter), list grouped like the picker with task counts, hover actions ↑ ↓ (within a group) ✎ (inline: name, platform, group incl. a new one; Enter/Esc) 🗑 (inline confirm, "used on N tasks — they keep the name"), collapsible **Deleted (n)** with Restore, search past 8. No `<form>` (it can sit over Add Task — a portal'd submit would reach that form). `ProjectsManagerModal` = the same in a window (z-60) over Add Task.
- **Where:** Settings → **Projects** tab (admin roles) and **Manage projects** at the bottom of the picker list (admin roles) — opens the window, the half-filled task is kept, the picker refreshes at once.
- `components/projects/PlatformBadge.tsx` (moved out of ProjectPicker; adds "Other"); hooks in `hooks/useTaskProjects.ts` (useManagedProjects, useCreateProject, useUpdateProject, useReorderProjects).
