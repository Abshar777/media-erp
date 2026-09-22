"""
Project / Kanban task service.

Collection: project_tasks
"""

from datetime import datetime, timezone
from typing import Any

from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.utils.storage import canonicalize_attachments, sign_attachments

VALID_STATUSES = {"pending", "upcoming", "currently_working", "updation_needed"}
VALID_PRIORITIES = {"low", "medium", "high"}

# Ceiling for a single task-list response. Results are newest-first, so anything
# beyond this is the OLDEST work — list_tasks also returns the true total so the
# UI can say "showing X of Y" rather than silently hiding tasks.
TASK_LIST_LIMIT = 2000


def _dt_to_utc_iso(dt) -> str | None:
    """Serialize a datetime to an ISO string with explicit UTC offset.

    Motor returns timezone-naive datetime objects that represent UTC.
    Without the +00:00 suffix, JavaScript parses them as *local* time,
    causing openIntervalSeconds to be off by the browser's UTC offset.
    """
    if dt is None:
        return None
    if not hasattr(dt, "isoformat"):
        return dt  # already a string
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()


def _serialize(doc: dict) -> dict:
    out = {**doc}
    out["id"] = str(doc["_id"])
    del out["_id"]
    if "created_at" in out:
        out["created_at"] = _dt_to_utc_iso(out["created_at"])
    if "updated_at" in out:
        out["updated_at"] = _dt_to_utc_iso(out["updated_at"])
    # Serialize nested datetime objects inside timing intervals
    if out.get("timing"):
        timing = out["timing"]
        serialized_intervals = []
        for iv in timing.get("intervals", []):
            serialized_intervals.append({
                "started_at": _dt_to_utc_iso(iv.get("started_at")),
                "ended_at":   _dt_to_utc_iso(iv.get("ended_at")),
            })
        out["timing"] = {
            "intervals": serialized_intervals,
            "total_seconds": timing.get("total_seconds"),
        }
    # Verifier sign-offs carry an `at` datetime. Every read path funnels through
    # here, so normalising it once covers the board, the detail view, the leader
    # queue and the verification page alike — missing it 500s the response
    # *after* the write has landed, which looks like a failure that wasn't one.
    if out.get("verifications"):
        out["verifications"] = [
            {**v, "at": _dt_to_utc_iso(v["at"]) if v.get("at") else None}
            for v in out["verifications"]
        ]

    # Serialize history entries
    if out.get("history"):
        out["history"] = [
            {**e, "timestamp": _dt_to_utc_iso(e.get("timestamp"))}
            for e in out["history"]
        ]
    # The R2 bucket is private — mint signed GET URLs for attachments. Every
    # task read path (list, detail, leader queue, routing) funnels through here,
    # and each has already run its own access check before calling us.
    if out.get("attachments"):
        out["attachments"] = sign_attachments(out["attachments"])
    if out.get("submission_attachments"):
        out["submission_attachments"] = sign_attachments(out["submission_attachments"])
    return out


async def get_chain_history(db: AsyncIOMotorDatabase, doc: dict) -> tuple[list[dict], list[dict]]:
    """
    Aggregate the full routing-chain history for a task.

    A task that is routed to another team spawns a *new* task document (the
    routed copy) linked by ``root_task_id``. To show the complete story —
    who assigned, who worked, who approved, who sent it back, and across which
    teams — we gather the root task plus every copy sharing that root, merge
    their per-event ``history`` arrays, tag each event with the team it happened
    in, order everything chronologically, and derive a compact ``team_flow``
    (the ordered team "stops", e.g. video → content (reedit) → video → content
    (approved)).

    Returns ``(merged_history, team_flow)``.
    """
    root_id = str(doc.get("root_task_id") or doc["_id"])
    try:
        root_oid = ObjectId(root_id)
    except Exception:
        root_oid = doc["_id"]

    chain = await db["project_tasks"].find(
        {"$or": [{"_id": root_oid}, {"root_task_id": root_id}]}
    ).to_list(200)
    if not any(str(t["_id"]) == str(doc["_id"]) for t in chain):
        chain.append(doc)

    # Resolve team_id -> name for every team referenced in the chain / its events.
    team_ids: set[str] = {t.get("team_id") for t in chain if t.get("team_id")}
    for t in chain:
        for e in t.get("history", []) or []:
            if e.get("team_id"):
                team_ids.add(e["team_id"])
    name_map: dict[str, str] = {}
    valid_ids = [ObjectId(i) for i in team_ids if i and ObjectId.is_valid(i)]
    if valid_ids:
        async for tm in db["teams"].find({"_id": {"$in": valid_ids}}, {"name": 1}):
            name_map[str(tm["_id"])] = tm.get("name", "")

    merged: list[dict] = []
    for t in chain:
        t_team = t.get("team_id") or ""
        for e in t.get("history", []) or []:
            tid = e.get("team_id") or t_team
            merged.append({
                "action":      e.get("action"),
                "actor_id":    e.get("actor_id", ""),
                "actor_name":  e.get("actor_name", ""),
                "timestamp":   _dt_to_utc_iso(e.get("timestamp")),
                "from_status": e.get("from_status"),
                "to_status":   e.get("to_status"),
                "note":        e.get("note"),
                "team_id":     tid,
                "team_name":   e.get("team_name") or name_map.get(tid, ""),
            })
    merged.sort(key=lambda x: x.get("timestamp") or "")

    # team_flow — walk chronologically, opening a new stop each time the team
    # changes; the stop's "outcome" is the last milestone reached in that team.
    flow: list[dict] = []
    for e in merged:
        tname = e.get("team_name") or "—"
        if not flow or flow[-1]["team_name"] != tname:
            flow.append({"team_name": tname, "team_id": e.get("team_id", ""), "outcome": None})
        if e.get("action") in ("approved", "reedit", "routed"):
            flow[-1]["outcome"] = e["action"]

    return merged, flow


