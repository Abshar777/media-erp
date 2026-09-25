"""
Fund requests — ask finance for money out of Marketing's allocation.

Not the same thing as /api/v1/budget, which is campaign ad-spend pacing inside
Media ERP. This is the request for the money itself: it goes to the finance
app, somebody there approves or rejects it, and an approval takes the amount
off Marketing's month in finance.

  view    → the page, and your own requests (elevated roles see everyone's)
  create  → make a request, and send again one finance refused
"""
from typing import Optional, Union

from fastapi import APIRouter, Depends
from motor.motor_asyncio import AsyncIOMotorDatabase
from pydantic import BaseModel

from app.database import get_db
from app.middleware.permissions import check_permission
from app.services import fund_request_service as service
from app.utils.response import error_response, success_response

router = APIRouter(prefix="/api/v1/fund-requests", tags=["fund-requests"])


class FundRequestCreate(BaseModel):
    title: str = ""
    purpose: str = ""
    platform: str = ""
    # As typed, in the currency's major unit ("1500.50"): converted to minor
    # units with Decimal on the server so no float rounding reaches finance.
    amount: Union[str, float, int] = ""
    period: str = ""  # YYYY-MM


@router.get("/meta")
async def get_meta(current_user: dict = Depends(check_permission("fund_requests", "view"))):
    return success_response(data=service.meta(current_user))


@router.get("")
async def list_fund_requests(
    scope: str = "mine",
    status: Optional[str] = None,
    current_user: dict = Depends(check_permission("fund_requests", "view")),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    return success_response(data=await service.list_requests(db, current_user, scope, status))


@router.post("")
async def create_fund_request(
    body: FundRequestCreate,
    current_user: dict = Depends(check_permission("fund_requests", "create")),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    try:
        created = await service.create_request(db, current_user, body.model_dump())
    except ValueError as exc:
        return error_response(str(exc), status_code=422)
    return success_response(data=created, message="Fund request saved", status_code=201)


@router.post("/{request_id}/retry")
async def retry_fund_request(
    request_id: str,
    current_user: dict = Depends(check_permission("fund_requests", "create")),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    try:
        doc = await service.retry_request(db, current_user, request_id)
    except LookupError as exc:
        return error_response(str(exc), status_code=404)
    except PermissionError as exc:
        return error_response(str(exc), status_code=403)
    except ValueError as exc:
        return error_response(str(exc), status_code=409)
    return success_response(data=doc, message="Sent again")
