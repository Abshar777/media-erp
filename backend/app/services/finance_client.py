"""
Signed calls to the finance app's integration API.

The same protocol the sales CRMs use to hand enrolments over — one shared
client id and secret, HMAC-SHA256 over

    METHOD \\n PATH \\n TIMESTAMP_MS \\n NONCE \\n sha256(body)

— so finance needs no new credential to accept Media ERP. Its counterpart is
finance's apps/api/src/lib/signing.ts: change one and you must change both, or
every call fails with a bare 401 and no clue as to why.

Blocking (httpx.Client), because its callers are the fund-request worker
thread and asyncio.to_thread — neither has an event loop to lend it.
"""
import hashlib
import hmac
import json
import secrets
import time

import httpx

from app.config import settings

_TIMEOUT = httpx.Timeout(15.0, connect=5.0)


class FinanceNotConfigured(Exception):
    """A FINANCE_* setting is blank, so nothing was sent."""


class FinanceError(Exception):
    """
    Finance refused the call, or could not be reached.

    `permanent` means finance looked at the request and said no (a 4xx other
    than an authentication failure): sending the same thing again would fail
    the same way, so it should not be retried until somebody changes it.
    """

    def __init__(self, message: str, status: int | None = None, permanent: bool = False):
        super().__init__(message)
        self.status = status
        self.permanent = permanent


def configured() -> bool:
    return all([
        settings.finance_api_url,
        settings.finance_client_id,
        settings.finance_integration_secret,
        settings.finance_org_id,
        settings.finance_department_id,
    ])


def build_canonical(method: str, path: str, timestamp: str, nonce: str, raw_body: str) -> str:
    body_hash = hashlib.sha256(raw_body.encode("utf-8")).hexdigest()
    return "\n".join([method.upper(), path, timestamp, nonce, body_hash])


def sign(secret: str, method: str, path: str, timestamp: str, nonce: str, raw_body: str) -> str:
    canonical = build_canonical(method, path, timestamp, nonce, raw_body)
    return hmac.new(secret.encode("utf-8"), canonical.encode("utf-8"), hashlib.sha256).hexdigest()


def _origin() -> str:
    """
    Trailing slashes and a trailing /api/v1 both stripped — the path carries
    it — so FINANCE_API_URL can hold exactly the value the CRMs are given.
    """
    base = settings.finance_api_url.strip().rstrip("/")
    return base[: -len("/api/v1")] if base.endswith("/api/v1") else base


def _post(path: str, payload: dict):
    if not configured():
        raise FinanceNotConfigured("Finance is not configured on this server (FINANCE_* settings)")

    # Signed byte-for-byte as sent: finance hashes the raw body it receives,
    # so the bytes hashed here must be exactly the bytes on the wire.
    raw = json.dumps(payload, separators=(",", ":"), ensure_ascii=False)
    timestamp = str(int(time.time() * 1000))
    nonce = secrets.token_hex(16)
    headers = {
        "content-type": "application/json",
        "x-delta-client": settings.finance_client_id,
        "x-delta-timestamp": timestamp,
        "x-delta-nonce": nonce,
        "x-delta-signature": sign(settings.finance_integration_secret, "POST", path, timestamp, nonce, raw),
        "x-delta-org": settings.finance_org_id,
    }

    try:
        with httpx.Client(timeout=_TIMEOUT) as client:
            res = client.post(f"{_origin()}{path}", content=raw.encode("utf-8"), headers=headers)
    except httpx.HTTPError as exc:
        raise FinanceError(f"Finance could not be reached: {exc.__class__.__name__}") from exc

    try:
        body = res.json()
    except ValueError:
        body = {}

    if res.status_code >= 400:
        err = (body or {}).get("error") or {}
        message = err.get("message") or f"Finance answered {res.status_code}"
        # Say which field, when finance says: "Request validation failed" on
        # its own leaves nobody able to fix anything. Finance sends zod's
        # fieldErrors — {field: [messages]}.
        details = err.get("details")
        if isinstance(details, dict) and details:
            fields = ", ".join(
                f"{field}: {msgs[0] if isinstance(msgs, list) and msgs else msgs}"
                for field, msgs in list(details.items())[:5]
            )
            message = f"{message} ({fields})"
        # 401/503 are this server's credentials or finance's switch, not the
        # request: fix the configuration and the same request goes through.
        permanent = 400 <= res.status_code < 500 and res.status_code not in (401, 408, 429)
        raise FinanceError(message, status=res.status_code, permanent=permanent)

    return (body or {}).get("data")


def submit_fund_request(payload: dict) -> dict:
    """Hand one request over. Idempotent on payload['externalId'] at finance."""
    return _post("/api/v1/integrations/funding-requests", payload) or {}


def fund_request_statuses(source: str, external_ids: list[str]) -> list[dict]:
    """What became of the requests handed over, by our own ids (≤ 200)."""
    if not external_ids:
        return []
    return _post(
        "/api/v1/integrations/funding-requests/status",
        {"source": source, "externalIds": external_ids[:200]},
    ) or []
