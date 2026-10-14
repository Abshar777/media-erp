"""
Auto-approve — a team leader's switch (see app/services/auto_approve_service.py).

  GET  /api/v1/auto-approve                 → my setting + the teams it covers
  PUT  /api/v1/auto-approve                 → {enabled, delay_minutes}  (team leaders only)
  POST /api/v1/auto-approve/hold/{task_id}  → {hold: bool}  stop / resume it for one task
"""
from bson import ObjectId
from fastapi import APIRouter, Depends
from motor.motor_asyncio import AsyncIOMotorDatabase
from pydantic import BaseModel, StrictBool, StrictInt

from app.database import get_db
from app.middleware.auth import get_current_user
from app.services import auto_approve_service as svc
from app.utils.response import error_response, success_response

router = APIRouter(prefix="/api/v1/auto-approve", tags=["auto-approve"])

_ELEVATED = {"Super Admin", "Admin", "Coordinator"}


class AutoApproveSettings(BaseModel):
    enabled: StrictBool
    delay_minutes: StrictInt = 0


class HoldRequest(BaseModel):
    hold: StrictBool


@router.get("")
async def my_auto_approve(current_user: dict = Depends(get_current_user),
                          db: AsyncIOMotorDatabase = Depends(get_db)):
    uid = str(current_user["_id"])
    teams = await svc.led_teams(db, uid)
    data = await svc.get_settings(db, uid)
    data["can_use"] = bool(teams)
    data["teams"] = [{"id": str(t["_id"]), "name": t.get("name", ""), "color": t.get("color")} for t in teams]
    data["max_delay_minutes"] = svc.MAX_DELAY_MINUTES
    return success_response(data=data)


@router.put("")
async def save_auto_approve(body: AutoApproveSettings,
                            current_user: dict = Depends(get_current_user),
                            db: AsyncIOMotorDatabase = Depends(get_db)):
    uid = str(current_user["_id"])
    if not await svc.led_teams(db, uid):
        return error_response("Auto-approve is for team leaders — you don't lead a team.", status_code=403)
    problem = svc.validate(body.enabled, body.delay_minutes)
    if problem:
        return error_response(problem, status_code=422)
    data = await svc.save_settings(db, uid, body.enabled, body.delay_minutes)
    msg = ("Auto-approve is on" + (f" — {body.delay_minutes} min after submission" if body.delay_minutes else " — immediately")
           if body.enabled else "Auto-approve is off")
    return success_response(data=data, message=msg)


@router.post("/hold/{task_id}")
async def hold_task(task_id: str, body: HoldRequest,
                    current_user: dict = Depends(get_current_user),
                    db: AsyncIOMotorDatabase = Depends(get_db)):
    try:
        oid = ObjectId(task_id)
    except Exception:
        return error_response("Invalid task ID", status_code=422)
    task = await db["project_tasks"].find_one({"_id": oid}, {"team_id": 1, "status": 1})
    if not task:
        return error_response("Task not found", status_code=404)
    role = ((current_user.get("_role") or {}).get("role_name")) or ""
    uid = str(current_user["_id"])
    team = await db["teams"].find_one({"_id": ObjectId(task["team_id"])}, {"members": 1}) \
        if task.get("team_id") and ObjectId.is_valid(task["team_id"]) else None
    leads = bool(team) and any(m.get("user_id") == uid and m.get("role") == "leader" for m in team.get("members") or [])
    if role not in _ELEVATED and not leads:
        # A leader's stand-in who reviews submissions may hold them too.
        from app.services.standin_service import standing_in_for
        if not (task.get("team_id") and await standing_in_for(db, uid, task["team_id"], review=True)):
            return error_response("Only this team's leaders can hold auto-approval.", status_code=403)
    if task.get("status") != "pending_review":
        return error_response("This task isn't waiting for approval.", status_code=409)
    await svc.set_hold(db, task_id, current_user, body.hold)
    return success_response(data={"hold": body.hold},
                            message="Auto-approval held — approve it by hand" if body.hold else "Auto-approval resumed")
