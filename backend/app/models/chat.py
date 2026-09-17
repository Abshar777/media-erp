from app.utils.storage import sign_attachments


def message_to_dict(doc: dict) -> dict:
    return {
        "id": str(doc["_id"]),
        "from_user_id": doc["from_user_id"],
        "to_user_id": doc["to_user_id"],
        "content": doc["content"],
        "read": doc.get("read", False),
        # Private bucket — attachments are signed per read (see utils/storage.py).
        "attachments": sign_attachments(doc.get("attachments", [])),
        "task_ids": doc.get("task_ids", []),
        # Snapshot of the quoted message, or None. See chat_service.build_reply_snapshot.
        "reply_to": doc.get("reply_to"),
        "created_at": doc["created_at"].isoformat() if doc.get("created_at") else None,
    }
