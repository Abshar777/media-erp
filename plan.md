# plan.md — Manage the Project list (add · rename · delete · order)

> **Status: DONE (2026-10-09)** — backend 208 passed (6 new manage tests) / same 8 old failures; live API 16/16 across roles; type check clean; production build passes. Browser (QA Super Admin): Settings → Projects add (Enter), inline edit name + platform, ↑ within group, delete with confirm, Restore; Add Task → picker → Manage projects opens over the form, Enter adds without submitting the task, half-filled title kept, picker shows the new project at once. Test projects removed; list back to the original 12.

## The idea
The Project picker's 12 names were seeded by us. Now the list is managed in the app: **add** a project, **edit** its name (and platform), **delete** one, and put them in order.

## Decisions (senior-dev view)
- **Who:** admin roles (Super Admin / Admin / Coordinator) — the list is company-wide and a delete affects everyone, same rule as the company Saved tasks. Everyone else just picks from it. The server enforces it (403).
- **Delete = archive, with Restore.** Tasks keep pointing at the project, so it is hidden from the picker, never erased: old tasks still show their project, and an accidental delete is one click to undo. The row shows how many tasks use it, so the admin knows what they're touching. (A seeded project that is archived stays archived after a restart — the seed only adds missing keys.)
- **Rename fixes it everywhere.** A rename is a correction of the same ad account, so tasks already tagged with it show the new name too (their stored `project_name` is updated in the same request).
- **No duplicates:** two active projects can't share a name (case-insensitive) → 409 with a clear message.
- **Order:** ↑ ↓ move a project within the list; a project can be put in another group (the dividers in the picker), including a new group at the end.
- **Platforms:** Meta, Google, Snapchat, plus **Other** (neutral badge) for a channel that isn't one of those (TikTok, LinkedIn …).
- **API:** `GET /task-projects?manage=1` (admins: archived too + usage counts), `POST /task-projects`, `PATCH /task-projects/{id}` (name / platform / group / active), `DELETE /task-projects/{id}` (archive), `PUT /task-projects/order` (ids in display order).

## UI (designer pass)
- **Where:** Settings → new **Projects** tab (admin roles), next to "Saved tasks". And a shortcut at the bottom of the picker list — **⚙ Manage projects** (admins only) — that opens the same manager in a window *on top of* Add Task, so a half-filled task is never lost; the picker updates as soon as it closes.
- **Manager layout:** an "Add a project" row on top (name · platform chips · Add); then the list grouped like the picker. Each row: platform badge · name · "12 tasks" · on hover ↑ ↓ ✎ 🗑. ✎ turns the row into an inline editor (name, platform, group) with Save / Cancel (Enter / Esc). 🗑 asks inline: "Delete? Used on 12 tasks — they keep the name." with Cancel / Delete. A collapsed **Deleted (n)** section at the bottom lists archived projects with **Restore**.
- Search box when the list grows; empty state when there are none.

## Proving nothing breaks
Backend tests (throwaway DB): admin-only rules (each role), add / duplicate / rename propagates to tasks / platform & group / archive hides from the picker but old tasks keep it / restore / reorder / seed doesn't undo an archive or rename; picker list unchanged for everyone. Full suite, type check, production build, browser: add, rename, move, delete, restore — from Settings and from the picker.

---
---

# plan.md — Tasks: optional "Project" picker (ad accounts)

> **Status: DONE (2026-10-09)** — backend 198 passed (7 new) / the same 8 old failures; type check clean; production build passes. Browser (QA Super Admin): picker after Description, all 12 in order with group dividers + platform badges, search + Enter picks without submitting; task created with a project (stored id + name); board card shows it; detail view changes it (Snapchat) and clears it. QA test task, its notifications and chat message removed.

## The idea
Add Task gets an optional **Project** field right after Description: which ad account the work is for. A task can still be created without one.
The 12 projects, in the order given (three groups):
1. DELTA DIGITAL DXB (META ADS) · DELTA TRADING BLR (META ADS) · DELTA TRADING DXB (GOOGLE ADS) · DELTA TRADING IND (GOOGLE ADS) · DELTA TRADING (Snapchat) · DELTA TRADING DXB - BACKUP (META ADS)
2. DELTA DIGITAL BLR (META ADS) · DELTA TRADING DXB (META ADS) (Formerly DRAW) · DELTA JURA (META ADS) · DELTA AI (META ADS)
3. DELTA TRADING DXB (META ADS) - SHOHAIB · DELTA TRADING DXB (META ADS) - ABHIN

## Decisions (senior-dev view)
- **The list lives in the database** (`task_projects`, seeded with these 12 at startup, idempotently), not hard-coded in the page — so a name can be fixed or a project added without a release, and tasks keep a stable id. Each has a name, platform (Meta / Google / Snapchat), group and order.
- **A task stores `project_id` + `project_name`** (the name as it was, so old tasks still read right if a project is renamed). Absent on tasks without a project — existing tasks are untouched.
- **One rule, every path:** the check lives in `task_factory.raise_task`, so single tasks, "several people" and repeating tasks all accept it the same way; repeating tasks pass it to every copy. An unknown project id → 422.
- **Editable later:** the task's detail view shows the project and (for whoever can edit the task) lets it be changed or cleared.
- **Not in this change:** a filter by project on the board and a screen to manage the list (both easy follow-ups on the same data).

## UI (designer pass)
- **Placement:** after Description, before Team — "Project · optional".
- **Closed:** looks like the other fields; shows "No project" in muted text, or the chosen project with a small platform badge (Meta blue, Google, Snapchat yellow) and an × to clear.
- **Open:** an in-form list (not a native dropdown — those render white-on-white in dark mode on Windows): search box, the three groups separated by thin dividers in the given order, each row = platform badge + exact name; keyboard ↑ ↓ Enter Esc; the chosen row has a check. Typing narrows instantly.
- **Board card:** a small one-line project label under the title, so the account is visible at a glance. **Detail view:** a "Project" row with the same picker when editable, a chip when read-only.

## Proving nothing breaks
- Backend tests (throwaway DB): seed is idempotent; list endpoint; create with / without / bad project; batch copies and repeating copies carry it; edit sets, changes and clears it; tasks without a project unchanged.
- Existing task tests must pass unchanged. Type check, production build, browser: create with and without a project, change it in the detail view, dark mode.

---
---

# plan.md — Ad Reports: delete, team-first people picking, several teams and people

> **Status: DONE (2026-10-09)** — implemented and verified: backend 183 passed (8 new Ad Reports tests, 10/11 mutants caught, 1 equivalent) / the same 8 old failures; type check clean (2 old login errors); production build passes. Browser as Team Leader (QA): create with 2 teams + 4 people (picker = both teams' members only; Show everyone; ★ main team; 👑 owner), edit (remove a person + a team; last team locked; another leader's team 🔒), delete + Undo an ad, account with people → "+ Add ad" pre-fills team + people, delete account keeping its ad; phone width.

## The idea, and what changes in it
Asked for: (1) delete an ad or an ad account; (2) create both the way a task is created: **pick the team first, then people from that team**; (3) **several teams** and **several people**; (4) **change the people later** from Edit.
All four make sense. Today the form picks one team, then anyone in the company (max 2: owner + backup), accounts have no people at all, the team can never change, and nothing can be deleted.

Improvements on the idea:
- **Delete with Undo, not a hard delete.** A deleted report (with its days of numbers) moves to a trash collection; the toast offers **Undo** for a few seconds, and an admin can still bring it back later. One wrong click must not wipe months of numbers.
- **Deleting an account asks what happens to its ads:** keep them as standalone ads (default) or delete them too.
- **A redo request survives the delete.** If the ad was sent to the media team ("Ad not performing"), the request stays in their Leader Desk with the creatives copied onto it, plus a history line saying the report was deleted. (Deleting the old ad is often exactly what happens after a redo request.)
- **Accounts get people too** ("who looks after it", optional): they see the account and every ad inside it and can update those ads' numbers. Reminders still go only to each ad's own people, so nobody gets double reminders.
- **People are picked from the chosen teams' members**, with a "Show everyone" switch for cross-team help (same idea as Add Task).
- **Teams can change in Edit.** A leader can add or remove only teams they lead (admins: any), and must keep at least one of their own, so nobody locks themselves out or takes a report away from another team's leader.