async def list_tasks(
    db: AsyncIOMotorDatabase,
    search: str = "",
    status: str = "",
    priority: str = "",
    date_filter: str = "",        # today|this_week|this_month|this_year|custom
    date_from: str = "",
    date_to: str = "",
    team_id: str = "",
    # Widen a team filter to also match work that belongs to no team. Set when
    # browsing one person: see the note where it is applied.
    include_teamless: bool = False,
    # Visibility: "all" | "team" | "leader_teams" | "own"
    visibility: str = "all",
    user_id: str = "",
    leader_team_ids: list = None,  # set when visibility == "leader_teams"
    # Quick scopes, applied on top of visibility rather than instead of it:
    #   assigned_to_me | created_by_me | needs_my_approval | verify_by_me
    scope: str = "",
    approver_team_ids: list = None,  # teams the caller leads, for needs_my_approval
    page: int = 1,
    limit: int = 0,   # 0 = no paging (return all, up to TASK_LIST_LIMIT)
) -> list[dict]:
    query: dict[str, Any] = {}

    if search:
        query["$or"] = [
            {"title": {"$regex": search, "$options": "i"}},
            {"description": {"$regex": search, "$options": "i"}},
        ]

    # Status is now dynamic (custom Kanban columns) — accept any non-empty key
    if status:
        query["status"] = status

    if priority and priority in VALID_PRIORITIES:
        query["priority"] = priority

    # Team filter
    if team_id:
        if include_teamless:
            # Looking at one person, not one board. A task raised with no team
            # has no board to sit on, so a strict team match hid it from
            # everyone but its assignee — including whoever had to approve it.
            # Nested under $and: `search` above already owns the top-level $or.
            query.setdefault("$and", []).append({
                "$or": [
                    {"team_id": team_id},
                    {"team_id": {"$in": ["", None]}},
                    {"team_id": {"$exists": False}},
                ]
            })
        else:
            query["team_id"] = team_id

    # Visibility filter (role-based)
    if visibility == "own" and user_id:
        # An approver or a verifier is usually an ordinary member, so plain
        # "own" would hide the very task they were asked to look at. Show tasks
        # assigned to them, awaiting their approval, or naming them as a
        # verifier.
        # Nested under $and: `search` above already occupies a top-level $or,
        # and assigning another would silently drop the search terms.
        query.setdefault("$and", []).append({
            "$or": [
                {"assigned_to": user_id},
                {"approver_id": user_id},
                {"verifications.user_id": user_id},
            ]
        })
    elif visibility == "leader_teams" and leader_team_ids:
        # Team Leader with no explicit team_id — scope to all teams they lead
        query["team_id"] = {"$in": leader_team_ids}

    # ── Quick scopes ──────────────────────────────────────────────────────────
    # Nested under $and for the same reason as the visibility clause: `search`
    # already holds the top-level $or, and a second assignment would drop it.
    if scope == "assigned_to_me" and user_id:
        query.setdefault("$and", []).append({"assigned_to": user_id})
    elif scope == "created_by_me" and user_id:
        query.setdefault("$and", []).append({"created_by": user_id})
    elif scope == "verify_by_me" and user_id:
        # Waiting on you as a verifier — distinct from needs_my_approval, which
        # is about signing a task off at the end.
        query.setdefault("$and", []).append({"status": "pending_review"})
        query.setdefault("$and", []).append({
            "verifications": {"$elemMatch": {"user_id": user_id, "status": "pending"}}
        })
    elif scope == "needs_my_approval" and user_id:
        # Waiting on you specifically: named approver, or a leader of the team
        # it sits in. Mirrors workflow.can_approve, minus the elevated roles —
        # an admin can approve anything, so listing every task in the company
        # under "needs my approval" would be useless to them.
        waiting: list[dict] = [{"approver_id": user_id}]
        if approver_team_ids:
            waiting.append({"team_id": {"$in": approver_team_ids}})
        query.setdefault("$and", []).append({"status": "pending_review"})
        query.setdefault("$and", []).append({"$or": waiting})
    # "team"  → team_id already applied above (leader sees all tasks in that specific team)
    # "all"   → no additional filter (Super Admin / Admin / Coordinator)

    # Date filtering on created_at.
    # Boundaries are IST calendar days (the product runs on IST), converted to
    # the UTC instants that are actually stored. See app/utils/timezone.py.
    from app.utils.timezone import ist_period_start_utc, ist_day_start_utc, ist_day_end_utc

    if date_filter in ("today", "this_week", "this_month", "this_year"):
        start = ist_period_start_utc(date_filter)
        if start:
            query["created_at"] = {"$gte": start}
    elif date_filter == "custom" and date_from and date_to:
        try:
            df = ist_day_start_utc(datetime.strptime(date_from, "%Y-%m-%d").date())
            dt = ist_day_end_utc(datetime.strptime(date_to, "%Y-%m-%d").date())
            query["created_at"] = {"$gte": df, "$lte": dt}
        except ValueError:
            pass

    # Results are newest-first, so any cap drops the OLDEST tasks. `total` is
    # always the true match count so callers can page through everything rather
    # than having work silently disappear off the end.
    total = await db["project_tasks"].count_documents(query)

    cursor = db["project_tasks"].find(query).sort("created_at", -1)
    if limit and limit > 0:
        cursor = cursor.skip(max(0, (max(page, 1) - 1) * limit)).limit(limit)
        docs = await cursor.to_list(length=limit)
    else:
        # No explicit page size — return everything up to the safety ceiling.
        docs = await cursor.to_list(length=TASK_LIST_LIMIT)

    return [_serialize(doc) for doc in docs], total


