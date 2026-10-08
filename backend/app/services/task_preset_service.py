"""
Saved tasks — routine task names a team (or the whole company) reuses.

Picking one in Add Task fills the name, and the description / priority only if
those are still empty. They are suggestions and nothing else: task creation is
untouched, and "used N×" / "recently used" are worked out by counting tasks.

Who sees what
-------------
* A team's saved tasks: its members and leaders, and the admin roles.
* Company saved tasks (team_id None): everyone.
* "Recently used" names: tasks of teams you BELONG to, plus your own tasks —
  never another team's titles.
Who manages: a team's leaders + the admin roles (team list); the admin roles
(company list).
"""
from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone

from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorDatabase

COLL = "task_presets"
ELEVATED_ROLES = ("Super Admin", "Admin", "Coordinator")
PRIORITIES = ("low", "medium", "high")
MAX_TITLE, MAX_DESC, MAX_PER_TEAM = 120, 2000, 200
RECENT_DAYS, MAX_RECENT = 90, 100


class PresetError(Exception):
    def __init__(self, message: str, status_code: int = 422):
        super().__init__(message)
        self.message, self.status_code = message, status_code


def is_elevated(user: dict) -> bool:
    return ((user.get("_role") or {}).get("role_name", "")) in ELEVATED_ROLES


def norm(title: str) -> str:
    """Comparison key: trimmed, single-spaced, lower-case."""
    return re.sub(r"\s+", " ", (title or "").strip()).lower()


def clean_title(title) -> str:
    t = re.sub(r"\s+", " ", str(title or "").strip())
    if not t:
        raise PresetError("Give the saved task a name.")
    if len(t) > MAX_TITLE:
        raise PresetError(f"Keep the name under {MAX_TITLE} characters.")
    return t


async def my_team_ids(db, uid: str) -> list[str]:
    teams = await db["teams"].find({"members.user_id": uid}, {"_id": 1}).to_list(500)
    return [str(t["_id"]) for t in teams]


async def leads_team(db, uid: str, team_id: str) -> bool:
    return bool(ObjectId.is_valid(team_id) and await db["teams"].find_one(
        {"_id": ObjectId(team_id), "members": {"$elemMatch": {"user_id": uid, "role": "leader"}}}, {"_id": 1}))


async def can_manage(db, user: dict, team_id: str | None) -> bool:
    if is_elevated(user):
        return True
    return bool(team_id) and await leads_team(db, str(user["_id"]), team_id)


async def team_names(db, ids) -> dict[str, str]:
    ids = [i for i in set(ids) if i and ObjectId.is_valid(i)]
    if not ids:
        return {}
    rows = await db["teams"].find({"_id": {"$in": [ObjectId(i) for i in ids]}}, {"name": 1}).to_list(len(ids))
    return {str(r["_id"]): r.get("name", "") for r in rows}


async def usage(db, team_ids: list[str] | None, created_by: str | None = None) -> dict[str, dict]:
    """
    Task titles used in the last 90 days → {norm: {"title", "uses", "last"}}.
    Scoped to `team_ids` and/or tasks `created_by` this person.
    """
    since = datetime.now(timezone.utc) - timedelta(days=RECENT_DAYS)
    scope = []
    if team_ids:
        scope.append({"team_id": {"$in": team_ids}})
    if created_by:
        scope.append({"created_by": created_by})
    if not scope:
        return {}
    rows = await db["project_tasks"].find(
        {"created_at": {"$gte": since}, "$or": scope}, {"title": 1, "created_at": 1}
    ).sort("created_at", -1).to_list(5000)
    out: dict[str, dict] = {}
    for r in rows:
        key = norm(r.get("title", ""))
        if not key:
            continue
        hit = out.get(key)
        if hit:
            hit["uses"] += 1
        else:                                   # newest first → keeps the latest spelling
            out[key] = {"title": r["title"].strip(), "uses": 1, "last": r.get("created_at")}
    return out


def serialize(p: dict, names: dict[str, str], uses: dict[str, dict]) -> dict:
    return {
        "id": str(p["_id"]),
        "team_id": p.get("team_id"),
        "team_name": names.get(p.get("team_id") or "", ""),
        "title": p.get("title", ""),
        "description": p.get("description", ""),
        "priority": p.get("priority") or None,
        "uses": uses.get(p.get("title_key", ""), {}).get("uses", 0),
        "created_by_name": p.get("created_by_name", ""),
    }


async def ensure_indexes(db: AsyncIOMotorDatabase) -> None:
    # One name per team (company list = team_key "company"), case-insensitive.
    await db[COLL].create_index([("team_key", 1), ("title_key", 1)], unique=True, name="unique_preset_per_team")