## Rules (backend)
- `team_ids` (list, up to 5) is added to each report; `team_id` stays as the **main team** (= first in the list) so flags, notifications and older code keep working. Reports without `team_ids` behave as `[team_id]`.
- **Who manages** (edit, delete, remind, pause, end): admin roles, or a leader of **any** of the report's teams. Leaders of all its teams see it.
- **People:** up to 6 (the first is the owner). Ads need at least one; accounts may have none.
- **Account people:** see the account and its ads, may enter its ads' numbers. Not reminded.
- **An ad may join an account that shares at least one team with it** (was: the same single team).
- **Reminder stage 2** goes to the leaders of all the report's teams.
- **Delete** `DELETE /ad-reports/{id}` (managers only; ended reports too). Ad: the report + its entries are moved to `ad_reports_deleted` / `ad_report_entries_deleted` under one batch id. Account: `?with_ads=true` also moves its ads (you must manage each one), otherwise its ads are detached. Returns the batch id.
- **Undo** `POST /ad-reports/deleted/{batch}/restore` (whoever deleted it, or an admin): puts everything back with the same ids, re-attaches detached ads, and clears an account link that no longer exists.
- "Mine" on the Today strip only counts ads (an account has nothing to type).

## UI (designer pass)
**Form (New / Edit), one scroll, in the same order as Add Task:**
1. *What are you tracking?* — unchanged cards (create only).
2. *Name.*
3. **Teams** — coloured chips with ×, first one tagged "main"; a "+ Add team" menu lists the teams you can add. Teams you don't lead show as locked chips (🔒, tooltip) in Edit.
4. *Account* (ads) — lists accounts sharing a team.
5. **People** — "Who updates it daily" (ads) / "Who looks after it — optional" (accounts). Chosen people as avatar chips, the first with an "owner" tag and a "Make owner" action on the others. Below, a search list of the **chosen teams' members** (stays open for several picks, "Done" collapses it, "+ Add people" re-opens), a "Show everyone" switch, and before a team is chosen a dashed hint: *Pick a team first*. People outside the chosen teams show "· other team" on their chip.
6. Dates / numbers / reminders (ads) — unchanged.

**Delete:** a quiet trash button at the end of the left action row on the ad hero and the account hero (managers only, also on ended reports, which have no other buttons). It opens a small confirm dialog: red icon, "Delete “name”?", a summary of what goes (e.g. "41 days of numbers · 3 creatives · seen by 4 people"), for an open redo request a line saying it stays with the media team, and for an account a two-option choice (keep its N ads / delete them too). Buttons: Cancel · **Delete** (red). After it: the page moves to the next report and the toast says *Deleted “name”* with **Undo**.

**Facts row:** "Team" becomes "Teams" (chips); "Updated by" lists everyone, the owner first. The left rail shows "Main team +1".

