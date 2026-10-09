"""
Saved tasks — suggestions for the Task name field in Add Task.

`GET /suggest` returns everything a person may be offered for one team in a
single call (saved, company, recently used); the browser filters as they type,
so typing never waits on the network.
"""
from datetime import datetime, timezone
from typing import Literal, Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, Query
from motor.motor_asyncio import AsyncIOMotorDatabase
from pydantic import BaseModel
from pymongo.errors import DuplicateKeyError

from app.database import get_db
from app.middleware.auth import get_current_user
from app.services import task_preset_service as tp
from app.utils.response import error_response, success_response

router = APIRouter(prefix="/api/v1/task-presets", tags=["task-presets"])


class PresetCreate(BaseModel):
    team_id: Optional[str] = None             # None = company-wide (admin roles)
    title: str
    description: str = ""
    priority: Optional[Literal["low", "medium", "high"]] = None


class PresetUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    priority: Optional[Literal["low", "medium", "high"]] = None
    clear_priority: bool = False


def _err(e: tp.PresetError):
    return error_response(e.message, status_code=e.status_code)


async def _team_ok(db, team_id: str) -> bool:
    return ObjectId.is_valid(team_id) and bool(await db["teams"].find_one({"_id": ObjectId(team_id)}, {"_id": 1}))


@router.get("/suggest")
async def suggest(
    team_id: str = Query(default=""),
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """Saved (the team's — or all your teams' when none is picked), company, and recently used names."""
    uid = str(current_user["_id"])
    elevated = tp.is_elevated(current_user)
    mine = await tp.my_team_ids(db, uid)
    team_id = team_id if ObjectId.is_valid(team_id) else ""

    if team_id:
        visible = team_id in mine or elevated or await tp.leads_team(db, uid, team_id)
        saved_teams = [team_id] if visible else []
        recent_teams = [team_id] if (team_id in mine or elevated) else []
    else:
        saved_teams = mine
        recent_teams = mine

    saved = await db[tp.COLL].find({"team_id": {"$in": saved_teams}}).to_list(2000) if saved_teams else []
    company = await db[tp.COLL].find({"team_id": None}).to_list(500)
    uses = await tp.usage(db, recent_teams, created_by=uid)
    names = await tp.team_names(db, [p.get("team_id") for p in saved])

    taken = {p["title_key"] for p in saved} | {p["title_key"] for p in company}
    recent = sorted(
        ({"title": v["title"], "uses": v["uses"]} for k, v in uses.items() if k not in taken),
        key=lambda x: -x["uses"],
    )[: tp.MAX_RECENT]
    # No team picked yet (the Title box comes before Team in Add Task): a team
    # leader can still save the name — for a team they lead. Admin roles save
    # company-wide instead ("for everyone").
    save_teams: list[dict] = []
    if not team_id and not elevated:
        led = await db["teams"].find(
            {"members": {"$elemMatch": {"user_id": uid, "role": "leader"}}}, {"name": 1}
        ).sort("name", 1).to_list(50)
        save_teams = [{"id": str(t["_id"]), "name": t.get("name", "")} for t in led]
    return success_response(data={
        "saved": [tp.serialize(p, names, uses) for p in saved],
        "company": [tp.serialize(p, {}, uses) for p in company],
        "recent": recent,
        "can_save": await tp.can_manage(db, current_user, team_id or None) if team_id else elevated,
        "save_teams": save_teams,
    }, message="Suggestions")


@router.get("")
async def list_presets(
    team_id: str = Query(default=""),           # "" → company list
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """For the management screens (Team → Settings, and Settings → Saved tasks)."""
    team = team_id or None
    if team and not await _team_ok(db, team):
        return error_response("Team not found.", status_code=404)
    if not await tp.can_manage(db, current_user, team):
        return error_response("Only a team leader can manage saved tasks.", status_code=403)
    rows = await db[tp.COLL].find({"team_id": team}).sort("title_key", 1).to_list(tp.MAX_PER_TEAM + 50)
    uses = await tp.usage(db, [team] if team else None) if team else {}
    return success_response(data=[tp.serialize(p, {}, uses) for p in rows], message="Saved tasks")


@router.post("", status_code=201)
async def create_preset(
    body: PresetCreate,
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    team = body.team_id or None
    if team and not await _team_ok(db, team):
        return error_response("Team not found.", status_code=404)
    if not await tp.can_manage(db, current_user, team):
        return error_response("Only a team leader can save tasks for the team." if team
                              else "Only an admin can save company-wide tasks.", status_code=403)
    try:
        title = tp.clean_title(body.title)
    except tp.PresetError as e:
        return _err(e)
    desc = (body.description or "").strip()
    if len(desc) > tp.MAX_DESC:
        return error_response(f"Keep the description under {tp.MAX_DESC} characters.", status_code=422)
    key = team or "company"
    if await db[tp.COLL].count_documents({"team_key": key}) >= tp.MAX_PER_TEAM:
        return error_response(f"A list can hold up to {tp.MAX_PER_TEAM} saved tasks.", status_code=422)
    now = datetime.now(timezone.utc)
    doc = {"team_id": team, "team_key": key, "title": title, "title_key": tp.norm(title),
           "description": desc, "priority": body.priority, "created_by": str(current_user["_id"]),
           "created_by_name": current_user.get("name", ""), "created_at": now, "updated_at": now}
    try:
        res = await db[tp.COLL].insert_one(doc)
    except DuplicateKeyError:
        return error_response(f"“{title}” is already saved.", status_code=409)
    doc["_id"] = res.inserted_id
    return success_response(data=tp.serialize(doc, {}, {}), message="Saved", status_code=201)


async def _load(db, preset_id: str, user: dict):
    if not ObjectId.is_valid(preset_id):
        return None, error_response("Saved task not found.", status_code=404)
    p = await db[tp.COLL].find_one({"_id": ObjectId(preset_id)})
    if not p:
        return None, error_response("Saved task not found.", status_code=404)
    if not await tp.can_manage(db, user, p.get("team_id")):
        return None, error_response("Only a team leader can change saved tasks.", status_code=403)
    return p, None


@router.patch("/{preset_id}")
async def update_preset(
    preset_id: str,
    body: PresetUpdate,
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    p, err = await _load(db, preset_id, current_user)
    if err:
        return err
    upd: dict = {}
    try:
        if body.title is not None:
            upd["title"] = tp.clean_title(body.title)
            upd["title_key"] = tp.norm(upd["title"])
    except tp.PresetError as e:
        return _err(e)
    if body.description is not None:
        if len(body.description) > tp.MAX_DESC:
            return error_response(f"Keep the description under {tp.MAX_DESC} characters.", status_code=422)
        upd["description"] = body.description.strip()
    if body.clear_priority:
        upd["priority"] = None
    elif body.priority is not None:
        upd["priority"] = body.priority
    if upd:
        upd["updated_at"] = datetime.now(timezone.utc)
        try:
            await db[tp.COLL].update_one({"_id": p["_id"]}, {"$set": upd})
        except DuplicateKeyError:
            return error_response(f"“{upd['title']}” is already saved.", status_code=409)
    p = await db[tp.COLL].find_one({"_id": p["_id"]})
    return success_response(data=tp.serialize(p, {}, {}), message="Saved")


@router.delete("/{preset_id}")
async def delete_preset(
    preset_id: str,
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    p, err = await _load(db, preset_id, current_user)
    if err:
        return err
    await db[tp.COLL].delete_one({"_id": p["_id"]})
    return success_response(data={"id": preset_id}, message="Removed")
