from fastapi import APIRouter, Depends
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.database import get_db
from app.middleware.auth import get_current_user
from app.utils.response import error_response, success_response

router = APIRouter(prefix="/api/v1/notification-prefs", tags=["notification-prefs"])

# All recognised notification types
_ALL_TYPES = [
    "task_assigned", "task_approved", "task_reedit", "due_date_reminder",
    "pending_review", "team_task_assigned", "task_started", "task_break",
    "task_transferred", "mention",
]


@router.get("")
async def get_prefs(
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    uid = str(current_user["_id"])
    doc = await db["notification_prefs"].find_one({"user_id": uid})
    if doc:
        return success_response({
            # Default ON to match the send logic (_send_email_if_opted_in), which
            # treats a missing pref as enabled — otherwise the UI showed OFF while
            # emails were actually being sent.
            "email_enabled": doc.get("email_enabled", True),
            "email_types":   doc.get("email_types", {t: True for t in _ALL_TYPES}),
        }, "Preferences retrieved")
    # First-time default: everything on (matches actual send behaviour).
    return success_response({
        "email_enabled": True,
        "email_types":   {t: True for t in _ALL_TYPES},
    }, "Preferences retrieved")


@router.put("")
async def update_prefs(
    body: dict,
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    uid = str(current_user["_id"])

    update: dict = {}
    if "email_enabled" in body:
        update["email_enabled"] = bool(body["email_enabled"])
    if "email_types" in body and isinstance(body["email_types"], dict):
        update["email_types"] = {
            k: bool(v) for k, v in body["email_types"].items() if k in _ALL_TYPES
        }

    if not update:
        return error_response("Nothing to update", status_code=422)

    await db["notification_prefs"].update_one(
        {"user_id": uid},
        {"$set": update, "$setOnInsert": {"user_id": uid}},
        upsert=True,
    )
    return success_response(None, "Preferences saved")
