"""
GET /api/v1/wallet — My Wallet, from the HRMS (2026-11-04).

The signed HRMS client (the canonical string, signed exactly as sent) and the
route's answers: not linked, bad month, no email, and the HRMS's own answers
passed through — over a mocked HTTP connection that checks every signature the
way the HRMS does. No database, no network.
"""
import hashlib
import hmac
import json
from urllib.parse import unquote

import httpx
import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app.config import settings
from app.middleware.auth import get_current_user
from app.routers import wallet as wallet_router
from app.services import hrms_client
from app.services.finance_client import build_canonical

SECRET = "test-hrms-secret-that-is-long-enough"
CLIENT = "test-portals"
_REAL_ASYNC_CLIENT = httpx.AsyncClient
WALLET = {"employee": {"employeeCode": "E2E001"}, "status": "part_paid", "totals": {"balance": 6705}}


def _app(user: dict) -> FastAPI:
    app = FastAPI()
    app.include_router(wallet_router.router)
    app.dependency_overrides[get_current_user] = lambda: user
    return app


@pytest.fixture
def linked(monkeypatch):
    monkeypatch.setitem(settings.__dict__, "hrms_api_url", "http://hrms.test/api/v1/")
    monkeypatch.setitem(settings.__dict__, "hrms_client_id", CLIENT)
    monkeypatch.setitem(settings.__dict__, "hrms_integration_secret", SECRET)


def _hrms(monkeypatch, answer):
    """Stand in for the HRMS: refuse anything not signed as it checks, else answer."""
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.raw_path.decode()
        h = request.headers
        expected = hmac.new(
            SECRET.encode(),
            build_canonical("GET", path, h["x-delta-timestamp"], h["x-delta-nonce"], "").encode(),
            hashlib.sha256,
        ).hexdigest()
        if h.get("x-delta-client") != CLIENT or h.get("x-delta-signature") != expected:
            return httpx.Response(401, json={"success": False, "message": "Unauthorized"})
        seen.append(path)
        return answer(request)

    monkeypatch.setattr(hrms_client.httpx, "AsyncClient", lambda **kw: _REAL_ASYNC_CLIENT(transport=httpx.MockTransport(handler), **kw))
    return seen


async def _get(user: dict, query: str = ""):
    async with AsyncClient(transport=ASGITransport(app=_app(user)), base_url="http://test") as c:
        return await c.get(f"/api/v1/wallet{query}")


ME = {"_id": "u1", "email": " Asha@Example.COM "}


def test_canonical_string_is_the_hrms_one():
    body_hash = hashlib.sha256(b"").hexdigest()
    assert build_canonical("get", "/api/v1/integrations/wallet?email=a%40b.io", "1", "n", "") == \
        f"GET\n/api/v1/integrations/wallet?email=a%40b.io\n1\nn\n{body_hash}"


def test_wallet_path_and_origin(linked):
    assert hrms_client.wallet_path("a@b.io") == "/api/v1/integrations/wallet?email=a%40b.io"
    assert hrms_client.wallet_path("a@b.io", "2026-10") == "/api/v1/integrations/wallet?email=a%40b.io&month=2026-10"
    assert hrms_client._origin() == "http://hrms.test"


async def test_not_linked_is_503(monkeypatch):
    for key in ("hrms_api_url", "hrms_client_id", "hrms_integration_secret"):
        monkeypatch.setitem(settings.__dict__, key, "")
    res = await _get(ME)
    assert res.status_code == 503
    assert "isn't linked to the HRMS" in res.json()["message"]


async def test_bad_month_and_no_email(linked):
    assert (await _get(ME, "?month=2026-13")).status_code == 400
    res = await _get({"_id": "u2", "email": ""})
    assert res.status_code == 400 and "no email" in res.json()["message"]


async def test_own_wallet_by_sign_in_email(linked, monkeypatch):
    seen = _hrms(monkeypatch, lambda r: httpx.Response(200, json={"success": True, "message": "Wallet", "data": WALLET}))
    res = await _get(ME, "?month=2026-10")
    assert res.status_code == 200
    assert res.json()["data"] == WALLET
    # Signed and sent for the signed-in person, lower-cased — never an address from the request.
    assert [unquote(p) for p in seen] == ["/api/v1/integrations/wallet?email=asha@example.com&month=2026-10"]


async def test_hrms_404_passes_through(linked, monkeypatch):
    _hrms(monkeypatch, lambda r: httpx.Response(404, json={"success": False, "message": "No HRMS employee has this email."}))
    res = await _get(ME)
    assert res.status_code == 404
    assert res.json()["message"] == "No HRMS employee has this email."


async def test_refused_credentials_are_502_not_401(linked, monkeypatch):
    _hrms(monkeypatch, lambda r: httpx.Response(200, json={"data": WALLET}))
    monkeypatch.setitem(settings.__dict__, "hrms_integration_secret", "wrong")
    res = await _get(ME)
    assert res.status_code == 502 and "credentials" in res.json()["message"]


async def test_hrms_down_or_not_its_api(linked, monkeypatch):
    def boom(request):
        raise httpx.ConnectError("refused", request=request)
    _hrms(monkeypatch, boom)
    assert (await _get(ME)).status_code == 503
    _hrms(monkeypatch, lambda r: httpx.Response(502, text="bad gateway"))
    assert (await _get(ME)).status_code == 503
    _hrms(monkeypatch, lambda r: httpx.Response(200, text="<html>maintenance</html>"))
    res = await _get(ME)
    assert res.status_code == 502 and "HRMS_API_URL" in res.json()["message"]
