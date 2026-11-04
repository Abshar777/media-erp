"""
My Wallet — 2026-11-04 ("the wallet on every portal").

  GET /api/v1/wallet?month=YYYY-MM — the signed-in person's own wallet, from the HRMS

The HRMS keeps it — salary a day at a time, what came off on which day and why,
commission, everything else on the payslip, what finance has paid — and finds
the person by the email they sign in here with. Open to everyone signed in, no
module on the Roles screen; only ever your own.
"""
import re

from fastapi import APIRouter, Depends, Query

from app.middleware.auth import get_current_user
from app.services import hrms_client
from app.utils.response import error_response, success_response

router = APIRouter(prefix="/api/v1/wallet", tags=["wallet"])

_MONTH = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")


@router.get("")
async def my_wallet(
    month: str | None = Query(default=None, description="YYYY-MM; this month when left out"),
    current_user: dict = Depends(get_current_user),
):
    if month and not _MONTH.match(month):
        return error_response("month must be YYYY-MM", 400)
    if not hrms_client.configured():
        return error_response("Media ERP isn't linked to the HRMS yet, so there is no wallet to show.", 503)
    email = str(current_user.get("email") or "").strip().lower()
    if not email:
        return error_response("Your account has no email to find your HRMS record with.", 400)
    try:
        wallet = await hrms_client.get_wallet(email, month)
    except hrms_client.HrmsError as exc:
        return error_response(str(exc), exc.status)
    return success_response(data=wallet, message="Your wallet")
