from app.utils.storage import sign_attachment, sign_attachments


def sign_reply(reply: dict | None) -> dict | None:
    """
    Re-sign the thumbnail carried by a quote.

    The snapshot is stored keyed and outlives any signature, so the attachment
    inside it needs signing on the way out exactly like the message's own —
    handing back the stored value would render a quote pointing at a bare key.
    """
    if not isinstance(reply, dict):
        return None
    att = reply.get("attachment")
    if not isinstance(att, dict):
        return reply
    return {**reply, "attachment": sign_attachment(att)}


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
        "reply_to": sign_reply(doc.get("reply_to")),
        # A withdrawn message keeps its row so replies and counts still resolve;
        # the client renders a tombstone rather than empty text.
        "deleted": bool(doc.get("deleted_at")),
        "read_at": doc["read_at"].isoformat() if doc.get("read_at") else None,
        "created_at": doc["created_at"].isoformat() if doc.get("created_at") else None,
    }
