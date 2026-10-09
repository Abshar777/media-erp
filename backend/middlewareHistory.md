# Backend Middleware & Dependency History

> Tracks every FastAPI dependency, middleware, and the correct injection chain.
> Read this before adding any route — wrong dependency order causes 422/401/500 silently.

---

## How to use

1. Before adding a protected route, check the **Dependency Chain** section below.
2. Before creating a new dependency, check it doesn't duplicate an existing one.
3. After adding a dependency, document it here.

---

## Dependency Chain (auth flow)

```
Request
  └─► get_db()                        → yields AsyncIOMotorDatabase         [database.py]
        └─► get_current_user(db, token) → returns User doc or raises 401     [middleware/auth.py]
              └─► require_plan(plan)    → raises 403 if user.plan insufficient [middleware/permissions.py]
```

### Usage in routers

```python
# Public endpoint — no auth
@router.get("/health")
async def health(): ...

# Authenticated endpoint
@router.get("/me")
async def me(user: User = Depends(get_current_user)): ...

# Plan-gated endpoint
@router.post("/ai/query")
async def ai_query(
    user: User = Depends(require_plan("pro")),
): ...
```

---

## Registered Middleware (app/main.py)

| Order | Middleware | Config |
|-------|-----------|--------|
| 1 | `CORSMiddleware` | origins from `settings.allowed_origins`, credentials=True, all methods/headers |

---

## Dependencies

### `get_current_user` (feature 1.8)
- **File:** `app/middleware/auth.py`
- **Signature:** `async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(_bearer), db = Depends(get_db)) -> dict`
- **Returns:** User document dict from MongoDB
- **Raises:** `HTTP 401` on invalid/expired token, unknown user, or inactive user; `HTTP 403` when Authorization header is missing entirely (HTTPBearer behaviour)

### `require_plan(min_plan: str)` (feature 1.8)
- **File:** `app/middleware/permissions.py`
- **Returns:** A FastAPI dependency function
- **Raises:** `HTTP 403` if `user["plan"]` rank < `min_plan` rank
- **Plan ranks:** `free=0`, `pro=1`, `enterprise=2`

### ⚠️ Test pattern (from mistakes.md)
Always use `app.dependency_overrides[get_db] = fn` — never `patch()` on a `Depends()` target.

---

## CORS Notes

- `allowed_origins` is a comma-separated string in `.env` → split on `,` in `main.py`
- Always include `http://localhost:3000` for local dev
- Production: set to exact frontend domain (no trailing slash)

---

### Rate limiter — per bucket and per user (2026-10-09)
- **File:** `app/middleware/rate_limit.py`. Buckets counted separately: `signin` (login, register, refresh, forgot/reset password, sso-login — 60/min per IP), `auth` (other /auth — 60/min per user), `sync` (30/min per user), `api` (300/min per user). Identity = verified access-token `sub` (hashed) else client IP. Fixes production 429s on /auth/impersonate: all users share one IP behind the Next.js rewrite, and ordinary traffic used to fill the /auth counter. Tests: `tests/test_rate_limit.py`.
