"""
Stand-in — a team leader hands their Leader Desk to a teammate while away
(see app/services/standin_service.py).

  GET    /api/v1/standin   → my hand-over (as a leader) + where I'm standing in
  PUT    /api/v1/standin   → hand over (create or replace)   — team leaders only
  DELETE /api/v1/standin   → end it now ("I'm back")
"""
from typing import Optional

from fastapi import APIRouter, Depends
from motor.motor_asyncio import AsyncIOMotorDatabase
from pydantic import BaseModel, StrictBool

from app.database import get_db
from app.middleware.auth import get_current_user
from app.services import standin_service as svc
from app.utils.response import error_response, success_response

router = APIRouter(prefix="/api/v1/standin", tags=["standin"])


class HandoverRequest(BaseModel):
    standin_id: str
    start_date: str
    end_date: str
    team_ids: Optional[list[str]] = None
    can_review: StrictBool = False
    note: str = ""


@router.get("")
async def my_standin(current_user: dict = Depends(get_current_user),
                     db: AsyncIOMotorDatabase = Depends(get_db)):
    uid = str(current_user["_id"])
    led = await svc.led_teams(db, uid)
    mine = await svc.open_handover(db, uid)
    # Where I'm standing in for someone (live now, or coming up).
    upcoming = await db[svc.COLL].find({"standin_id": uid, "status": "open", "ends_at": {"$gt": svc._now()}}).to_list(20)
    live_teams = await svc.live_for_standin(db, uid)
    ids = {t for d in [mine, *upcoming] if d for t in d.get("team_ids", [])}
    names = await svc.team_names(db, ids)
    standing_in = []
    for d in upcoming:
        p = svc.public(d, names)
        if p["state"] == "active":
            # Only the teams where it still counts (membership is re-checked live).
            p["teams"] = [t for t in p["teams"] if t["id"] in live_teams]
            if not p["teams"]:
                continue
        standing_in.append(p)
    return success_response(data={
        "can_use": bool(led),
        "teams": [{"id": str(t["_id"]), "name": t.get("name", ""), "color": t.get("color"),
                   "member_ids": [m.get("user_id") for m in t.get("members") or [] if m.get("user_id")]} for t in led],
        "mine": svc.public(mine, names),
        "standing_in": standing_in,
        "max_days": svc.MAX_DAYS,
    })


@router.put("")
async def hand_over(body: HandoverRequest,
                    current_user: dict = Depends(get_current_user),
                    db: AsyncIOMotorDatabase = Depends(get_db)):
    try:
        doc, replaced = await svc.save(db, current_user, body.standin_id.strip(), body.team_ids,
                                       body.start_date, body.end_date, body.can_review, body.note)
    except svc.StandinError as exc:
        return error_response(exc.message, status_code=exc.status_code)
    try:
        await svc.notify_handover(db, doc, replaced)
    except Exception as exc:                       # the hand-over stands even if a bell fails
        print(f"[standin] notify failed: {exc!r}", flush=True)
    names = await svc.team_names(db, doc["team_ids"])
    p = svc.public(doc, names)
    msg = (f"{doc['standin_name']} is standing in for you until {svc.fmt_day(doc['end_date'])}" if p["state"] == "active"
           else f"{doc['standin_name']} will stand in from {svc.fmt_day(doc['start_date'])}")
    return success_response(data=p, message=msg)


@router.delete("")
async def end_standin(current_user: dict = Depends(get_current_user),
                      db: AsyncIOMotorDatabase = Depends(get_db)):
    old = await svc.end_now(db, str(current_user["_id"]))
    if not old:
        return error_response("You have no stand-in right now.", status_code=404)
    try:
        await svc.notify_ended(db, old)
    except Exception as exc:
        print(f"[standin] notify failed: {exc!r}", flush=True)
    return success_response(data=None, message="Welcome back — your stand-in has ended")
