# Backend Mistakes Log

> Every bug found during development goes here — read this before writing any similar code.
> Format: **Date · Feature · Bug · Root Cause · Fix · How to Avoid**

---

## How to use

Before writing code, scan this file for patterns that match what you're about to do.
If a mistake is listed here, do NOT repeat it.

---

## Log

### 2026-10-09 · Ad Reports · Two simultaneous deletes both succeeded
- **Bug:** Two leaders deleting the same report at the same moment both got 200 — two trash copies, two Undo toasts, a doubled "report deleted" line on its flag.
- **Root Cause:** `delete_report` read the report, copied it to the trash, then deleted it — no claim, so both requests copied before either deleted.
- **Fix:** Atomically claim each report first (`find_one_and_update` setting `deleting: {batch, at}` only when unclaimed or the claim is older than `DELETE_CLAIM_TTL` = 10 min, so a crashed delete frees it); the loser gets 409. The trash copy drops `deleting`. Tests: `test_two_deletes_at_once_make_one_trash_entry`, `test_a_stale_delete_claim_expires` (both fail without the claim).
- **How to Avoid:** Any read → copy → delete sequence needs an atomic claim (or a single atomic operation) before the copy.


### 2026-05-05 · Feature 1.2 · pymongo version conflict

**Bug:** `pip install -r requirements.txt` failed with `ResolutionImpossible`.

**Root cause:** `requirements.txt` pinned `pymongo==4.10.1` but `motor==3.6.0` requires `pymongo>=4.9,<4.10`.

**Fix:** Changed to `pymongo==4.9.2`.

**How to avoid:** Always check motor's pymongo constraint with `pip install motor==X.Y.Z --dry-run | grep pymongo` before pinning pymongo independently.

---

### 2026-05-05 · Feature 1.8 · `patch()` doesn't intercept FastAPI `Depends()`

**Bug:** Tests using `patch("app.middleware.auth.get_db", return_value=mock_db)` still called the real `get_db` and raised `RuntimeError: Database not connected`.

**Root cause:** `Depends(get_db)` captures the function object at route-definition time. Patching the module attribute afterward doesn't change the reference FastAPI already holds.

**Fix:** Use `app.dependency_overrides[get_db] = override_fn`.

**How to avoid:** Always use `app.dependency_overrides` to mock FastAPI dependencies in tests. Never use `patch()` on a function passed into `Depends()`.

---

### 2026-05-06 · Feature 6.1 · Gemini model not found / quota exceeded

**Bug:** `POST /ai/query` returned 500. Two distinct errors encountered back-to-back:
1. `404 models/gemini-1.5-flash is not found for API version v1beta`
2. `429 You exceeded your current quota, limit: 0, model: gemini-2.0-flash`

**Root cause:**
- `gemini-1.5-flash` was deprecated and removed from the v1beta API entirely.
- `gemini-2.0-flash` exists in the API response from `genai.list_models()` but has a quota limit of 0 on the free tier — requests immediately 429.
- The AI service was initialised with a hardcoded model name without verifying free-tier availability.

**Fix:** Iterated over available model names via `genai.list_models()` and tested each with a minimal prompt. `gemini-2.5-flash` responded correctly and is used as the final model for both pipeline generation and explanation.

**How to avoid:**
- Never hardcode a Gemini model name; pick it from a config env var (`GEMINI_MODEL`) so it can be changed without code changes.
- When onboarding a new Gemini model, call `list_models()` first, then issue a test prompt before committing the name.
- Check free-tier quota limits on console.cloud.google.com before assuming a listed model is usable.

---

### 2026-05-06 · Feature 7.1 · 405 on `PUT /auth/me` after adding endpoint

**Bug:** `PUT /api/v1/auth/me` returned `405 Method Not Allowed` immediately after the router was wired up.

**Root cause:** The uvicorn dev server was running without `--reload` and had not detected the file change. The old process still served the old route table.

**Fix:** Killed all Python processes (`Stop-Process -Name python -Force`) and restarted uvicorn.

**How to avoid:** Always run uvicorn with `--reload` in development. If a newly added route returns 405 or 404 and the code looks correct, restart the server before debugging further.

---

### 2026-05-07 · Feature 8.4 · Railway PORT env var

**Bug (anticipated):** Binding gunicorn to hardcoded `0.0.0.0:8000` will fail on Railway — Railway injects a dynamic `$PORT` env var that the process must listen on.

**Fix:** Changed Dockerfile CMD to use `${PORT:-8000}` (shell form — allows env substitution). Also updated the HEALTHCHECK to read `$PORT` via `os.environ.get('PORT', '8000')`.

**How to avoid:** Never hardcode a port in any production Dockerfile. Always use `${PORT:-default}` pattern or read from env.

---
