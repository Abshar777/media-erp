"""
Task verification.

People named on a task sign the work off before it can be approved. Login is
required — a verification has to be attributable to a person, so the link in
the email lands on the normal authenticated page rather than carrying a token
anyone could forward.

  GET  /api/v1/verify/{task_id}   — the task, what to check, and your own slot
  POST /api/v1/verify/{task_id}   — pass, or reject with a reason
"""
from fastapi import APIRouter, Depends
from motor.motor_asyncio import AsyncIOMotorDatabase
from pydantic import BaseModel
from bson import ObjectId
from bson.errors import InvalidId
from datetime import datetime, timezone

from app.database import get_db
from app.middleware.auth import get_current_user
from app.services import workflow
from app.services.project_service import _serialize, update_task
from app.utils.response import error_response, success_response
from app.utils.timezone import utc_iso


def _out(verifications: list[dict]) -> list[dict]:
    """
    JSON-safe copy for the response. Mirrors what project_service._serialize
    does for a whole task; these two endpoints hand back the bare list.
    """
    return [{**v, "at": utc_iso(v["at"]) if v.get("at") else None} for v in verifications]

router = APIRouter(prefix="/api/v1/verify", tags=["verify"])


class VerifyDecision(BaseModel):
    passed: bool
    reason: str = ""


async def _load(db, task_id: str):
    try:
        oid = ObjectId(task_id)
    except InvalidId:
        return None, error_response("Invalid task ID", status_code=422)
    task = await db["project_tasks"].find_one({"_id": oid})
    if not task:
        return None, error_response("Task not found", status_code=404)
    return task, None


@router.get("/{task_id}")
async def get_verification(
    task_id: str,
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    task, err = await _load(db, task_id)
    if err:
        return err

    uid = str(current_user["_id"])
    verifications = task.get("verifications") or []
    mine = next((v for v in verifications if v.get("user_id") == uid), None)
    if not mine:
        return error_response(
            "You are not listed as a verifier for this task.", status_code=403
        )

    return success_response(
        data={
            "task": _serialize(task),
            "instructions": task.get("verify_instructions", ""),
            "mine": _out([mine])[0],
            # The whole panel, so a verifier can see who else is still to look.
            "verifications": _out(verifications),
        },
        message="Verification retrieved",
    )


@router.post("/{task_id}")
async def submit_verification(
    task_id: str,
    body: VerifyDecision,
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    task, err = await _load(db, task_id)
    if err:
        return err

    uid = str(current_user["_id"])
    actor_name = current_user.get("name", "")
    verifications = task.get("verifications") or []
    mine = next((v for v in verifications if v.get("user_id") == uid), None)
    if not mine:
        return error_response(
            "You are not listed as a verifier for this task.", status_code=403
        )

    # Only meaningful while the work is actually up for review.
    if task.get("status") != "pending_review":
        return error_response(
            "This task is not awaiting review right now.", status_code=400
        )

    reason = (body.reason or "").strip()
    if not body.passed and not reason:
        return error_response(
            "Please say what needs to change.", status_code=400
        )

    now = datetime.now(timezone.utc)
    for v in verifications:
        if v.get("user_id") == uid:
            v["status"] = workflow.VERIFY_PASSED if body.passed else workflow.VERIFY_REJECTED
            v["reason"] = "" if body.passed else reason
            v["at"] = now

    updates: dict = {"verifications": verifications}
    history = {
        "action":      "verified" if body.passed else "verify_rejected",
        "actor_id":    uid,
        "actor_name":  actor_name,
        "timestamp":   now,
        "from_status": task.get("status"),
        "to_status":   task.get("status"),
        "note":        "Verified" if body.passed else f"Needs changes — {reason}",
        "team_id":     task.get("team_id", ""),
    }

    # A rejection sends the work straight back, rather than leaving it sitting
    # in review while everyone else is still asked to look at something that is
    # already known to need changing.
    if not body.passed:
        updates["status"] = "reedit"
        updates["reedit_reason"] = f"Verification by {actor_name}: {reason}"
        history["to_status"] = "reedit"
        updates["timing"] = workflow.apply_timing(
            task.get("status", "pending_review"), "reedit", task.get("timing"), now
        )

    await db["project_tasks"].update_one({"_id": task["_id"]}, {"$push": {"history": history}})
    updated = await update_task(db, task_id, updates)

    # Tell the person who did the work. A pass is quiet unless it was the last
    # one outstanding — being pinged for each of six passes is just noise.
    from app.services.notification_service import push_notification
    assignee = task.get("assigned_to", "")
    title = task.get("title", "Task")
    meta = {"task_id": task_id, "task_title": title, "team_id": task.get("team_id", "")}
    try:
        if not body.passed and assignee and assignee != uid:
            await push_notification(
                db, assignee, "verify_rejected",
                "Your task needs changes",
                f'{actor_name} reviewed "{title}" and asked for changes — {reason}',
                meta,
            )
        elif body.passed and assignee and assignee != uid and workflow.all_verified(updated or {}):
            await push_notification(
                db, assignee, "verify_passed",
                "Your task is fully verified",
                f'Everyone has verified "{title}". It can now be approved.',
                meta,
            )
    except Exception as exc:
        print(f"[verify] notify failed: {exc}", flush=True)

    return success_response(
        data={"verifications": _out(verifications), "status": (updated or {}).get("status")},
        message="Verification recorded",
    )
