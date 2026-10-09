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
PLATFORMS = ("meta", "google", "snapchat")

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


async def ensure_seed(db) -> int:
    """Indexes + any seed project not there yet. Returns how many were added."""
    await db[COLLECTION].create_index("key", unique=True, sparse=True)
    await db[COLLECTION].create_index([("active", 1), ("group", 1), ("order", 1)])
    have = {d["key"] for d in await db[COLLECTION].find({"key": {"$in": [k for k, *_ in SEED]}}, {"key": 1}).to_list(100)}
    now, added = datetime.now(timezone.utc), 0
    for order, (key, name, platform, group) in enumerate(SEED):
        if key in have:
            continue
        try:
            await db[COLLECTION].insert_one({"key": key, "name": name, "platform": platform, "group": group,
                                             "order": order, "active": True, "created_at": now})
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
