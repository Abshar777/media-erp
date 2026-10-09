"""
Task projects — which ad account a task is for (optional on every task).

The list lives in `task_projects` so a name can be corrected or a project added
without a release. It is seeded at startup from SEED, idempotently: each seed
row has a fixed `key`, inserted only when missing — so a later rename or
archive in the database is never undone by a restart.

A task stores `project_id` + `project_name` (the name at the time), and only
when a project was chosen — tasks without one keep their old shape.
"""
from __future__ import annotations

from datetime import datetime, timezone

from bson import ObjectId
from pymongo.errors import DuplicateKeyError

COLLECTION = "task_projects"
PLATFORMS = ("meta", "google", "snapchat", "other")
MAX_NAME = 120
ELEVATED_ROLES = ("Super Admin", "Admin", "Coordinator")

# (key, name, platform, group) — groups and order exactly as given.
SEED: list[tuple[str, str, str, int]] = [
    ("delta-digital-dxb-meta",          "DELTA DIGITAL DXB (META ADS)",                    "meta",     1),
    ("delta-trading-blr-meta",          "DELTA TRADING BLR (META ADS)",                    "meta",     1),
    ("delta-trading-dxb-google",        "DELTA TRADING DXB (GOOGLE ADS)",                  "google",   1),
    ("delta-trading-ind-google",        "DELTA TRADING IND (GOOGLE ADS)",                  "google",   1),
    ("delta-trading-snapchat",          "DELTA TRADING (Snapchat)",                        "snapchat", 1),
    ("delta-trading-dxb-backup-meta",   "DELTA TRADING DXB - BACKUP (META ADS)",           "meta",     1),
    ("delta-digital-blr-meta",          "DELTA DIGITAL BLR (META ADS)",                    "meta",     2),
    ("delta-trading-dxb-meta-draw",     "DELTA TRADING DXB (META ADS) (Formerly DRAW)",    "meta",     2),
    ("delta-jura-meta",                 "DELTA JURA (META ADS)",                           "meta",     2),
    ("delta-ai-meta",                   "DELTA AI (META ADS)",                             "meta",     2),
    ("delta-trading-dxb-meta-shohaib",  "DELTA TRADING DXB (META ADS) - SHOHAIB",          "meta",     3),
    ("delta-trading-dxb-meta-abhin",    "DELTA TRADING DXB (META ADS) - ABHIN",            "meta",     3),
]


class ProjectError(Exception):
    def __init__(self, message: str, status_code: int = 422):
        super().__init__(message)
        self.message, self.status_code = message, status_code


def name_key(name: str) -> str:
    """What "the same name" means: case-insensitive (casefold), whitespace already tidied."""
    return " ".join(str(name or "").split()).casefold()


async def ensure_seed(db) -> int:
    """Indexes + any seed project not there yet. Returns how many were added."""
    await db[COLLECTION].create_index("key", unique=True, sparse=True)
    await db[COLLECTION].create_index([("active", 1), ("group", 1), ("order", 1)])
    # No two ACTIVE projects share a name — enforced by the database, so two
    # admins adding the same name at the same instant can't both succeed.
    async for d in db[COLLECTION].find({"name_key": {"$exists": False}}, {"name": 1}):
        await db[COLLECTION].update_one({"_id": d["_id"]}, {"$set": {"name_key": name_key(d.get("name", ""))}})
    try:
        await db[COLLECTION].create_index("name_key", unique=True, name="unique_active_name",
                                          partialFilterExpression={"active": True})
    except Exception as exc:                    # existing duplicates — the app check still guards
        import logging
        logging.getLogger(__name__).warning("task_projects: unique name index not created: %s", exc)
    have = {d["key"] for d in await db[COLLECTION].find({"key": {"$in": [k for k, *_ in SEED]}}, {"key": 1}).to_list(100)}
    now, added = datetime.now(timezone.utc), 0
    for order, (key, name, platform, group) in enumerate(SEED):
        if key in have:
            continue
        try:
            await db[COLLECTION].insert_one({"key": key, "name": name, "name_key": name_key(name), "platform": platform,
                                             "group": group, "order": order, "active": True, "created_at": now})
            added += 1
        except DuplicateKeyError:
            pass                                   # another worker seeded it first
    return added


def serialize(d: dict) -> dict:
    return {"id": str(d["_id"]), "name": d.get("name", ""), "platform": d.get("platform", ""),
            "group": d.get("group", 1)}


async def list_active(db) -> list[dict]:
    docs = await db[COLLECTION].find({"active": True}).sort([("group", 1), ("order", 1), ("name", 1)]).to_list(500)
    return [serialize(d) for d in docs]


async def resolve(db, project_id) -> dict | None:
    """The active project for this id; None for '' / None (no project). Raises on anything else."""
    pid = (project_id or "").strip() if isinstance(project_id, str) else project_id
    if not pid:
        return None
    if not isinstance(pid, str) or not ObjectId.is_valid(pid):
        raise ProjectError("Choose a project from the list.")
    doc = await db[COLLECTION].find_one({"_id": ObjectId(pid), "active": True})
    if not doc:
        raise ProjectError("That project is no longer available — choose another one.")
    return doc


# ── Managing the list (admin roles) ───────────────────────────────────────────

def can_manage(user: dict) -> bool:
    return ((user.get("_role") or {}).get("role_name", "")) in ELEVATED_ROLES


