"""
Rate-limit middleware — fixed-window counter backed by Redis.

Limits (per 60-second window), each bucket counted SEPARATELY:
  • Sign-in endpoints (login, register, refresh, password reset, SSO):
                           60 requests per client IP   (brute-force protection)
  • Other /api/v1/auth:   60 requests per signed-in user
  • /api/v1/sync:         30 requests per signed-in user (expensive syncs)
  • Everything else:     300 requests per signed-in user

Who is counted
--------------
A request with a valid access token is counted against its USER (the token's
signature is verified, so it can't be forged to dodge a limit). Anything else
is counted against the client IP. This matters in production: every request
reaches the API through the Next.js rewrite on the same server, so the whole
company shares ONE IP — per-IP counting made colleagues use up each other's
budget (and one shared counter for all buckets meant 60 ordinary requests in a
minute were enough to 429 every /auth call, e.g. "View as this user").

All limits are soft-fail: if Redis is unavailable the request passes through.

Headers returned on every request:
  X-RateLimit-Limit    — window limit for this bucket
  X-RateLimit-Remaining — remaining requests in this window
  X-RateLimit-Reset    — UTC epoch seconds when the window resets
"""
import hashlib
import time
import logging
from typing import Callable

from fastapi import Request, Response
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.types import ASGIApp

from app.config import settings

logger = logging.getLogger(__name__)

# ── Buckets ───────────────────────────────────────────────────────────────────

# Reachable without being signed in → always counted per IP, never per token
# (a made-up Authorization header must not buy a fresh bucket).
_SIGN_IN_PATHS = (
    "/api/v1/auth/login", "/api/v1/auth/register", "/api/v1/auth/refresh",
    "/api/v1/auth/forgot-password", "/api/v1/auth/reset-password", "/api/v1/auth/sso-login",
)

_LIMITS: list[tuple[str, str, int]] = [
    # (bucket, path_prefix, max_requests_per_window)
    ("auth", "/api/v1/auth", 60),
    ("sync", "/api/v1/sync", 30),
]
_SIGN_IN_LIMIT = 60
_DEFAULT_LIMIT = 300
_WINDOW_SECS   = 60


def _bucket(path: str) -> tuple[str, int]:
    if path.startswith(_SIGN_IN_PATHS):
        return "signin", _SIGN_IN_LIMIT
    for name, prefix, limit in _LIMITS:
        if path.startswith(prefix):
            return name, limit
    return "api", _DEFAULT_LIMIT


def _get_limit(path: str) -> int:
    return _bucket(path)[1]


def _client_ip(request: Request) -> str:
    return (
        request.headers.get("X-Forwarded-For", "").split(",")[0].strip()
        or request.headers.get("X-Real-IP", "")
        or (request.client.host if request.client else "unknown")
    )


def _identity(request: Request, bucket: str) -> str:
    """'u:<user id>' for a request with a valid access token, else 'ip:<address>'."""
    if bucket != "signin":
        auth = request.headers.get("Authorization", "")
        if auth[:7].lower() == "bearer ":
            try:
                from app.utils.jwt import decode_access_token
                sub = decode_access_token(auth[7:].strip()).get("sub")
                if sub:
                    # Hashed so user ids don't sit in Redis key names / logs.
                    return "u:" + hashlib.sha256(str(sub).encode()).hexdigest()[:16]
            except Exception:
                pass                              # expired / invalid → count by IP
    return "ip:" + _client_ip(request)


class RateLimitMiddleware(BaseHTTPMiddleware):
    """
    Starlette middleware that enforces per-user (else per-IP) fixed-window rate
    limits using Redis INCR + EXPIRE.  Falls back to allow-all when Redis is unavailable.
    """

    # When Redis is unreachable, stop hammering it (each dead call costs a full
    # socket_connect_timeout). Skip Redis entirely for this many seconds, then
    # probe once more — so the limiter self-heals when Redis comes back.
    _COOLDOWN_SECS = 30.0

    def __init__(self, app: ASGIApp) -> None:
        super().__init__(app)
        self._redis = None
        self._init_failed = False
        self._cooldown_until = 0.0   # monotonic deadline; >now means "skip Redis"

    def _get_redis(self):
        if self._init_failed:
            return None
        # Circuit breaker: while in cooldown, don't touch Redis at all.
        if time.monotonic() < self._cooldown_until:
            return None
        if self._redis is not None:
            return self._redis
        try:
            import redis.asyncio as aioredis
            self._redis = aioredis.from_url(
                settings.redis_url,
                encoding="utf-8",
                decode_responses=True,
                socket_connect_timeout=1,
                socket_timeout=1,
            )
        except Exception as exc:
            logger.warning("RateLimit: Redis init failed — rate limiting disabled: %s", exc)
            self._init_failed = True
        return self._redis

    def _trip_breaker(self, exc: Exception) -> None:
        """Open the circuit for _COOLDOWN_SECS after a Redis failure."""
        self._cooldown_until = time.monotonic() + self._COOLDOWN_SECS
        logger.warning(
            "RateLimit: Redis unreachable — pausing rate limiting for %.0fs: %s",
            self._COOLDOWN_SECS, exc,
        )

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        path = request.url.path

        # Skip non-API paths (uploads, WebSocket, docs)
        if not path.startswith("/api/v1/") or path.startswith("/api/v1/chat/ws"):
            return await call_next(request)

        redis = self._get_redis()
        if redis is None:
            return await call_next(request)

        bucket, limit = _bucket(path)
        who   = _identity(request, bucket)
        now   = int(time.time())
        window_start = now - (now % _WINDOW_SECS)  # align to window boundary
        # One counter per bucket AND per person: ordinary traffic can't use up
        # the auth budget, and colleagues behind the same IP don't share one.
        key   = f"rl:{bucket}:{who}:{window_start}"
        reset = window_start + _WINDOW_SECS

        try:
            count = await redis.incr(key)
            if count == 1:
                await redis.expire(key, _WINDOW_SECS + 5)  # +5 s buffer
        except Exception as exc:
            # Open the circuit so the next requests skip Redis instead of each
            # paying the full connect timeout.
            self._trip_breaker(exc)
            return await call_next(request)

        remaining = max(0, limit - count)
        headers = {
            "X-RateLimit-Limit":     str(limit),
            "X-RateLimit-Remaining": str(remaining),
            "X-RateLimit-Reset":     str(reset),
        }

        if count > limit:
            if count == limit + 1:                 # once per window, not per rejected request
                logger.warning("RateLimit: %s over the %s limit (%d/min) on %s", who, bucket, limit, path)
            return JSONResponse(
                status_code=429,
                content={
                    "success": False,
                    "message": "Too many requests — please slow down and try again shortly.",
                    "data": None,
                },
                headers={**headers, "Retry-After": str(max(1, reset - now))},
            )

        response = await call_next(request)
        for k, v in headers.items():
            response.headers[k] = v
        return response
