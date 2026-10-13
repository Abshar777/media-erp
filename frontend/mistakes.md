# Frontend Mistakes Log

> Every bug or wrong pattern found during development goes here.
> Read this before writing any similar code.
> Format: **Date · Feature · Bug · Root Cause · Fix · How to Avoid**

---

## How to use

Before writing a component or hook, scan for patterns matching what you're about to do.
If a mistake is listed, do NOT repeat it.

---

## Log

### 2026-10-12 · SelectField · A click outside an open list closed the dialog behind it
- **Bug (QA):** with a dropdown open in Add Task (or any dialog), clicking the dimmed area closed the whole dialog and lost what was typed; a click on a dialog button would run it.
- **Root Cause:** Base UI Select (modal by default) adds a full-screen click-catcher next to the list, inside the portal. Only the Positioner had `z-[100]`; the catcher had no z-index, so it sat *under* the dialog's `z-50` backdrop.
- **Fix:** the stacking layer is the portal itself — `<Select.Portal className="relative z-[100]">`. First click outside now only closes the list (like native).
- **How to Avoid:** when a popup library adds its own backdrop/overlay, put the z-index on the common container (portal), not on the positioned popup alone. Test "click outside while open" inside a dialog.

### 2026-10-12 · SelectField · Tab from an open list jumped to the top of the dialog; Esc sometimes left focus in the closed list
- **Bug (QA):** in Ad Reports dialogs (`ModalShell` focus trap), Tab with a list open moved focus to the dialog's first field. After Esc, focus sometimes stayed on a hidden option.
- **Root Cause:** focus is inside the portalled popup (outside the dialog panel), so the trap treated it as "outside"; closing via our own Esc handler didn't always return focus.
- **Fix:** Tab while open closes the list and focuses the field (no `preventDefault`, so the browser moves on from there); Esc also focuses the field.
- **How to Avoid:** popups portalled out of a focus-trapped dialog must hand focus back to their trigger before the trap sees the key.

### 2026-10-12 · SelectField · Esc in a dropdown also closed what it sits in
- **Bug (QA, found before release):** with the new dropdown inside an inline edit row (Projects manager → Group) or the Recurring drawer, Esc would close the list *and* the row/drawer.
- **Root Cause:** Base UI closes the list from a `document` keydown listener. React `onKeyDown` handlers on parents run earlier (React listens on the root/portal container, below `document`), and a `document` listener registered earlier (the drawer's) runs first too.
- **Fix:** `SelectField` handles Esc itself on the trigger and the popup while open (`preventDefault` + `stopPropagation` + close); RecurringDrawer listens on `window` like the other dialogs.
- **How to Avoid:** For "Esc closes this", listen on `window` (not `document`). Anything that opens a nested layer must swallow its own Esc before it bubbles.

### 2026-10-12 · SelectField · Colour dot invisible in the list
- **Bug:** team/priority dots showed on the trigger but not in the options.
- **Root Cause:** the dot is a `<span>` with `size-2` inside a non-flex `<span>` — an inline element ignores width/height.
- **Fix:** `block size-2` on the dot.
- **How to Avoid:** give sized decorative spans `block`/`inline-block` unless they're a flex/grid child.

### 2026-10-10 · ProjectPicker · Fast "type, Enter" picked nothing
- **Bug (QA):** clearing the search, typing a name and pressing Enter quickly sometimes ticked nothing.
- **Root Cause:** the highlighted row was reset in an effect after render; an Enter arriving first used an index from the previous (unfiltered) results — out of range for the new ones.
- **Fix:** reset the highlight in the search input's onChange (same update as the text), and clamp the index on Enter.
- **How to Avoid:** keep keyboard-selection state in step with the list in the same event, not in a later effect.


### 2026-10-09 · Ad Reports · "+ Add team" options invisible in dark mode
- **Bug:** The team list opened white with near-invisible light text (Windows, dark theme).
- **Root Cause:** "+ Add team" was a transparent native `<select>` (opacity 0 over a pill). Windows draws a native option list with the select's background — transparent → white — while the text color is inherited from the dark theme (light). Nothing told the browser the page was dark (`color-scheme` unset).
- **Fix:** In-form `TeamList` drawn by the app (search when >6 teams, colour dots, member counts, Escape/Done). App-wide: `:root{color-scheme:light}` / `.dark{color-scheme:dark}` and `option, optgroup` use `--popover` / `--popover-foreground` (globals.css), so every remaining native select/date picker follows the theme.
- **How to Avoid:** Don't hide a native `<select>` behind a custom pill; build the list in-app, or give the select a real themed background. Keep `color-scheme` set per theme.


### 2026-10-09 · Ad Reports · Undo didn't re-open the restored report
- **Bug:** After Delete → Undo the report came back in the list, but the page stayed on another report.
- **Root Cause:** The restore's `onSuccess` started the list refetch without awaiting it, then the caller selected the id. In that render the list didn't have it yet and the page's "nothing selected → first report" fallback replaced the selection. Also, `mutate(…, { onSuccess })` callbacks are skipped when the component that called `mutate` has unmounted (the delete dialog unmounts if the page lands on an account).
- **Fix:** `onSuccess: async () => { await qc.invalidateQueries(...) }` (TanStack awaits it before the caller's callbacks) and `restore.mutateAsync(batch).then(select)`.
- **How to Avoid:** When a mutation's result must be followed by selecting/navigating to something that only appears after a refetch, await the refetch in the hook's `onSuccess`, and use `mutateAsync().then` (not per-call callbacks) for anything that must run even if the caller unmounts.


### 2026-05-05 · Feature 1.14 · `middleware.ts` deprecated in Next.js 16
- **Bug:** `middleware.ts` / `export function middleware()` caused a deprecation warning and did not run correctly.
- **Root Cause:** Next.js 16 renamed the file convention from `middleware` to `proxy`. The exported function must also be named `proxy`.
- **Fix:** Delete `middleware.ts`, create `proxy.ts` with `export function proxy(request: NextRequest)`.
- **How to Avoid:** In this project use `proxy.ts` at the repo root. Never create `middleware.ts`.

### 2026-05-05 · Feature 1.11 · Axios 401 interceptor fires on wrong-credentials login
- **Bug:** After a successful registration, attempting to log in with wrong credentials redirected to `/login` instead of showing an error toast.
- **Root Cause:** The 401 interceptor guard checked `localStorage.getItem("access_token")` — which is truthy after registration — so any 401 (including expected wrong-credentials responses from `/auth/login`) triggered the session-expiry redirect.
- **Fix:** Added `!isAuthEndpoint` check using `/\/auth\/(login|register)/.test(url)`. Auth-endpoint 401s are now passed through to the mutation's `onError` handler.
- **How to Avoid:** When guarding a 401 interceptor redirect, always exclude endpoints that legitimately return 401 as part of their normal contract (login, register).

---
