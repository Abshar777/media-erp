from datetime import datetime, timezone
from bson import ObjectId
from app.database import get_db
from app.utils.storage import canonicalize_attachments


async def get_messages(
    user_a: str,
    user_b: str,
    limit: int = 50,
    before_id: str | None = None,
) -> list[dict]:
    db = get_db()
    query: dict = {
        "$or": [
            {"from_user_id": user_a, "to_user_id": user_b},
            {"from_user_id": user_b, "to_user_id": user_a},
        ]
    }
    if before_id:
        query["_id"] = {"$lt": ObjectId(before_id)}

    cursor = db["messages"].find(query).sort("_id", -1).limit(limit)
    docs = await cursor.to_list(limit)
    return list(reversed(docs))  # chronological order


async def save_message(
    from_user_id: str,
    to_user_id: str,
    content: str,
    attachments: list | None = None,
    task_ids: list | None = None,
) -> dict:
    db = get_db()
    doc = {
        "from_user_id": from_user_id,
        "to_user_id": to_user_id,
        "content": content,
        "read": False,
        # Persist `key`, not the read-time signed URL the client sent back.
        "attachments": canonicalize_attachments(attachments),
        "task_ids": task_ids or [],
        "created_at": datetime.now(timezone.utc),
    }
    result = await db["messages"].insert_one(doc)
    doc["_id"] = result.inserted_id
    return doc


async def resolve_task_snapshots(task_ids: list[str]) -> list[dict]:
    """Return live {id, title, status, priority} snapshots for a set of task ids."""
    if not task_ids:
        return []
    db = get_db()
    oids = [ObjectId(t) for t in task_ids if ObjectId.is_valid(t)]
    if not oids:
        return []
    docs = await db["project_tasks"].find(
        {"_id": {"$in": oids}}, {"title": 1, "status": 1, "priority": 1}
    ).to_list(200)
    return [
        {
            "id": str(d["_id"]),
            "title": d.get("title", ""),
            "status": d.get("status", "pending"),
            "priority": d.get("priority", "medium"),
        }
        for d in docs
    ]


async def attach_task_snapshots(message_dicts: list[dict]) -> list[dict]:
    """Enrich serialized messages with a `tasks` array resolved from their task_ids."""
    all_ids = {tid for m in message_dicts for tid in (m.get("task_ids") or [])}
    if not all_ids:
        for m in message_dicts:
            m["tasks"] = []
        return message_dicts
    snapshots = {s["id"]: s for s in await resolve_task_snapshots(list(all_ids))}
    for m in message_dicts:
        m["tasks"] = [snapshots[t] for t in (m.get("task_ids") or []) if t in snapshots]
    return message_dicts


async def mark_read(from_user_id: str, to_user_id: str) -> None:
    """Mark all messages from `from_user_id` to `to_user_id` as read."""
    db = get_db()
    await db["messages"].update_many(
        {"from_user_id": from_user_id, "to_user_id": to_user_id, "read": False},
        {"$set": {"read": True}},
    )


async def unread_counts(user_id: str) -> dict[str, int]:
    """Return {sender_id: unread_count} for the given recipient."""
    db = get_db()
    pipeline = [
        {"$match": {"to_user_id": user_id, "read": False}},
        {"$group": {"_id": "$from_user_id", "count": {"$sum": 1}}},
    ]
    results = await db["messages"].aggregate(pipeline).to_list(None)
    return {r["_id"]: r["count"] for r in results}