async def create_task(db: AsyncIOMotorDatabase, data: dict) -> dict:
    now = datetime.now(timezone.utc)
    actor_id   = data.get("created_by", "")
    actor_name = data.get("actor_name", "")
    assigned_to_name = data.get("assigned_to_name", "")
    initial_history = [
        {
            "action":      "created",
            "actor_id":    actor_id,
            "actor_name":  actor_name,
            "timestamp":   now,
            "from_status": None,
            "to_status":   data.get("status", "pending"),
            "note":        f"Assigned to {assigned_to_name}" if assigned_to_name else None,
        }
    ]
    doc = {
        "title": data["title"],
        "description": data.get("description", ""),
        "priority": data.get("priority", "medium"),
        "status": data.get("status", "pending"),
        "assigned_to": data.get("assigned_to", ""),
        "assigned_to_name": data.get("assigned_to_name", ""),
        "due_date": data.get("due_date"),
        "team_id": data.get("team_id") or None,
        # Strip the read-time signed URLs the client round-tripped back to us —
        # `key` is what we persist, `url` is re-signed on every read.
        "attachments": canonicalize_attachments(data.get("attachments")),
        "created_by": actor_id,
        # Named approver (optional) — validated by the router before we get here.
        "approver_id": data.get("approver_id", ""),
        "approver_name": data.get("approver_name", ""),
        # Who must sign off before approval. Expanded into `verifications` when
        # the work is actually submitted, not now — see edit_task.
        "verify_users": data.get("verify_users") or [],
        "verify_teams": data.get("verify_teams") or [],
        "created_at": now,
        "updated_at": now,
        "timing": {"intervals": [], "total_seconds": None},
        "history": initial_history,
        # Pipeline tracing (optional)
        "pipeline_id": data.get("pipeline_id") or None,
        "pipeline_node_id": data.get("pipeline_node_id") or None,
        "pipeline_parent_task_id": data.get("pipeline_parent_task_id") or None,
    }
    result = await db["project_tasks"].insert_one(doc)
    doc["_id"] = result.inserted_id
    return _serialize(doc)


async def update_task(
    db: AsyncIOMotorDatabase, task_id: str, updates: dict
) -> dict | None:
    try:
        oid = ObjectId(task_id)
    except Exception:
        return None

    updates = {k: v for k, v in updates.items() if v is not None}
    if "attachments" in updates:
        updates["attachments"] = canonicalize_attachments(updates["attachments"])
    updates["updated_at"] = datetime.now(timezone.utc)

    result = await db["project_tasks"].find_one_and_update(
        {"_id": oid},
        {"$set": updates},
        return_document=True,
    )
    return _serialize(result) if result else None


async def delete_task(db: AsyncIOMotorDatabase, task_id: str) -> bool:
    try:
        oid = ObjectId(task_id)
    except Exception:
        return False
    result = await db["project_tasks"].delete_one({"_id": oid})
    return result.deleted_count > 0
