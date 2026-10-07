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
