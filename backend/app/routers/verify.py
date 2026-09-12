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


class RemoveVerifier(BaseModel):
    reason: str = ""


_ELEVATED = {"Super Admin", "Admin", "Coordinator"}


def _is_elevated(user: dict) -> bool:
    """
    Who may drop a verifier. Deliberately not the team's leader: the leader is
    the one blocked from approving, so letting them clear the block would let
    them remove every verifier and sign the work off alone — which is the thing
    verification exists to prevent. Unsticking is an escalation on purpose.
    """
    return (user.get("_role") or {}).get("role_name", "") in _ELEVATED


async def _load(db, task_id: str):
    try:
        oid = ObjectId(task_id)
    except InvalidId:
        return None, error_response("Invalid task ID", status_code=422)
    task = await db["project_tasks"].find_one({"_id": oid})
    if not task:
        return None, error_response("Task not found", status_code=404)
    return task, None


def _is_super_admin(user: dict) -> bool:
    role = user.get("_role") or {}
    return bool(role.get("is_system_role")) and role.get("role_name") == "Super Admin"


@router.get("")
async def my_verifications(
    scope: str = "pending",   # pending | done | all
    everyone: bool = False,   # Super Admin oversight across the whole company
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """
    Tasks that list the caller as a verifier — their verification inbox.

    Defaults to what still needs them. A task only needs looking at while it is
    actually in review, so anything that has since moved on is reported as done
    rather than left sitting in the queue.

    A Super Admin may pass everyone=true to see every task under verification
    company-wide, which is an oversight view rather than a queue: they are
    usually not a verifier themselves, so "awaiting me" is about someone else.
    """
    uid = str(current_user["_id"])
    is_sa = _is_super_admin(current_user)
    company_wide = everyone and is_sa

    query = (
        {"verifications": {"$exists": True, "$ne": []}}
        if company_wide
        else {"verifications.user_id": uid}
    )
    docs = await db["project_tasks"].find(query).sort("updated_at", -1).to_list(500)

    out = []
    for d in docs:
        verifications = d.get("verifications") or []
        mine = next((v for v in verifications if v.get("user_id") == uid), None)

        if company_wide:
            # Whether anyone is still to sign off, not whether the caller is.
            awaiting = (
                d.get("status") == "pending_review"
                and any(v.get("status") == workflow.VERIFY_PENDING for v in verifications)
            )
        else:
            if not mine:
                continue
            awaiting = (
                mine.get("status") == workflow.VERIFY_PENDING
                and d.get("status") == "pending_review"
            )

        if scope == "pending" and not awaiting:
            continue
        if scope == "done" and awaiting:
            continue

        out.append({
            **_serialize(d),
            "my_verification": _out([mine])[0] if mine else None,
            "awaiting_me": awaiting,
        })

    return success_response(
        data=out,
        message="Verifications retrieved",
        meta={
            "awaiting": sum(1 for t in out if t["awaiting_me"]),
            "company_wide": company_wide,
            "can_see_all": is_sa,
        },
    )


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
    # A Super Admin may look at any task's verification state. They still can't
    # sign off unless they were actually named — POST checks membership itself.
    if not mine and not _is_super_admin(current_user):
        return error_response(
            "You are not listed as a verifier for this task.", status_code=403
        )

    return success_response(
        data={
            "task": _serialize(task),
            "instructions": task.get("verify_instructions", ""),
            "mine": _out([mine])[0] if mine else None,
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


@router.delete("/{task_id}/verifier/{user_id}")
async def remove_verifier(
    task_id: str,
    user_id: str,
    body: RemoveVerifier,
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """
    Drop a verifier from a task.

    The escape hatch for a verification that can never complete — someone left,
    is on long leave, or was named by mistake. Without it the task is stuck
    forever, since approval is blocked until everyone signs off.

    Elevated roles only, a reason is required, and the removal is written to the
    task history: quietly deleting the person who was supposed to check the work
    would be indistinguishable from the check having happened.
    """
    task, err = await _load(db, task_id)
    if err:
        return err

    if not _is_elevated(current_user):
        return error_response(
            "Only an Admin, Coordinator or Super Admin can remove a verifier.",
            status_code=403,
        )

    reason = (body.reason or "").strip()
    if not reason:
        return error_response("Please say why this verifier is being removed.", status_code=400)

    verifications = task.get("verifications") or []
    target = next((v for v in verifications if v.get("user_id") == user_id), None)
    if not target:
        return error_response("That person is not a verifier on this task.", status_code=404)

    remaining = [v for v in verifications if v.get("user_id") != user_id]
    now = datetime.now(timezone.utc)
    actor_name = current_user.get("name", "")

    await db["project_tasks"].update_one(
        {"_id": task["_id"]},
        {"$push": {"history": {
            "action":      "verifier_removed",
            "actor_id":    str(current_user["_id"]),
            "actor_name":  actor_name,
            "timestamp":   now,
            "from_status": task.get("status"),
            "to_status":   task.get("status"),
            "note":        f"Removed {target.get('name') or 'a verifier'} — {reason}",
            "team_id":     task.get("team_id", ""),
        }}},
    )
    updated = await update_task(db, task_id, {"verifications": remaining})

    # Tell the person they are no longer expected to look, so a stale request
    # doesn't sit in their inbox. Never fails the removal.
    from app.services.notification_service import push_notification
    try:
        await push_notification(
            db, user_id, "verify_removed",
            "You no longer need to verify a task",
            f'{actor_name} removed you as a verifier on "{task.get("title","a task")}" — {reason}',
            {"task_id": task_id, "task_title": task.get("title", ""), "team_id": task.get("team_id", "")},
        )
    except Exception as exc:
        print(f"[verify] removal notify failed: {exc}", flush=True)

    return success_response(
        data={
            "verifications": _out(remaining),
            "all_verified": workflow.all_verified(updated or {}),
        },
        message="Verifier removed",
    )


@router.post("/{task_id}/remind")
async def remind_verifiers(
    task_id: str,
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """
    Nudge everyone who still has to sign off.

    The people blocked by a verification are the ones who want it chased, so
    this is open to anyone who can see the task rather than gated to admins.
    Only those still outstanding are contacted — re-pinging someone who already
    passed is how a reminder turns into noise people learn to ignore.
    """
    task, err = await _load(db, task_id)
    if err:
        return err

    if task.get("status") != "pending_review":
        return error_response(
            "This task isn't awaiting review, so there's nothing to chase.",
            status_code=400,
        )

    pending = [
        v for v in (task.get("verifications") or [])
        if v.get("status") == workflow.VERIFY_PENDING
    ]
    if not pending:
        return error_response("Everyone has already verified this task.", status_code=400)

    from app.config import settings as _settings
    from app.services.notification_service import push_notification

    actor_name = current_user.get("name", "")
    title = task.get("title", "a task")
    sent = 0
    for v in pending:
        try:
            await push_notification(
                db, v["user_id"], "verify_requested",
                "Reminder: a task needs your verification",
                f'{actor_name} is waiting on your verification of "{title}".',
                {
                    "task_id": task_id,
                    "task_title": title,
                    "team_id": task.get("team_id", ""),
                    "verify_url": f"{_settings.frontend_url}/verify/{task_id}",
                },
            )
            sent += 1
        except Exception as exc:
            print(f"[verify] reminder failed for {v['user_id']}: {exc}", flush=True)

    names = ", ".join(v.get("name") or "someone" for v in pending)
    return success_response(
        data={"sent": sent, "to": [v.get("name") for v in pending]},
        message=f"Reminder sent to {names}" if sent else "Could not send the reminder",
    )
