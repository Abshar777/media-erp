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