## Proving nothing breaks
- New throwaway-DB tests: multi-team visibility and manage rules, team edits (add / remove / lock-out guard / account overlap), up to 6 people, account people seeing and entering their ads, delete + undo for an ad and an account (both choices), the redo request surviving a delete, permissions (employee / other team's leader get 403/404).
- Existing Ad Reports and flag tests must pass unchanged (old single-team reports keep working).
- Type check, production build, browser QA as a Team Leader and an Admin with QA accounts (create with 2 teams + 3 people, edit people/teams, delete + undo an ad, delete an account both ways), phone width.

---
---

# plan.md — Projects: "Team view / My work" switch for leaders

> **Status: DONE (2026-10-09)** — implemented and verified: type check clean, production build passes; browser as Team Leader (switch both ways; My work = assigned_to_me only, server count matches; team + member restored on return; ?view=mine; reload remembers), Employee (no switch, ?view=mine ignored, all four chips), Admin ("All tasks | My work"). Frontend-only: `frontend/app/(dashboard)/projects/page.tsx`.

## The idea
A team leader is also an employee. Projects shows all their teams' work (right for leading), but to see *their own* tasks they had to dig: team filter, then member filter — or spot the "Assigned to me" chip among four lookalikes.
**A two-way switch at the top of the filters: `[👥 Team view] [👤 My work]`.**
- **Team view** (today): every task of the teams you lead (admins: all teams), with the team / member selectors and the quick chips.
- **My work**: only tasks **assigned to you** — exactly what an employee sees. The team / member / chip controls step aside (they're leader tools); search, dates, status and priority still apply.

## Details
- **Who sees it:** people whose board shows more than their own tasks — team leaders (by membership too) and admin roles. Employees see no change.
- **Remembered** per user (the page opens the way you left it) and in the URL (`?view=mine`), so a link can open "My work".
- **Coming back** to Team view restores the team / member / chip you had.
- The redundant "Assigned to me" chip is hidden while the switch is shown (the switch *is* that view, done properly).
- Header line follows the view: "My work · 12 tasks · 2 started · 9 approved".
- **No backend change**: My work = the existing, tested `scope=assigned_to_me`.

## Where it goes (UI)
- **First thing in the filter card**, where "All my tasks" sits today — it decides *whose* work the board shows, so it leads the row; the team and member selectors follow it in Team view. A segmented control with icons, the active side primary-tinted so the current mode is obvious at a glance (distinct from the neutral Board/Table toggle in the header). In My work the row reads: `[Team view | ●My work]  Only tasks assigned to you — what you'd see as an employee.` On phones the switch takes the full width.

## Proving nothing breaks
Frontend-only; Team view sends exactly today's requests. Check: type check, production build, browser as a Team Leader (switch both ways, filters restored, URL, reload remembers), an Employee (no switch, unchanged page), an Admin (switch with "All tasks").

---
---

# plan.md — "Ad not performing": send a weak ad to the media team leader to recreate

> **Status: DONE (2026-10-08)** — implemented and verified: backend suite 164 passed (3 new flag tests, 6 mutants all caught) / the same 8 old failures; existing Ad Reports tests all pass; type check clean (2 old login errors); production build passes. Browser QA with QA accounts only: Lena flagged "delta" → Kofi (bell + strip + rail chip), withdrew it; Kofi's flag on "QA Content — Webinar leads" → Lena's Leader Desk (card with media + numbers, lightbox with all 12 creatives), Start recreating → Mark recreated with a note; sender + the ad's assignee notified at each step; notification link opens the right tab and highlights the card; phone layout.
> Found while testing: money in narrow card tiles was cut off (→ row layout); the notification link didn't switch Leader Desk's tab on in-app navigation (→ useSearchParams watcher).
> **Bug report (2026-10-08) — "I click the button, it doesn't arrive in Ads to redo".** Investigated: the flag WAS created and delivered (Super Admin → Basil Mohammed, Design Team; Basil's inbox had it) — but Ads to redo listed only flags sent *to the viewer*, so the sender/admin saw an empty tab and withdrew it. Fixed: views **Sent to me · Sent by me · All (admin roles)**, opening on the view that has something; cards show "With <leader> · <team>" and a confirmed Withdraw for the sender; the send toast says "it's in their Leader Desk → Ads to redo"; leaders whose name is shared by another account show their email (3 "Basil Mohammed" accounts exist); Withdraw asks first. Also fixed: a service worker left by a production build on localhost:3000 kept serving old `/_next/` files to `next dev` (stale code) — dev now unregisters it and clears its cache; and a pre-existing flaky JWT test (tampered the ignorable last base64 char).

## The flow (3 steps, no extra screens)
1. **Marketing flags it.** On an ad's report, the people on the ad (its assignees) or their team leader press the red **Ad not performing** button, pick *who should recreate it* (a team leader, e.g. the media team's), tick a reason or two, add a note if they like → **Send**.
2. **The media leader gets it in Leader Desk.** A bell notification (and push; email if they opted in) opens **Leader Desk → Ads to redo**: one card per ad with **the ad itself** (all its creatives, playable/zoomable), **the report** (last 7 days vs the 7 before: leads, amount spent, cost per lead, + 14-day leads trend), the reasons, the note, who sent it and when.
3. **The leader acts:** **Start recreating** → **Mark recreated** (optional note), or **Decline** (with a reason). Whoever flagged it is notified at each step, and the ad's page shows where it stands.

## Why it's built this way
- **The flag carries the media and the numbers.** A media leader usually isn't on the marketing team, so they can't open that team's ad report — and they shouldn't need to. The flag stores a **frozen snapshot of the numbers at the moment it was sent** (what "not performing" meant then) and shows the ad's **current creatives** (signed links, never public). No report permissions are widened.
- **One open flag per ad** (database-enforced) — no duplicate requests; the button turns into a status line while it's open.
- **Who may flag:** the ad's assignees, its team's leaders and admin roles (exactly who can already work on the report). Not on account rows — flag the ad inside.
- **Who receives:** any active team leader except yourself, grouped by team. The picker pre-selects the leader this ad was last sent to, else the one you last used — usually zero clicks.
- **Who may act:** the chosen leader (admin roles too). The sender may **Withdraw** while it's still open.
- **Reuses** the existing notification delivery (bell + push + opted-in email), creative signing, and the report's own 7-day-vs-previous calculation, so the numbers match the Performance overview exactly.
- New collection `ad_flags`; new endpoints only (`/ad-reports/{id}/flag-draft`, `/ad-reports/{id}/flags`, `/ad-flags…`). The report list gains one additive field (`flag`) for the status line.

## Where the button goes (UI)
- **In the ad's action row, on the far right, set apart from the management buttons:** `[Update numbers] [Remind] [Edit] [Pause] [End] ········· [⚠ Ad not performing]`. Left = keep the report running; right = escalate the ad. The gap tells you they're different kinds of action.
- **Red, but not shouting:** red outline + soft red fill + red text with a trending-down icon — unmistakably the "problem" button, without competing with the blue primary "Update numbers". Phones: it wraps to its own full line.
- **Once sent**, the button is replaced by a red status strip under the facts (same style as "No numbers yet"): *"Not performing — sent to Mira (QA Design Team) · 8 Oct · Waiting / Being recreated"* with **Withdraw** for the sender. After it's recreated/declined the strip says so for 14 days, and the button is back.
- **The dialog:** the ad's cover + last-7-days numbers at the top (so you see what you're sending), **Send to** (leaders grouped by team), reason chips (*High cost per lead · Too few leads · Low clicks · Ad looks tired · Wrong audience · Other*), optional note, **Send to Mira**. A reason or a note is required — the media team needs to know what to fix.
- **Leader Desk:** a new tab **Ads to redo** with a red count, next to Reedit (same family: work coming back). Rail cards in Ad Reports get a small red "Not performing" chip while a flag is open.

## Proving nothing breaks
- Additive only: new collection, new endpoints, a new Leader Desk tab, one extra field in the report list. Existing Ad Reports, Leader Desk tabs and notifications are untouched.
- New tests (throwaway DB): who may flag / receive / act, one-open-flag rule, snapshot numbers = the report's own calculation, notifications to the right people, withdraw/decline rules; mutation-checked. Full backend suite must stay at 161 passed / the same 8 old failures. Then type check, production build and browser QA (flag → Leader Desk → recreate → status back on the ad).

---
---

# plan.md — Download the Overview as a PDF (same filters, same numbers)

> **Update (2026-10-08):** "All tasks" now follows the team's task-report layout on landscape pages — # · Task · Assignee · Assigned · Due · Started · Ended · Completed · Time took · Late by (red; "so far" while open; "On time" when done in time). Late by = working hours past the due day (11:00–20:30 IST, Mon–Sat, company holidays off), matching the report's own numbers exactly.

> **Status: DONE (2026-10-08)** — implemented and verified. Backend suite 161 passed (4 new PDF tests, mutation-checked) / the same 8 old failures; type check clean (2 old login errors); production build passes; live check on the dev database: the numbers printed in the PDF = the database = the screen for 18/18 scope × range combinations; browser QA (button placement, loading/disabled, phone width, real download path, PDF opened and inspected).
> Found while testing on real data: a 5,000-character task title made reportlab fail the whole export (row taller than a page) — fixed by clipping long text + `splitInRow`, with a regression test.
> Note: the team section lists the teams the report's tasks belong to (including "No team (personal)"), which is the complete picture for a report; the on-screen team cards show the teams you're in.

## What
A **Download PDF** button on the Overview. Whatever the Overview is showing — your own overview or one person's, any date range — the PDF is that exact view on paper: "Sara · 1 Oct – 8 Oct" in, "Sara · 1 Oct – 8 Oct" out.

## How the numbers stay correct (one query, not two)
- The PDF is built **on the server from the very same code path** as the Overview's task list. The scope/visibility logic in `GET /projects` (who may see whom, the member filter, the date filter) is moved into one shared helper; both the list and the PDF call it. So the PDF can never show more, less, or different tasks than the screen.
- The summary is computed with the **same formulas the Overview uses** (total · in progress = started+break · pending review · approved · overdue = due before today IST and not approved · avg completion over approved tasks with time). A test asserts the PDF's numbers equal what the list endpoint returns for the same filters.
- **Permissions:** identical to the Overview — a Team Leader can only export people they lead, an Employee only their own work; a refused member exports an empty report, exactly like the screen.
- Uses **reportlab**, already installed and already used for the chat/campaign PDFs. **Nothing new to install.**

## What's in the PDF (A4, one clean report)
1. **Header** — "Overview report", whose (your name / "Sara Ali · Design team"), the period in words ("Tasks created 1 Oct – 8 Oct 2026" or "All time"), generated time (IST) and by whom.
2. **Summary tiles** — Total · In progress · Pending review · Approved · Overdue · Avg completion.
3. **Task pipeline** — count and share per status.
4. **Teams** — per team: tasks, active, done, % complete (same as the team cards).
5. **Upcoming deadlines** — due in the next 7 days, not approved.
6. **All tasks** — title, assignee, team, status, priority, created, due, time spent; newest first; the header row repeats on every page; page numbers in the footer.
- Empty period → the report still downloads and says "No tasks were created in this period".
- Characters the PDF font can't draw (emoji) are dropped rather than printed as boxes; today's data is plain text.

## Where the button goes (UI)
- **At the end of the header's filter row: [📅 range ▾] [👤 member ▾] [⬇ PDF]** — the two filters choose *what* you see, the last button acts on *that result*, so it reads left-to-right as "pick, then take it with you". It sits on the same row (no new toolbar, KPI cards stay above the fold).
- **Styled as a quiet secondary button** (outline, same height and radius as the two pickers) so it never competes with the filters; label **"PDF"** with a download icon, tooltip "Download this overview as a PDF".
- **While preparing:** spinner + "Preparing…", button disabled; success toast "Overview PDF downloaded"; a clear error toast if it fails. Disabled while the Overview itself is still loading.
- **File name says what's inside:** `overview_sara-ali_2026-10-01_to_2026-10-08.pdf`, `overview_mine_this-month.pdf`, `overview_mine_all-time.pdf`.
- **Phone:** joins the stacked filters as a full-width button; tablet: wraps with the filters (same wrapping rule as now).

## Proving nothing breaks
- The shared helper is a pure move of the existing code; `GET /projects` returns byte-for-byte the same responses. Guarded by the existing tests (member scope, date range, projects) — the full suite must stay at 157 passed / the same 8 old failures.
- The new endpoint is additive (`GET /api/v1/projects/overview/pdf`); the Overview page only gains a button.
- New tests: PDF numbers = list numbers for leader/member/date combos, permission refusal, empty period, filename; mutation-checked. Then type check, production build, and browser QA (download, open the PDF, compare with the screen).

---
---

# plan.md — Overview date filter (works with the member filter)

> **Status: DONE (2026-10-08)** — implemented and verified: type check clean (only the 2 pre-existing login errors), production build passes, range helpers unit-checked (month/year/leap edges), browser QA as a Team Leader (presets, custom 1–8 Oct, member + dates together, shared link restore, Clear dates keeps the member, empty state, To-before-From blocked, bad URL falls back to All time, Escape, mobile 375px).
> QA round 2 (2026-10-08): fixed 5 issues — impossible date in a link crashed the page; unparseable date showed all-time numbers under a date heading; future To accepted; sidebar "Overview" left the page filtered while the URL was clean; header squeezed / panel off-screen at tablet widths. Added `backend/tests/test_overview_date_range.py` (IST edges, member + dates, search, presets; mutation-checked).
> Files: `frontend/lib/overviewRange.ts` (new), `frontend/components/dashboard/DateRangeFilter.tsx` (new), `frontend/app/(dashboard)/dashboard/page.tsx`.

## What
A date-range filter on the Overview, so "Sara, 1 Oct – 8 Oct" is two clicks: pick Sara in the member picker, pick the dates.

## How it counts (one rule, the same as Projects)
- The Overview shows **tasks created in the chosen period** and where they stand now — exactly what the Projects page's date filter already does (`date_filter` / `date_from` / `date_to`, IST calendar days, server-side). One rule everywhere, so a number on the Overview always matches the list behind it.
- Every card, the pipeline, Recent Activity, Upcoming Deadlines and the team cards re-count from that set. The member filter and the date filter simply combine.
- **No backend change** — the API already supports it. Nothing else on the page changes when no date is chosen ("All time" = today's behaviour, byte for byte the same request).

## Where it goes (UI)
- **In the header's right corner, beside "My overview"** — the two filters that change the whole page sit together, above everything they affect, and the KPI cards stay above the fold. Order: **[📅 All time ▾] [👤 My overview ▾]**. On phones both stack full-width under the greeting.
- **The button** reads the current range ("All time", "This month", "1 Oct – 8 Oct"); it turns primary-tinted when a range is on, exactly like the member picker does when someone is chosen.
- **The popover:** quick presets in one column — *All time, Today, Yesterday, Last 7 days, This week, This month, Last month, This year* — and a **Custom range** row (From / To date fields + Apply; To can't be before From, nothing after today).
- **The subtitle says it in words**, so numbers are never misread: "Viewing **Sara**'s overview · tasks created **1 Oct – 8 Oct** · Clear dates".
- Empty period → "No tasks were created between 1 Oct and 8 Oct" + "Clear dates".
- **URL:** `?from=2026-10-01&to=2026-10-08` (or `?range=this_month`) alongside `?member=` — refresh-, share- and Back-safe, the same pattern as the member filter.

## Also fixed
The Overview's own "today" (for due-soon / upcoming deadlines) used UTC, so between 00:00 and 05:30 IST it was a day behind. It uses the IST day now.

## Proving nothing breaks
No backend change. With no dates chosen the page sends the same request as before. Check: type check, production build, browser — presets, custom range, member + dates together, URL refresh/Back, empty state, phone width, and the existing member filter unchanged.

---
---

# plan.md — Saved tasks: task-name suggestions while typing

> **Status: IMPLEMENTED & VERIFIED (2026-10-08)** — approved with D1–D4 as recommended, plus "it must never be a headache". Not yet committed.
> Prepared 2026-10-08. Evidence: in the dev database 52% of tasks reuse a title that already exists (151 tasks, 89 distinct titles).

## 1. The idea, improved
Your idea: leaders keep a list of default task names; typing "a" in the task name suggests "apple".
We keep that exactly, and make it stronger in three ways:

| | Your idea | Plan |
|---|---|---|
| What is saved | A name | A **saved task**: the name, plus an *optional* description and priority. Picking it fills all three (only fields you haven't typed yet), so a routine task is one click. |
| Where suggestions come from | The saved list only | **Saved tasks first, then "Recently used" names** worked out automatically from the team's last 90 days. Useful from day one, even before anyone saves anything. |
| How the list grows | A settings page | Settings page **plus** one click inside Add Task: type a new name → "★ Save 'Monthly SEO report' for Video Team". A ☆ on any "recent" suggestion saves it too. |

## 2. Where things live
- **Managing saved tasks:** **Teams → (team) → Settings → "Saved tasks"**. Each team does different routine work, the Settings tab already exists and only leaders/admins see it. Table with name, description, priority, "used 12× in 90 days", edit / delete, and an "Add saved task" row.
- **Company-wide saved tasks** (e.g. "Weekly report" for every team): **Settings → "Saved tasks"** tab, admin roles only. Suggested in every team.
- **Using them:** the **Task name** field in **Add Task** (the same form for one-off, multi-person and repeating tasks).

## 3. How the suggestions behave (standard combobox, like Google / Gmail search)
- Click into Task name → a dropdown shows the team's top saved tasks straight away (one click, no typing).
- Type → it filters instantly. "a" matches names where **any word starts with a** ("**A**pple", "Monthly **a**d report"); best matches first (whole name starts with it → a word starts with it → contains it); the matched letters are bold.
- Sections: **★ Saved for Video Team**, **🏢 Company**, **🕘 Recently used** (with "used 6×"). Up to 8 rows.
- Keyboard: ↑ ↓ to move, Enter or Tab to pick, Esc to close. Mouse/touch: tap a row.
- It never forces a choice: you can always type any new name.
- Picking a saved task fills the name, and the description/priority **only if those are still empty**; a small "Filled from saved task · Undo" line appears.
- Changing the team switches to that team's suggestions.

## 4. Rules
- **Who sees suggestions:** anyone creating a task. Saved tasks: the selected team's (if you're in that team or lead it, or you're an admin) + company-wide. "Recently used": names from **teams you belong to** and your own tasks only — never another team's task titles.
- **Who manages:** the team's leaders and admin roles (team list); admin roles (company list). Employees just use them.
- No duplicates per team (case-insensitive), names up to 120 characters, up to 200 saved tasks per team.
- **Nothing about existing tasks changes.** Saved tasks are only suggestions; creating a task works exactly as today.

## 5. Build
- **Backend:** new collection `task_presets` `{team_id | null (company), title, description, priority, created_by, created_at, updated_at}` with a unique index on (team, lower-case title). Endpoints: `GET /task-presets/suggest?team_id&q` (saved + company + recent, ranked, permission-filtered), `GET/POST/PATCH/DELETE /task-presets` (management). "Used N×" and "recent" come from counting existing tasks — task creation itself is not touched.
- **Frontend:** a reusable `TaskNameCombobox` (ARIA combobox) replacing the plain Task name input in Add Task; "Saved tasks" panel in Team Settings; admin "Saved tasks" tab in Settings; inline ★ save.
- **Tests:** permissions (who sees / manages), no cross-team leakage in "recent", duplicate rule, ranking ("a" → word-prefix matches first), limits; browser QA incl. keyboard, phone width, light/dark; full regression suite.

## 6. Decisions to confirm (recommended first)
| # | Question | Recommended |
|---|---|---|
| D1 | Save only a name, or name + optional description & priority? | **Name + optional description & priority** |
| D2 | Also suggest "Recently used" names automatically? | **Yes** (team's last 90 days, your teams only) |
| D3 | Per team, company-wide, or both? | **Both** — team lists by leaders, one company list by admins |
| D4 | Allow "★ Save for team" right inside Add Task? | **Yes**, for leaders/admins |

---
---

# plan.md — Ad accounts, with their ads underneath (Ad Reports, part 2)

> **Status: IMPLEMENTED & VERIFIED (2026-10-07)** — committed in f08502b.

## What
Meta's own structure: **an ad account holds many ads**. Ad Reports gets the same two levels.

| Need | Build |
|---|---|
| Choose "Ad" or "Account" when creating | A **What are you tracking?** switch at the top of *New report* |
| An ad can belong to an account (default: none) | An **Account** picker on ads: *None* + the accounts of the selected team |
| The board shows accounts with their ads underneath | The left rail becomes a tree: account row → its ads indented; "Ads without an account" below |
| An account shows all its ads, connected | The account page = the **sum of its ads** (same Performance overview) + an **Ads in this account** table for the same range |

## Key decisions
1. **An account's numbers are its ads added up — never typed.** No double entry, no second set of reminders, and the totals can't disagree with the ads. Ratios (CPL/CTR/CPM/CPC) use the same "only days that recorded both parts" rule, now across ads.
2. **Same team only.** An ad can join an account of its own team. Otherwise a leader could read another team's spend through an account's totals.
3. **Who sees an account:** its team's leaders and the admin roles (the people who manage ads). An ad's owner still sees which account their ad is in (the name), not the account's totals.
4. **Accounts have no daily entry, people, reminder times or metrics of their own.** Their metrics are the union of their ads' metrics; their "since" date is their earliest ad's start. *End* archives an account; its ads keep running.
5. **Existing reports become "ads with no account".** Nothing to migrate: a missing `kind` means `ad`.
6. **Moving an ad** between accounts (or to none) is an *Edit* on the ad — leaders only.

## Data / API
- `ad_reports.kind` = `"ad"` (default) | `"account"`; ads get `account_id` (optional); accounts get `ad_account_ref` (optional text such as `act_1234567890`, so it matches what people see in Ads Manager).
- `POST /ad-reports` with `kind: "account"` (name, team, optional ad-account ID) or an ad with an optional `account_id`.
- `PATCH /ad-reports/{id}` — ads: `account_id` / `clear_account`; accounts: name, ad-account ID, End.
- `GET /ad-reports/{id}/series` on an account → the roll-up + `breakdown` (one row per ad: totals for the range, status, cover).
- Accounts are skipped by the reminder scheduler, "today" counts and the sidebar badge; entering numbers or "Remind" on an account is refused with a clear message.

## UI
- **New report:** a two-option segmented switch, *Ad / campaign* and *Ad account*, each with a one-line explanation. Ad → today's form plus an **Account** select (*None* first). Account → name, team, platform, ad-account ID, and a note: "Numbers come from the ads you add to it."
- **Rail (tree):** account row = building icon, name, "3 ads · 1 missing", a chevron to fold; its ad cards indented with a guide line; then **Ads without an account**. Phones: the report dropdown groups ads under their account.
- **Account page:** hero (account icon or cover, "Ad account" tag, name, Team · Ad account ID · Ads · Since, actions **+ Add ad**, Edit, End) → Performance overview of the sum → **Ads in this account** (thumbnail, name, status, owner, leads, spent, per lead, share of spend) for the chosen range; click a row to open the ad.
- **Ad page:** a small "in *Account name*" chip in the hero (clickable for leaders).

## Proving nothing breaks
Existing ad reports behave exactly as before (no `kind` = ad). New tests cover: create rules, same-team rule, roll-up maths (sum + paired ratios across ads), missing-day aggregation, breakdown, accounts excluded from reminders/today, entries/remind refused on accounts, visibility. Full suite, type check, production build, browser QA.

---
---

# plan.md — Ad Reports (Meta "Performance overview", filled in daily by the team)

> **Status: IMPLEMENTED & VERIFIED (2026-10-07)** — approved with D1–D7 as recommended. Details in `backend/servicesHistory.md` and `frontend/componentsHistory.md`. Not yet committed.
> Prepared 2026-10-07 after reading the live code (research in §2). The previous plan
> (Repeating Tasks, implemented) is kept further down this file.

---

## 1. What we are building

| # | Need (from the request) | What we'll build |
|---|---|---|
| 1–2 | The media team checks Meta Ads Manager every day and tells the leader the numbers by hand | An **Ad Reports** page in mediaERP that looks like Meta's *Performance overview* |
| 3 | The assigned person enters the numbers daily until the campaign ends | A 20-second **daily entry** (Leads, Amount spent; Cost per lead is calculated) |
| 4 | The team leader views it | KPI tiles + a daily line chart + a "who has updated today" strip, per report and per team |
| 5 | Missed day → reminder to the person; still missed → reminder to the person **and** the leader | A reminder scheduler: **stage 1** to the person, **stage 2** to the person + team leader(s); exactly once each, never duplicated by the 2 production workers |

One **Ad report** = one Meta campaign (or ad account) being tracked: name, team, assigned person (+ optional backup), start date, optional end date, and which metrics to track.

---

## 2. What the current code tells us (research)

| Finding | Consequence for the plan |
|---|---|
| A Meta Ads connector exists (`platforms/facebook_ads.py`, `services/facebook_ads_fetch.py`) but it has **never pulled real data** (`PROJECT_STATUS.md`: "Simulated data"), has **no Leads metric** (only `purchase`), a pagination bug, and is scoped to one user rather than a team | Manual entry is the right v1. We store one row per report per day, the same shape an auto-import would write, so **phase 2 "auto-fill from Meta"** can be added later without a redesign |
| No scheduler sends daily reminders today. The reliable pattern is the recurring-task one (own thread, own loop, own Mongo client, IST dates, atomic claim) | Reuse that pattern. Two existing schedulers (group daily report, email reports) have a check-then-act race that can double-send with 2 workers. **We will not copy that**: reminders use a unique-index claim |
| In-app notifications use the `notifications` collection and `push_notification(...)`, which also handles email opt-in and web push. The bell needs a `typeConfig` and a `destination()` entry per type; email opt-in needs the type in `_ALL_TYPES` | Two new types: `ad_report_due` (stage 1) and `ad_report_overdue` (stage 2). Users can turn the email off in notification settings, like any other type |
| `push_notification` and chat DMs rely on main-loop objects (the WebSocket manager and the global `get_db()`), which is fragile from a background thread | Reminders insert the notification row with the **thread's own client** and send email through the sync path; the bell's 60-second poll then delivers it. ⚠ The same fragility may affect chat DMs for copies made by the **repeating-task** scheduler. We'll test that during this work and fix it if confirmed |
| Working days already exist in `services/worktime.py`: shift 11:00–20:30 IST, **Sunday off**, and the `company_holidays` collection | No reminders on Sundays or holidays; the next working day asks for all missing days at once |
| Charts: **Recharts 3** is installed, and `SpendTrendChart` (on a hidden page) already does IST daily axes and tooltips. The Overview already has a KPI card style | No new libraries. ⚠ Every money helper hard-codes `$`, so we add one small `formatINR` with Indian grouping (₹16,200.32) |
| "Performance" (the page and its `["performance"]` query keys) is already the task-turnaround report | New name **Ad Reports**, route `/ad-reports`, keys `["ad-reports", …]`, so nothing collides |
| The Overview has no "attention" area, and the slot between the greeting and the KPI cards is free | A small, dismissible **"2 ad reports need today's numbers"** banner goes there, shown only when something is due |
| The dev DB has **live Gmail SMTP** (found in the last QA) | Reminder emails are real emails, so QA runs with email paused, as before |

**Skills/packages to install: none.** Everything needed (Recharts, framer-motion, React Query, base-ui dialog, sonner) is already in the project.

---

## 3. Design: key decisions

### 3.1 Data (3 new collections; nothing existing changes)
- **`ad_reports`** is the tracker: `name, platform ("meta"), team_id, assignees[] (owner first, optional backup), start_date, end_date|null, metrics[] (e.g. ["leads","spend"] + optional extras), currency ("INR"), reminder_times {due:"12:00", escalate:"17:00"}, status (active | paused | ended), created_by`.
- **`ad_report_entries`** holds one row per report per day: `report_id, date (IST YYYY-MM-DD), values {leads: 14, spend_paise: 273252, …}, campaign_off: bool, note, entered_by, entered_at, edits[] (who/when/old→new)`. A **unique index on (report_id, date)** means a day can never be entered twice.
- **`ad_report_reminders`** is the reminder ledger, with a **unique index on (report_id, on_date, stage)**. A worker inserts first, and only the insert that succeeds sends. Two workers, a restart or a slow loop can never send a reminder twice.

### 3.2 Numbers are stored safely
- Money is stored in **paise, as integers**, so there's no floating-point drift (₹16,200.32 is stored as 1620032).
- **Cost per lead is never typed.** It is always `spend ÷ leads`, so it can't disagree with the other two. For a week or month it's `total spend ÷ total leads`, never an average of daily averages.
- **A missed day is not zero.** The chart shows a gap or a hollow "not reported" dot, so a leader never mistakes "forgot to enter" for "zero leads". "Campaign didn't run" is an explicit 0 that the person ticks.

### 3.3 Metrics ("Customise", like Meta)
- The default preset is **Lead generation**: Leads (Form), Amount spent, and *Cost per lead* (calculated).
- When creating a report, the leader can tick optional extras: Impressions, Reach and Link clicks, which add *CTR, CPM and CPC* (calculated). Only ticked fields appear in the entry form.

### 3.4 Which day an entry is for
Ads Manager's "today" figures are partial until midnight, so by default each entry records **one full day: yesterday**. The person enters yesterday's final numbers each morning. The form lists every missing day, so after a Sunday or holiday they can fill in Saturday and Sunday together. *(Decision D1; the alternative is today's numbers in the evening.)*

### 3.5 Reminders (the escalation ladder)
On each **working day**, for every active report that has missing days up to yesterday:

| When (IST, editable per report) | Who | Message |
|---|---|---|
| **12:00**, stage 1 | Assigned person (+ backup) | "📊 *Delta Admissions – Oct*: please add numbers for 6 Oct". Sent to the bell, plus email if enabled |
| **17:00**, stage 2 | Assigned person **and** the team leader(s) | "⚠ *Delta Admissions – Oct* still has no numbers for 6 Oct (Asha)" |

- One reminder per report, per stage, per day, **listing every missing date**, rather than a flood of one per day.
- No reminders on Sundays or holidays, before the start date, after the end date, or while the report is paused.
- Leaders also get a **"Remind now"** button (at most once an hour per report).
- Clicking a reminder opens the report with the entry form already open.

### 3.6 Edits and trust
- The assigned person can correct the **last 7 days**, because Meta figures shift a little as attribution settles. The leader can correct any day.
- Every correction is kept (who, when, old → new) and shown on the chart as a small ✎ marker. It's the same idea as the "Manual edits" icons in Meta.
- A sanity check runs while typing. If a value is wildly different from the day before (e.g. 6× the spend), the form asks "Is ₹1,62,003 correct?". This catches the classic extra-zero typo.

### 3.7 Lifecycle
Active → (Pause / Resume) → **Ends automatically** once the end date's numbers are in, or when the leader clicks End. Ended reports stay viewable as read-only history.

---

## 4. Who can do what

| Action | Who |
|---|---|
| Create, edit, pause or end a report | The **team leader of that team**, plus Super Admin, Admin and Coordinator (the same rule as repeating tasks, `workflow.can_assign_to_others`) |
| Enter or correct daily numbers | The report's assigned person(s), the team leader, and admins |
| View | The assigned person(s), the team's leaders, and admins. **Nobody else**: a stranger asking for a report id gets "not found" (the lesson from the last QA) |

---

## 5. UI: where it goes and what it looks like

The principle: **a member should spend 20 seconds a day, and a leader should see everything at a glance.** Everything is additive; no existing screen changes behaviour.

### 5.1 Sidebar: new item "Ad Reports" (📈 line-chart icon)
It sits **directly under Media Schedule**, because this is media-team work. It's shown only to people who have a report, lead a team, or are admins. A small red badge counts *your* reports still waiting for numbers today, the same pattern as the Leader Desk badge.

### 5.2 The Ad Reports page (`/ad-reports`): two panes, Meta-style
```
┌ Ad Reports ─────────────────────────────── [Mine | Team ▾]  [+ New report] ┐
│ Today: 5 of 7 updated · Missing: Asha (Delta Admissions), Xavier (Open Day) [Remind] │  ← leaders only
├──────────────────────┬──────────────────────────────────────────────────────┤
│ ● Delta Admissions   │  Performance overview      [Day ▾] [Last 14 days ▾]  │
│   Asha · ✓ Updated   │  ┌──────────────┐                                    │
│   ▁▃▇▅▅▂▄▆▄▃         │  │Leads (Form) ⓘ│  Cost per lead ⓘ   Amount spent ⓘ  │
│ ○ Open Day Promo     │  │ 83           │  ₹195.18           ₹16,200.32      │
│   Xavier · ⚠ Missing │  └──────────────┘   ▲ 12% vs prev     ▼ 4%            │
│ ○ Hostel Leads       │  Leads (Form)                                        │
│   Mira · ⏳ Due 12:00│   ── line chart, gaps for unreported days, ✎ edits ──│
│                      │                    [ ✎ Update numbers ]  (primary)   │
└──────────────────────┴──────────────────────────────────────────────────────┘
```
- **Left rail:** one card per report, showing the name, the person, today's status chip (✓ Updated · ⏳ Due · ⚠ Missing · ⏸ Paused · Ended) and a tiny sparkline. Missing reports sort first.
- **Right pane:** a faithful take on Meta's card:
  - **Clicking a KPI tile switches the chart to that metric**, exactly as in Meta, and the selected tile gets the outline.
  - A **Day / Week / Month** dropdown and range presets (7 / 14 / 30 days, This month, Lifetime, Custom).
  - The % change vs the previous period.
  - A legend with "Not reported" and "✎ Edited".
- **Mobile:** the rail becomes a dropdown at the top, the KPI tiles become a 3-up scrolling row, and the chart goes full width.
- Light and dark themes come from the existing tokens; the chart line uses the brand teal/blue.

### 5.3 The daily entry: a focused modal (opened from the button, the banner or a reminder)
```
Update numbers — Delta Admissions
 Missing days:  [6 Oct ✓] [5 Oct] [4 Oct]
 Leads (Form)   [ 14        ]   yesterday 12
 Amount spent ₹ [ 2,732.52  ]   yesterday ₹2,430.10
 Cost per lead  ₹195.18  (calculated)
 ☐ Campaign didn't run this day     Note (optional) [            ]
                                     [Save & next day →]  [Save]
```
- Large number inputs. Enter moves to the next field, and "Save & next day" walks through all the missing days.
- The previous day's values are shown beside each field to catch typos, alongside the 6× sanity check from §3.6.

### 5.4 Overview banner (only when something is due)
Between the greeting and the KPI cards: *"📊 2 ad reports need yesterday's numbers — Update now"*. It disappears once the numbers are in, so people with nothing due never see it.

### 5.5 "+ New report" (leaders): one short modal
Name · Team · Assigned person (+ backup) · Start / End (or "until I end it") · Metrics (preset + optional extras) · Reminder times (12:00 / 17:00 by default) · Currency (₹ by default).

### 5.6 Notification bell
Two new notification types with their own icons. Clicking one opens the report with the entry form ready.

---

## 6. API (all new; nothing existing changes)
| Method | Path | Purpose |
|---|---|---|
| GET / POST | `/api/v1/ad-reports` | List (scoped as in §4) / create |
| GET / PATCH | `/api/v1/ad-reports/{id}` | Read (404 if it isn't yours) / edit, pause, resume, end |
| GET | `/api/v1/ad-reports/{id}/series?from&to&granularity=day\|week\|month` | KPI totals, % change, chart points (gaps marked) and edit markers |
| PUT | `/api/v1/ad-reports/{id}/entries/{date}` | Enter or correct one day (validation, 7-day rule, edit history) |
| GET | `/api/v1/ad-reports/today` | "5 of 7 updated", the missing list, and my due count (for the sidebar badge and banner) |
| POST | `/api/v1/ad-reports/{id}/remind` | The leader's "Remind now" (rate-limited) |

---

## 7. Proving nothing breaks (requirement #8)
1. **Additive only.** A new router, 3 new collections, a new page and new components. The changes to existing files are one-liners: router include and scheduler start (`main.py`), indexes (`database.py`), one sidebar item, the Overview banner, two bell types and two notification-pref types.
2. **Before/after checks.** The full pytest run must stay at **107 passed / 8 pre-existing failures**, with the new suite green. Frontend `tsc` must show only the 2 pre-existing login errors.
3. **A new pytest suite** on a throwaway DB with a frozen IST clock, covering:
   - entry rules: one row per day, paise, the 7-day edit window, permissions, 404 for strangers;
   - the totals and cost-per-lead maths for day, week and month;
   - gaps are not counted as zero;
   - the reminder ladder: stage 1 → 2, Sunday/holiday skip, paused/ended skip, the missing-dates summary;
   - **two workers at once still send each reminder exactly once**, mutation-tested like last time.
4. **Browser QA** as a member, a leader, an admin and an outsider, on desktop and at 375 px, in light and dark mode, with **email paused** during testing.
5. Check, and fix if confirmed, the background-thread delivery issue from §2, for the repeating-task scheduler too.

## 8. Build order
1. Backend: models and indexes → service (maths, rules) → router → reminder scheduler → tests.
2. Frontend: types, `formatINR` and hooks → page (rail, overview card, chart) → entry modal → new-report modal → sidebar item and badge → Overview banner → bell types.
3. QA, history docs, report.

## 9. Phase 2 (not in this build; optional later)
- **Auto-fill from Meta:** once the Meta connector is fixed (add the Leads action, fix pagination, scope it to a team), it can pre-fill each day's row and the person just confirms.
- A weekly email summary to leaders, and WhatsApp reminders (the helper exists but is unused).

## 10. Decisions to confirm at approval (recommendation first)
| # | Question | Recommended |
|---|---|---|
| D1 | Which day does an entry record? | **Yesterday's full-day numbers**, entered the next morning (alternative: today's numbers in the evening) |
| D2 | Reminder times | **12:00** to the person, **17:00** to the person + leader (editable per report) |
| D3 | Sundays and holidays | **No reminders**; the next working day asks for all missing days |
| D4 | Metrics | **Leads (Form) + Amount spent → Cost per lead**, with optional extras per report |
| D5 | Who creates reports | **Team leaders + admins** |
| D6 | Corrections | The person: **last 7 days**; the leader: any day; every edit tracked and marked |
| D7 | People per report | **One owner + an optional backup** (both can enter, both are reminded) |

---
---

# Previous plan: Repeating Tasks + Multiple Assignees (implemented 2026-10-07)

> **Status: IMPLEMENTED & VERIFIED (2026-10-07)** — approved with D1–D7 as recommended. See `backend/servicesHistory.md` and `frontend/componentsHistory.md` for what shipped and how it was tested. Not yet committed.
> Prepared 2026-10-07 after reading the live code paths listed in §2.

---

## 1. What we are building

| # | Need (from the request) | What we'll build |
|---|---|---|
| 1–3 | Daily / weekly / monthly tasks are re-typed by hand every time | A **Repeat** option on the existing *Add Task* form |
| 4 | Leader creates a task and assigns it | Unchanged — same form, same rules |
| 5 | **Daily** → a fresh copy is assigned every day, status *Pending* | Automatic, at the start of each day (IST) |
| 5 | **Weekly** → created on a Friday, repeats every Friday | Repeats on the **same weekday** it was created |
| 6 | **Monthly** → created on the 1st, repeats on the 1st | Repeats on the **same day of the month** |
| 7 | "Repeat 5" → 5 days / 5 weeks / 5 months | **Repeat N times** (N counts every copy, including today's) — plus optional *until I stop it* |
| 8 | Assign to several people at once | **Multiple assignees** — each person gets **their own copy** |

---

## 2. What the current code tells us (research)

These facts drive every decision below.

1. **`POST /api/v1/projects` (`routers/projects.py:add_task`) is not just an insert.**
   It validates title/team/due date, checks `workflow.can_assign_task`, applies the
   approver rules (`can_assign_to_others`, `is_team_member`), adds the creator as the
   default verifier, calls `project_service.create_task`, fires notifications
   (`_fire_notifications`) and sends a chat DM (`chat_notify.dm_task_assigned`).
   → Auto-created and multi-assigned tasks **must go through this exact logic**, or they
   would silently skip rules a hand-made task follows.

2. **Everything in the app is per-person.** Timer, status workflow, approval,
   verification, reedit, cross-team routing, Leader Desk queues, Performance report,
   and the Overview member filter all key on a single `assigned_to`.
   → A task shared by 3 people would break all of them. One copy per person keeps them all working.

3. **Production runs 2 worker processes** (`Dockerfile: WEB_CONCURRENCY=2`), and each starts
   every background scheduler. A naive "create today's tasks" job would assign **every task twice**.

4. **The existing daily-report scheduler** (`group_chat_service._scheduler_loop`) uses
   *check → post → record*. Two workers can both pass the check → double posting.
   That is a pre-existing race (flagged in §10, not changed by this plan) and the pattern we must **not** copy.

5. **The app runs on IST** (`utils/timezone.py`: `IST`, `today_ist()`), so "every day / Friday / the 1st" means **IST calendar days**.

6. **Reusable pieces already exist:** `components/teams/UserPicker.tsx` (searchable multi-select),
   the badge row on `KanbanCard.tsx` (where `VerificationBadge` sits), and the house
   background-scheduler pattern (daemon thread + its own event loop + its own Motor client).

---

## 3. Design — the four key decisions

### 3.1 Multiple assignees = one independent copy per person ("fan-out")
Selecting Asha, Mira and Ravi creates **3 tasks**, one each, sharing a `batch_id`.
Each person has their own timer, status, approval and history — exactly like today.
*Why not one shared task?* See §2.2 — it would break every per-person feature.

### 3.2 One "factory" function every task is born through
Move the body of `add_task` into `services/task_factory.py → raise_task(db, data, actor)`.
- `POST /projects` becomes a thin wrapper → **identical behaviour** (proven by a before/after diff test, §8).
- Multi-assign calls `raise_task` once per person.
- The repeat scheduler calls `raise_task` for each copy, **acting as the leader who set it up**.

Result: a repeated or multi-assigned task can never drift from the rules of a hand-made one.

### 3.3 A repeating task is a "series" (template) that spawns normal tasks
New collection **`recurring_tasks`** — the template:

```
title, description, priority, team_id, approver_id, verify_users, verify_teams, attachments
assignees:        [user_id, …]              # 1 or more
frequency:        "daily" | "weekly" | "monthly"
anchor_date:      "2026-10-10"  (IST)       # first copy; fixes the weekday / day-of-month
occurrences_total: 5 | null                 # null = until stopped
occurrences_done:  2
next_date:        "2026-10-24" | null       # next copy to create (null once finished)
due_offset_days:  0                         # each copy due N days after its own date
status:           "active" | "paused" | "completed" | "stopped"
created_by, created_at, updated_at
```

Each spawned copy is an **ordinary task** in `project_tasks` plus three optional fields:
`recurrence_id`, `occurrence_date`, `occurrence_index` (for "3 of 5").
Because they are ordinary tasks, they automatically appear in Overview, Projects,
Leader Desk, Performance and the member filter — no changes needed there.

### 3.4 Scheduler that can never double-assign
- Same house pattern as the other schedulers (daemon thread, own event loop) — started in `main.py`.
- Every minute: find active series with `next_date <= today (IST)`.
- **Atomic claim:** `find_one_and_update({_id, status:"active", next_date: D}, {$set: next_date → next(D), occurrences_done +1})`.
  Only one worker gets the document back; the other gets nothing and moves on.
- **Safety net:** a unique index on `(recurrence_id, occurrence_date, assigned_to)`,
  partial to recurring tasks only — so even an edge case cannot create a duplicate,
  and existing tasks are untouched by the index.
- Fails soft: an error is logged and retried next minute; it never takes the app down.

---

## 4. How the dates work

| Frequency | Rule | Example (created **Fri 10 Oct**, repeat **3**) |
|---|---|---|
| Daily | every calendar day | 10 Oct, 11 Oct, 12 Oct |
| Weekly | same weekday | Fri 10 Oct, Fri 17 Oct, Fri 24 Oct |
| Monthly | same day of month | 10 Oct, 10 Nov, 10 Dec |

- **The first copy is created immediately** when the leader saves — they see it at once.
  Later copies appear at the **start of their day (00:00 IST)**.
- **"Repeat 5" = 5 copies in total**, today's included. The form shows the exact
  dates ("5 tasks · 10 Oct → 14 Oct"), so there is no ambiguity.
- **Month-end safety:** a series anchored on the 31st lands on the **last day** of shorter
  months (30 Nov, 28/29 Feb) and returns to the 31st when the month allows. Dates are
  always computed from the anchor, never from the previous copy, so they never drift
  (31 → 28 → 28 → … is the classic bug this avoids).
- **Server was down?** Missed copies are created when it comes back, each with its correct
  date, so no task is silently lost (capped at 31 per series per run).
- **Due date:** each copy is due **the same day** it's created by default; the leader can
  choose "+N days" (e.g. a weekly report due 2 days later).

---

## 5. Who can do what

| Action | Who | Same as today? |
|---|---|---|
| Assign one task to **several people** | anyone who can raise a task (`can_assign_task`) | Yes — same rule as single assignment |
| Create a **repeating** task | team leader of the chosen team, or Super Admin / Admin / Coordinator (`can_assign_to_others`) | New rule — repetition keeps assigning work on someone's behalf, so it is a leadership action |
| Pause / resume / stop / edit a series | its creator, that team's leaders, or admin roles | New |

**Self-protection:**
- If the series creator **loses leader rights or is deactivated**, the series **pauses itself**.
  Work is never auto-assigned in the name of someone no longer allowed to.
- If an assignee is **deactivated or removed**, they are skipped. The others still get their copies, and the series records who was skipped.
- **Limits:** up to 25 assignees; up to 365 daily, 104 weekly or 36 monthly copies. "Until I stop it" is allowed, and stays visible and stoppable.

---

## 6. UI — where the options go

**Principle:** don't add a new screen to learn. Put the options exactly where a leader
already creates work, and follow the convention everyone knows from Google Calendar /
Outlook / Todoist: **"Repeat" lives next to the date.**

### 6.1 Add Task form (existing modal) — two upgrades

```
┌─ New Task ────────────────────────────────────────────┐
│ Title *        [ Daily social media report          ] │
│ Description    [ …                                   ] │
│ Team *         [ Video Team                       ▾ ] │
│                                                       │
│ Assign to *    [ Asha ✕ ] [ Mira ✕ ] [ + Add people ] │  ← multi-select chips
│                ⓘ Each person gets their own copy      │    (reuses UserPicker)
│                                                       │
│ Due date *     [ 10 Oct 2026 ]   Priority [ Medium ▾ ]│
│                                                       │
│ Repeat         ( Once ) ( Daily ) (●Weekly) ( Monthly)│  ← segmented control,
│                Repeat [ 5 ] times   ○ until I stop it │    default "Once" =
│                Each copy due  [ same day          ▾ ] │    nothing changes
│  ┌──────────────────────────────────────────────────┐ │
│  │ ↻ Every Friday · 5 times · 10 Oct → 7 Nov       │ │  ← live plain-English
│  │   2 people × 5 = 10 tasks in total              │ │    summary: the leader
│  └──────────────────────────────────────────────────┘ │    sees exactly what
│                                                       │    will happen
│                         [ Cancel ]  [ Start repeating ]│  ← button names the
└───────────────────────────────────────────────────────┘    consequence
```

- **Default is "Once" with one assignee** — the form behaves exactly as today unless the leader opts in.
- When Repeat is on, the fixed due date becomes **"Each copy due: same day / +1 / +2 / +7 days"**.
- **The button label changes with what will happen:** "Create task" → "Create 3 tasks" → "Start repeating".
- **Monthly on the 29th–31st** shows a one-line note: *"(or the last day of shorter months)"*.
- **Repeat is hidden for people who can't create repeating tasks**, so nobody hits a server refusal.

### 6.2 On the task card — a small badge
In the existing badge row next to the verification badge: **`↻ 3/5`**,
with the tooltip *"Repeats weekly · copy 3 of 5"*. It's quiet, and recognisable at a glance.

### 6.3 In the task detail modal — a one-line strip
*"↻ Part of a weekly series · copy 3 of 5 · next on Fri 24 Oct · **Manage**"*

### 6.4 Managing series — "Repeating" button on the Projects page header
Next to **Add Task**: a **`↻ Repeating (4)`** button that opens a side drawer:

```
┌─ Repeating tasks ───────────────────────────── ✕ ┐
│ Daily social media report           ● Active     │
│ Asha, Mira · Every day · next: tomorrow           │
│ ███████░░░░░░  7 / 20         [Pause] [Stop] [✎] │
│ ───────────────────────────────────────────────── │
│ Monthly invoice summary             ⏸ Paused     │
│ Ravi · On the 1st · next: 1 Nov                  │
│ ██░░░░░░░░░░░  2 / 12        [Resume] [Stop] [✎]│
└───────────────────────────────────────────────────┘
```

**Why there?** The Projects page is where leaders create and run work. A header button
keeps it one click away without adding another item to an already long sidebar.
*Edit* changes **future** copies only; copies already created are never altered.

---

## 7. API (new endpoints; existing ones unchanged)

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/v1/projects/batch` | Create one task for several people, optionally repeating. Body = today's task fields + `assignees: [ids]` + optional `repeat: {frequency, count \| null, due_offset_days}` |
| `GET` | `/api/v1/projects/recurring` | Series the caller can manage |
| `PATCH` | `/api/v1/projects/recurring/{id}` | Pause / resume / stop / edit future copies |

**Routing in the form:**
- One person, no repeat → the **existing** `POST /projects`. The most common case uses literally unchanged code.
- Several people, or repeat → the new batch endpoint.

---

## 8. Proving nothing breaks

| Risk | How it's prevented / proven |
|---|---|
| The `add_task` refactor changes behaviour | Run the **same request matrix against the old and new code and diff the results** (the technique used for the member filter). Must be byte-identical. |
| Normal task creation changes | One person + "Once" still calls the untouched `POST /projects` |
| Old tasks affected | New fields are optional and absent on old tasks; badges render only when present |
| Index affects existing data | The unique index is *partial* — it only covers tasks with a `recurrence_id` |
| Duplicates under 2 workers | Atomic claim + unique index; tested by **running two generators at once** |
| Scheduler crash takes the app down | It runs in its own thread, errors are logged, and it retries next minute |
| Other screens break | Spawned copies are ordinary tasks; regression sweep of Overview, Projects, Leader Desk, Performance, Media Schedule |

**Test plan:**
1. **Date engine unit tests:** daily, weekly, monthly; the 31st across 30-day months; February in leap and non-leap years; the IST midnight boundary; counts; "until stopped".
2. **Integration tests** on a throwaway database:
   - batch creates N tasks with the same rules as a single one;
   - creating a series spawns copy 1;
   - the generator spawns the next copy;
   - **two concurrent generators produce zero duplicates**;
   - catch-up after downtime;
   - the series completes at N;
   - pause, resume, and stop;
   - a creator who loses rights auto-pauses the series;
   - a deactivated assignee is skipped.
3. **Before/after diff** of `POST /projects`.
4. **Browser QA:** form flows and the live summary, badges, the drawer, light and dark themes, and mobile.
5. **Full pytest** run; baseline 77 passed / 8 pre-existing failures.

---

## 9. Build order & files

| Phase | Work | Files |
|---|---|---|
| 1 | Extract `raise_task` + before/after diff proof | `services/task_factory.py` (new), `routers/projects.py` |
| 2 | Multi-assign batch endpoint | `schemas/project.py`, `routers/projects.py` |
| 3 | Series model, date engine, scheduler, manage endpoints, indexes | `services/recurrence.py` (new), `project_service.py`, `database.py`, `main.py` |
| 4 | Form: multi-assign chips + Repeat section + live summary | `AddTaskModal.tsx`, `components/projects/RepeatField.tsx` (new), `hooks/useProjects.ts`, `types/project.ts` |
| 5 | Badge, detail strip, Repeating drawer | `KanbanCard.tsx`, `TaskDetailModal.tsx`, `components/projects/RecurringDrawer.tsx` (new), `hooks/useRecurring.ts` (new) |
| 6 | Tests, browser QA, docs | `tests/test_recurrence.py`, `tests/test_batch_create.py`, history docs |

**Dependencies:** none new. The date maths uses Python's standard library (`calendar.monthrange`); the scheduler uses the existing pattern; the UI uses existing components (`UserPicker`, framer-motion, lucide). No packages or skills need installing.

---

## 10. Decisions to confirm at approval

| # | Question | Recommended |
|---|---|---|
| D1 | Does "Repeat 5" mean **5 copies in total** (today's included)? | **Yes** — the form shows the exact dates |
| D2 | Offer **"until I stop it"** (no end)? | **Yes** |
| D3 | Who may create **repeating** tasks? | **Leaders + admin roles only** |
| D4 | When does each day's copy appear? | **00:00 IST** (alternative: a chosen hour, e.g. 9 AM) |
| D5 | Server down for 2 days — create the missed copies? | **Yes**, dated correctly |
| D6 | Default due date of each copy? | **Same day**, with a "+N days" option |
| D7 | Multiple assignees → one copy per person? | **Yes** (see §3.1) |

**Pre-existing issue found during research (not part of this plan):** the daily-report
scheduler's check-then-act pattern can post twice with 2 workers (§2.4). A one-line
atomic claim fixes it — happy to do it separately.
