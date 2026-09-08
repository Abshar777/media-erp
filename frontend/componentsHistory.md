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
