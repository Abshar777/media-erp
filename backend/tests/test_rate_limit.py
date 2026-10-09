"""
Rate limiter — each bucket and each signed-in user has its own counter.

Production reaches the API through the Next.js rewrite on the same box, so all
users share one client IP. These tests pin the fix for "View as this user"
returning 429: ordinary traffic used to share the /auth counter, per IP.
An in-memory stand-in replaces Redis; no network or database is touched.
"""
import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app.middleware import rate_limit as rl
from app.utils.jwt import create_access_token


class FakeRedis:
    def __init__(self):
        self.n: dict[str, int] = {}

    async def incr(self, key):
        self.n[key] = self.n.get(key, 0) + 1
        return self.n[key]

    async def expire(self, key, secs):
        return True


@pytest.fixture
def client(monkeypatch):
    app = FastAPI()

    @app.api_route("/api/v1/{rest:path}", methods=["GET", "POST"])
    async def anything(rest: str):
        return {"ok": True}

    app.add_middleware(rl.RateLimitMiddleware)
    fake = FakeRedis()
    monkeypatch.setattr(rl.RateLimitMiddleware, "_get_redis", lambda self: fake)
    monkeypatch.setattr(rl, "_DEFAULT_LIMIT", 10)
    monkeypatch.setattr(rl, "_LIMITS", [("auth", "/api/v1/auth", 3), ("sync", "/api/v1/sync", 2)])
    monkeypatch.setattr(rl, "_SIGN_IN_LIMIT", 3)
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://t")


def bearer(uid: str) -> dict:
    return {"Authorization": f"Bearer {create_access_token(uid)}"}


SAME_IP = {"X-Forwarded-For": "72.60.218.158"}      # everyone, as in production


async def test_ordinary_traffic_does_not_use_up_the_auth_budget(client):
    h = {**SAME_IP, **bearer("admin")}
    for _ in range(9):                                   # lots of normal page traffic
        assert (await client.get("/api/v1/projects", headers=h)).status_code == 200
    r = await client.post("/api/v1/auth/impersonate/x", headers=h)
    assert r.status_code == 200, "auth has its own counter"
    assert r.headers["X-RateLimit-Limit"] == "3"


async def test_colleagues_behind_one_ip_have_their_own_budgets(client):
    for _ in range(10):
        await client.get("/api/v1/projects", headers={**SAME_IP, **bearer("busy")})
    assert (await client.get("/api/v1/projects", headers={**SAME_IP, **bearer("busy")})).status_code == 429
    assert (await client.get("/api/v1/projects", headers={**SAME_IP, **bearer("calm")})).status_code == 200


async def test_each_bucket_still_has_a_limit(client):
    h = {**SAME_IP, **bearer("admin")}
    codes = [(await client.post("/api/v1/auth/impersonate/x", headers=h)).status_code for _ in range(4)]
    assert codes == [200, 200, 200, 429]
    r = await client.post("/api/v1/sync/run", headers=h)
    assert r.status_code == 200
    assert (await client.post("/api/v1/sync/run", headers=h)).status_code == 200
    r = await client.post("/api/v1/sync/run", headers=h)
    assert r.status_code == 429 and 1 <= int(r.headers["Retry-After"]) <= 60


async def test_sign_in_is_counted_per_ip_and_a_fake_token_buys_nothing(client):
    codes = []
    for i in range(4):   # each attempt with a different made-up token
        r = await client.post("/api/v1/auth/login", headers={**SAME_IP, "Authorization": f"Bearer junk{i}"})
        codes.append(r.status_code)
    assert codes == [200, 200, 200, 429], "brute-force protection stays per IP"
    # A real user's token doesn't open a fresh sign-in bucket either.
    assert (await client.post("/api/v1/auth/login", headers={**SAME_IP, **bearer("x")})).status_code == 429
    # …but other IPs, and signed-in users' other auth calls, are unaffected.
    assert (await client.post("/api/v1/auth/login", headers={"X-Forwarded-For": "10.0.0.9"})).status_code == 200
    assert (await client.get("/api/v1/auth/me", headers={**SAME_IP, **bearer("x")})).status_code == 200


async def test_an_invalid_token_is_counted_by_ip_not_by_its_text(client):
    for i in range(10):
        await client.get("/api/v1/projects", headers={**SAME_IP, "Authorization": f"Bearer forged{i}"})
    r = await client.get("/api/v1/projects", headers={**SAME_IP, "Authorization": "Bearer forged-again"})
    assert r.status_code == 429, "forged tokens can't each get a fresh budget"


async def test_non_api_paths_and_the_websocket_are_not_limited(client):
    assert rl._bucket("/api/v1/auth/login")[0] == "signin"
    assert rl._bucket("/api/v1/auth/me")[0] == "auth"
    assert rl._bucket("/api/v1/sync/x")[0] == "sync"
    assert rl._bucket("/api/v1/projects")[0] == "api"
