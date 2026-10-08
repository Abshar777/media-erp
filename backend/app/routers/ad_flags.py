"""
"Ad not performing" — rules live in services/ad_flag_service.py; this is
permissions + I/O.

  GET   /api/v1/ad-reports/{id}/flag-draft  everything the dialog needs
  POST  /api/v1/ad-reports/{id}/flags       send it to a team leader
  GET   /api/v1/ad-flags/inbox              Leader Desk → Ads to redo
  GET   /api/v1/ad-flags/{id}               one flag
  PATCH /api/v1/ad-flags/{id}               start | done | decline | withdraw
"""
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query
from motor.motor_asyncio import AsyncIOMotorDatabase
from pydantic import BaseModel, Field

from app.database import get_db
from app.middleware.auth import get_current_user
from app.services import ad_flag_service as fl
from app.services import ad_report_service as ar
from app.utils.response import error_response, success_response

router = APIRouter(prefix="/api/v1", tags=["ad-flags"])
NOT_FOUND = "Ad report not found."


class CreateFlagRequest(BaseModel):
    recipient_id: str = Field(min_length=1, max_length=64)
    recipient_team_id: str = Field(min_length=1, max_length=64)
    reasons: list[str] = Field(default_factory=list, max_length=len(fl.REASONS))
    note: str = Field(default="", max_length=fl.NOTE_MAX * 2)


class FlagActionRequest(BaseModel):
    action: str = Field(pattern="^(start|done|decline|withdraw)$")
    note: str = Field(default="", max_length=fl.NOTE_MAX * 2)


async def _report_for(db, report_id: str, user: dict):
    """The ad, when this user may work on it — else None (same 404 as a missing id)."""
    from bson import ObjectId
    if not ObjectId.is_valid(report_id):
        return None
    r = await db[ar.REPORTS].find_one({"_id": ObjectId(report_id)})
    if not r or not await ar.can_enter(db, user, r):
        return None
    return r


@router.get("/ad-reports/{report_id}/flag-draft")
async def flag_draft(
    report_id: str,
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    r = await _report_for(db, report_id, current_user)
    if not r:
        return error_response(NOT_FOUND, status_code=404)
    if ar.is_account(r):
        return error_response("Flag the ad inside this account, not the account.", status_code=409)
    uid = str(current_user["_id"])
    directory = await fl.leader_directory(db, exclude_uid=uid)
    active = await db[fl.FLAGS].find_one({"report_id": report_id, "active": True})
    return success_response(data={
        "recipients": directory,
        "default": await fl.default_recipient(db, report_id, uid, directory),
        "reasons": [{"key": k, "label": v} for k, v in fl.REASONS.items()],
        "snapshot": await fl.snapshot(db, r),
        "active_flag": await fl.serialize(db, active, current_user, r) if active else None,
    }, message="Ready")


@router.post("/ad-reports/{report_id}/flags", status_code=201)
async def create_flag(
    report_id: str,
    body: CreateFlagRequest,
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    r = await _report_for(db, report_id, current_user)
    if not r:
        return error_response(NOT_FOUND, status_code=404)
    try:
        flag = await fl.create(db, current_user, r, body.recipient_id, body.recipient_team_id, body.reasons, body.note)
    except fl.FlagError as exc:
        return error_response(exc.message, status_code=exc.status_code)
    who = flag.get("recipient_name") or "the team leader"
    return success_response(data=await fl.serialize(db, flag, current_user, r),
                            message=f"Sent to {who} — it's in their Leader Desk → Ads to redo", status_code=201)


@router.get("/ad-flags/inbox")
async def inbox(
    scope: str = Query(default="to_me", pattern="^(to_me|sent|all)$"),
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """
    Leader Desk → Ads to redo. `to_me`: sent to me to recreate · `sent`: what I
    sent · `all`: every flag (admin roles only — anyone else gets `to_me`).
    The open ones plus those closed in the last 14 days, and per-scope counts of
    open flags so the desk can open on the view that has something in it.
    """
    uid = str(current_user["_id"])
    elevated = ar.is_elevated(current_user)
    by_scope = {"to_me": {"recipient_id": uid}, "sent": {"flagged_by": uid}}
    if elevated:
        by_scope["all"] = {}
    if scope not in by_scope:
        scope = "to_me"
    since = datetime.now(timezone.utc) - timedelta(days=fl.CLOSED_VISIBLE_DAYS)
    docs = await db[fl.FLAGS].find(
        {**by_scope[scope], "$or": [{"active": True}, {"updated_at": {"$gte": since}}]}
    ).sort("created_at", -1).to_list(200)
    items = [await fl.serialize(db, d, current_user) for d in docs]
    counts = {k: await db[fl.FLAGS].count_documents({**q, "active": True}) for k, q in by_scope.items()}
    recent = {k: await db[fl.FLAGS].count_documents({**q, "updated_at": {"$gte": since}}) for k, q in by_scope.items()}
    return success_response(data={
        "scope": scope,
        "scopes": list(by_scope),
        "counts": counts,          # open flags per scope
        "recent": recent,          # anything (open or closed) touched in the last 14 days, per scope
        "active": [i for i in items if i["active"]],
        "closed": [i for i in items if not i["active"]],
    }, message="Ads to redo")


@router.get("/ad-flags/{flag_id}")
async def get_flag(
    flag_id: str,
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    from bson import ObjectId
    flag = await fl.load(db, flag_id)
    report = await db[ar.REPORTS].find_one({"_id": ObjectId(flag["report_id"])}) if flag else None
    if not flag or not await fl.can_view(db, current_user, flag, report):
        return error_response("Not found.", status_code=404)
    return success_response(data=await fl.serialize(db, flag, current_user, report), message="Flag")


@router.patch("/ad-flags/{flag_id}")
async def act_on_flag(
    flag_id: str,
    body: FlagActionRequest,
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    from bson import ObjectId
    flag = await fl.load(db, flag_id)
    report = await db[ar.REPORTS].find_one({"_id": ObjectId(flag["report_id"])}) if flag else None
    if not flag or not await fl.can_view(db, current_user, flag, report):
        return error_response("Not found.", status_code=404)
    try:
        flag = await fl.act(db, current_user, flag, body.action, body.note)
    except fl.FlagError as exc:
        return error_response(exc.message, status_code=exc.status_code)
    msg = {"start": "Marked as being recreated", "done": "Marked as recreated",
           "decline": "Declined", "withdraw": "Withdrawn"}[body.action]
    return success_response(data=await fl.serialize(db, flag, current_user, report), message=msg)
