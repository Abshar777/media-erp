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


REPLY_PREVIEW_CHARS = 220


def attachment_label(att: dict) -> str:
    """
    What to call an attachment in a quote.

    A filename is the useful label for a document, but for a photo or a video
    the thumbnail already says what it is and the filename is usually machine
    noise (IMG_4821.HEIC), so those get the kind instead.
    """
    ct = (att.get("content_type") or "").lower()
    if ct.startswith("image/"):
        return "Photo"
    if ct.startswith("video/"):
        return "Video"
    if ct.startswith("audio/"):
        return "Audio"
    return att.get("filename") or "Document"


def _preview(doc: dict) -> str:
    """What the quote shows when the original had no text of its own."""
    content = (doc.get("content") or "").strip()
    if content:
        return content[:REPLY_PREVIEW_CHARS]
    atts = doc.get("attachments") or []
    if atts:
        first = attachment_label(atts[0]) if isinstance(atts[0], dict) else "Attachment"
        return first if len(atts) == 1 else f"{first} +{len(atts) - 1}"
    if doc.get("task_ids"):
        n = len(doc["task_ids"])
        return f"{n} task{'s' if n != 1 else ''}"
    return ""


async def build_reply_snapshot(
    reply_to_id: str,
    *,
    dm_pair: tuple[str, str] | None = None,
    group_id: str = "",
) -> dict | None:
    """
    Snapshot the message being replied to.

    Read from the database, never from what the client sent: the quote is
    displayed to everyone in the conversation, so trusting a client-supplied
    preview would let a sender put words in someone else's mouth.

    The reference is also confined to the conversation it is quoted into — a
    message id is guessable enough that accepting any id would turn a reply
    into a way to pull the text of a private message into a group.

    Returns None when the reference is unusable. A quote that cannot be
    resolved should cost the reply its quote, not the reply itself.
    """
    if not reply_to_id or not ObjectId.is_valid(reply_to_id):
        return None
    db = get_db()
    doc = await db["messages"].find_one({"_id": ObjectId(reply_to_id)})
    if not doc:
        return None

    if group_id:
        if doc.get("group_id") != group_id:
            return None
        name = doc.get("from_user_name", "") or "Unknown"
    elif dm_pair:
        # Same two people, in either direction — and not a group message.
        if doc.get("group_id"):
            return None
        if {doc.get("from_user_id"), doc.get("to_user_id")} != set(dm_pair):
            return None
        sender = await db["users"].find_one(
            {"_id": ObjectId(doc["from_user_id"])}, {"name": 1}
        ) if ObjectId.is_valid(doc.get("from_user_id", "")) else None
        name = (sender or {}).get("name", "") or "Unknown"
    else:
        return None

    # Carry the first attachment so the quote can show a thumbnail rather than
    # the word "attachment". Stored keyed, never as a signed URL — the snapshot
    # outlives any signature, so the read path re-signs it (see models/chat.py).
    atts = canonicalize_attachments(doc.get("attachments"))
    return {
        "id": str(doc["_id"]),
        "from_user_id": doc.get("from_user_id", ""),
        "name": name,
        "preview": _preview(doc),
        "attachment": atts[0] if atts else None,
        "attachment_count": len(atts),
    }


async def save_message(
    from_user_id: str,
    to_user_id: str,
    content: str,
    attachments: list | None = None,
    task_ids: list | None = None,
    mention_user_ids: list | None = None,
    reply_to: dict | None = None,
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
        "mention_user_ids": mention_user_ids or [],
        "reply_to": reply_to,
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
