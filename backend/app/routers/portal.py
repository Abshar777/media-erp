"""
Server-to-server, from the Root portal only.

No session and no cookie: the caller proves itself with a shared secret,
compared in constant time so the comparison says nothing about how close a
wrong guess was.

Unconfigured means off, not open. A deployment that has not been told about
the portal must not expose its roles and its people by default.
"""

import hmac

from fastapi import APIRouter, Depends, Header
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.config import settings
from app.database import get_db
from app.services.portal_service import (
    PortalError,
    describe_user_for_portal,
    describe_many_for_portal,
    list_roles_for_portal,
    provision_from_portal,
    set_user_role_from_portal,
)
from app.utils.response import error_response, success_response

router = APIRouter(prefix="/api/v1/service", tags=["portal"])


def _guard(x_portal_secret: str | None):
    """Returns an error response when the caller is not the portal, else None."""
    expected = (settings.root_erp_secret or "").strip()
    if not expected:
        return error_response(
            "The Root portal integration is not configured — set ROOT_ERP_SECRET",
            status_code=503,
        )
    if not x_portal_secret or not hmac.compare_digest(x_portal_secret, expected):
        return error_response("Bad secret", status_code=401)
    return None


@router.get("/roles")
async def roles(
    x_portal_secret: str | None = Header(default=None),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """The roles this server has, and what each one permits."""
    refused = _guard(x_portal_secret)
    if refused:
        return refused
    try:
        return success_response(await list_roles_for_portal(db), "Roles")
    except PortalError as exc:
        return error_response(exc.message, status_code=exc.status_code)


@router.get("/user")
async def user(
    email: str = "",
    x_portal_secret: str | None = Header(default=None),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """What one account actually holds here — the portal's check against drift."""
    refused = _guard(x_portal_secret)
    if refused:
        return refused
    try:
        return success_response(await describe_user_for_portal(db, email), "Account")
    except PortalError as exc:
        return error_response(exc.message, status_code=exc.status_code)


@router.post("/set-user-role")
async def set_user_role(
    body: dict,
    x_portal_secret: str | None = Header(default=None),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """Change an existing account's role or status. Creates nothing."""
    refused = _guard(x_portal_secret)
    if refused:
        return refused
    try:
        return success_response(
            await set_user_role_from_portal(
                db, body.get("email", ""), body.get("role"), body.get("status")
            ),
            "Changed",
        )
    except PortalError as exc:
        return error_response(exc.message, status_code=exc.status_code)


@router.post("/provision-user")
async def provision_user(
    body: dict,
    x_portal_secret: str | None = Header(default=None),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """Create an account here, because a root admin asked."""
    refused = _guard(x_portal_secret)
    if refused:
        return refused
    try:
        return success_response(
            await provision_from_portal(
                db, body.get("email", ""), body.get("name", ""), body.get("role", "")
            ),
            "Account created",
        )
    except PortalError as exc:
        return error_response(exc.message, status_code=exc.status_code)


@router.post("/accounts")
async def accounts(
    body: dict,
    x_portal_secret: str | None = Header(default=None),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """
    The same question as /user, asked about many people at once.

    POST rather than GET because a page of addresses does not belong in a
    query string, where every proxy in front of this would log it.
    """
    refused = _guard(x_portal_secret)
    if refused:
        return refused
    try:
        return success_response(
            await describe_many_for_portal(db, body.get("emails")),
            "Accounts",
        )
    except PortalError as exc:
        return error_response(exc.message, status_code=exc.status_code)