def _clean_name(name) -> str:
    name = " ".join(str(name or "").split())          # trim + collapse inner spaces
    if not name:
        raise ProjectError("Give the project a name.")
    if len(name) > MAX_NAME:
        raise ProjectError(f"Keep the name under {MAX_NAME} characters.")
    return name


def _clean_platform(platform) -> str:
    if platform not in PLATFORMS:
        raise ProjectError("Choose Meta, Google, Snapchat or Other.")
    return platform


def _clean_group(group) -> int:
    if isinstance(group, bool) or not isinstance(group, int) or not 1 <= group <= 50:
        raise ProjectError("Choose a group from the list.")
    return group


async def _name_taken(db, name: str, except_id=None) -> bool:
    import re
    q = {"active": True, "name": {"$regex": f"^{re.escape(name)}$", "$options": "i"}}
    if except_id is not None:
        q["_id"] = {"$ne": except_id}
    return bool(await db[COLLECTION].find_one(q, {"_id": 1}))


async def _load(db, project_id: str) -> dict:
    doc = await db[COLLECTION].find_one({"_id": ObjectId(project_id)}) if ObjectId.is_valid(project_id or "") else None
    if not doc:
        raise ProjectError("Project not found.", 404)
    return doc


async def list_for_manager(db) -> list[dict]:
    """Every project, archived too, with how many tasks use each."""
    docs = await db[COLLECTION].find({}).sort([("active", -1), ("group", 1), ("order", 1), ("name", 1)]).to_list(1000)
    counts = {r["_id"]: r["n"] for r in await db["project_tasks"].aggregate([
        {"$match": {"project_id": {"$in": [str(d["_id"]) for d in docs]}}},
        {"$group": {"_id": "$project_id", "n": {"$sum": 1}}},
    ]).to_list(1000)}
    return [{**serialize(d), "active": bool(d.get("active", True)), "tasks": counts.get(str(d["_id"]), 0)} for d in docs]


async def create(db, user: dict, name, platform, group) -> dict:
    name, platform = _clean_name(name), _clean_platform(platform)
    if await _name_taken(db, name):
        raise ProjectError(f"“{name}” is already in the list.", 409)
    if group is None:                                  # default: the last group
        last = await db[COLLECTION].find_one({"active": True}, sort=[("group", -1)])
        group = (last or {}).get("group", 1)
    group = _clean_group(group)
    last = await db[COLLECTION].find_one({}, sort=[("order", -1)])
    doc = {"name": name, "name_key": name_key(name), "platform": platform, "group": group,
           "order": (last or {}).get("order", -1) + 1,
           "active": True, "created_at": datetime.now(timezone.utc), "created_by": str(user["_id"])}
    try:
        res = await db[COLLECTION].insert_one(doc)
    except DuplicateKeyError:                   # lost a race with an identical add
        raise ProjectError(f"“{name}” is already in the list.", 409)
    doc["_id"] = res.inserted_id
    return {**serialize(doc), "active": True, "tasks": 0}


async def update(db, user: dict, project_id: str, changes: dict) -> dict:
    doc = await _load(db, project_id)
    upd: dict = {}
    if changes.get("name") is not None:
        name = _clean_name(changes["name"])
        if name != doc.get("name"):
            if await _name_taken(db, name, doc["_id"]):
                raise ProjectError(f"“{name}” is already in the list.", 409)
            upd["name"], upd["name_key"] = name, name_key(name)
    if changes.get("platform") is not None:
        upd["platform"] = _clean_platform(changes["platform"])
    if changes.get("group") is not None:
        upd["group"] = _clean_group(changes["group"])
    if changes.get("active") is not None:
        active = bool(changes["active"])
        if active and not doc.get("active", True) and await _name_taken(db, upd.get("name", doc.get("name", "")), doc["_id"]):
            raise ProjectError("A project with this name is already in the list — rename one of them first.", 409)
        upd["active"] = active
    if upd:
        upd["updated_at"] = datetime.now(timezone.utc)
        upd["updated_by"] = str(user["_id"])
        try:
            await db[COLLECTION].update_one({"_id": doc["_id"]}, {"$set": upd})
        except DuplicateKeyError:               # a rename / restore raced into an existing name
            raise ProjectError("A project with this name is already in the list.", 409)
        if "name" in upd:
            # A rename corrects the same ad account — tasks tagged with it follow.
            await db["project_tasks"].update_many({"project_id": str(doc["_id"])}, {"$set": {"project_name": upd["name"]}})
    doc = await db[COLLECTION].find_one({"_id": doc["_id"]})
    n = await db["project_tasks"].count_documents({"project_id": str(doc["_id"])})
    return {**serialize(doc), "active": bool(doc.get("active", True)), "tasks": n}


async def reorder(db, ids: list) -> None:
    """Active projects in display order. Every active project must be listed exactly once."""
    active = {str(d["_id"]) for d in await db[COLLECTION].find({"active": True}, {"_id": 1}).to_list(1000)}
    if len(ids) != len(set(ids)) or set(ids) != active:
        raise ProjectError("The list changed meanwhile — refresh and try again.", 409)
    for i, pid in enumerate(ids):
        await db[COLLECTION].update_one({"_id": ObjectId(pid)}, {"$set": {"order": i}})
