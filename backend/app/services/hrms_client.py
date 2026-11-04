"""
Signed calls to the HRMS's integration API — My Wallet (2026-11-04).

The same protocol the sales CRMs, Root and CS Portal use to ask the HRMS
anything: one shared client id and secret, HMAC-SHA256 over

    METHOD \\n PATH_WITH_QUERY \\n TIMESTAMP_MS \\n NONCE \\n sha256(body)

signed exactly as fetched — the HRMS checks the path and query as it receives
them, so the string signed here is the string sent. The canonical form is
finance_client's: both servers speak the same scheme.

Async (httpx.AsyncClient): its caller is a request handler, which has a loop.
"""
import secrets
import time
from urllib.parse import urlencode

import httpx

from app.config import settings
from app.services.finance_client import sign

# The HRMS may ask finance, and finance the sales CRMs, before it answers.
_TIMEOUT = httpx.Timeout(30.0, connect=5.0)


class HrmsError(Exception):
    """
    The HRMS refused, or could not be reached. `status` is the one to answer
    with: the HRMS's own for its refusals ("No HRMS employee has this email"
    is a 404), 503 when it is down or out of reach, 502 when it refuses this
    server's credentials — never 401, which the browser would read as the
    person's own session ending.
    """

    def __init__(self, message: str, status: int):
        super().__init__(message)
        self.status = status


def configured() -> bool:
    return all([settings.hrms_api_url, settings.hrms_client_id, settings.hrms_integration_secret])


def _origin() -> str:
    """Trailing slashes and a trailing /api/v1 both stripped — the path carries it."""
    base = settings.hrms_api_url.strip().rstrip("/")
    return base[: -len("/api/v1")] if base.endswith("/api/v1") else base


def wallet_path(email: str, month: str | None = None) -> str:
    """The path and query as sent and signed."""
    query = {"email": email, **({"month": month} if month else {})}
    return f"/api/v1/integrations/wallet?{urlencode(query)}"


def signed_headers(method: str, path: str, raw_body: str = "") -> dict:
    timestamp = str(int(time.time() * 1000))
    nonce = secrets.token_hex(16)
    return {
        "x-delta-client": settings.hrms_client_id,
        "x-delta-timestamp": timestamp,
        "x-delta-nonce": nonce,
        "x-delta-signature": sign(settings.hrms_integration_secret, method, path, timestamp, nonce, raw_body),
    }


async def get_wallet(email: str, month: str | None = None) -> dict:
    """Somebody's wallet for a month (this one when none is given), by their sign-in email."""
    path = wallet_path(email, month)
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            res = await client.get(f"{_origin()}{path}", headers=signed_headers("GET", path))
    except httpx.HTTPError as exc:
        raise HrmsError("The HRMS could not be reached — try again in a moment", 503) from exc

    try:
        body = res.json()
    except ValueError:
        body = None
    said = body.get("message").strip() if isinstance(body, dict) and isinstance(body.get("message"), str) else ""

    if res.status_code == 401:
        raise HrmsError("The HRMS refused this server's credentials (HRMS_CLIENT_ID / HRMS_INTEGRATION_SECRET)", 502)
    if res.status_code >= 500:
        raise HrmsError(f"The HRMS isn't answering right now ({res.status_code}) — try again in a moment", 503)
    if res.status_code >= 400:
        raise HrmsError(said or f"The HRMS refused this ({res.status_code})", res.status_code)
    if not isinstance(body, dict) or "data" not in body:
        raise HrmsError("The HRMS's answer wasn't its API — check HRMS_API_URL", 502)
    return body["data"]
