"""
Notification service — Phase 7.2.

Provides helpers used by:
  - sync_service (Celery, synchronous PyMongo)
  - notifications router (FastAPI, async Motor)
"""
import asyncio
import logging
from datetime import datetime, timezone

from bson import ObjectId
from bson.errors import InvalidId

from app.models.notification import notification_doc
from app.utils.timezone import utc_iso

logger = logging.getLogger(__name__)


# ── Sync helpers (used by Celery / sync_service) ─────────────────────────────

def create_notification_sync(
    db,
    user_id: str,
    notification_type: str,
    title: str,
    message: str,
    metadata: dict | None = None,
) -> str:
    """Insert a notification using a synchronous PyMongo client."""
    doc = notification_doc(user_id, notification_type, title, message, metadata)
    result = db["notifications"].insert_one(doc)
    return str(result.inserted_id)


# ── Async helpers (used by FastAPI router) ────────────────────────────────────

async def push_notification(
    db,
    user_id: str,
    notification_type: str,
    title: str,
    message: str,
    metadata: dict | None = None,
) -> str | None:
    """Insert a notification using the async Motor client. Returns inserted id or None."""
    try:
        doc = notification_doc(user_id, notification_type, title, message, metadata)
        result = await db["notifications"].insert_one(doc)

        # Push it down the chat WebSocket so the bell updates immediately
        # instead of waiting up to 60s for the next poll. Best-effort: the row
        # is already written, so a socket failure only costs immediacy, and the
        # poll remains the backstop for anyone who is offline right now.
        try:
            # Lazy import — app.routers.chat imports services at module load,
            # so a top-level import here would be circular.
            from app.routers.chat import manager
            await manager.send(user_id, {
                "type": "notification",
                "notification": {
                    "id": str(result.inserted_id),
                    "type": notification_type,
                    "title": title,
                    "message": message,
                    "read": False,
                    "metadata": metadata or {},
                    "created_at": utc_iso(doc["created_at"]),
                },
            })
        except Exception:
            pass

        # Web push — reaches a browser that is closed or has the app unloaded,
        # which the socket above cannot. Backgrounded: pywebpush is blocking and
        # a user may have several devices, so it must not hold up the request.
        try:
            from app.services import web_push_service
            asyncio.create_task(
                web_push_service.send_to_user(db, user_id, {
                    "id": str(result.inserted_id),
                    "type": notification_type,
                    "title": title,
                    "message": message,
                    "metadata": metadata or {},
                })
            )
        except Exception:
            pass

        # Fire email in background — never blocks the request
        asyncio.create_task(
            _send_email_if_opted_in(db, user_id, notification_type, title, message, metadata)
        )
        return str(result.inserted_id)
    except Exception:
        return None


async def _send_email_if_opted_in(
    db, user_id: str, notif_type: str, title: str, message: str, metadata: dict | None = None
) -> None:
    """Send an email notification if SMTP is configured and both the user AND the
    task's team have this type enabled.

    Gate = SMTP configured AND user master-on AND user allows type AND team allows type.
    A team leader can suppress a type team-wide via the team's `email_types` map.
    """
    try:
        from app.utils.email import get_smtp_config, send_email_db

        smtp = await get_smtp_config(db)
        if not smtp:
            return  # No SMTP configured yet

        # ── Team-level override (leader controls the team's emails) ──────────────
        team_id = (metadata or {}).get("team_id")
        if team_id and ObjectId.is_valid(team_id):
            team = await db["teams"].find_one({"_id": ObjectId(team_id)}, {"email_types": 1})
            team_types = (team or {}).get("email_types") or {}
            if notif_type in team_types and not team_types[notif_type]:
                return  # team leader suppressed this type for the whole team

        prefs = await db["notification_prefs"].find_one({"user_id": user_id})
        if not (prefs or {}).get("email_enabled", True):
            return
        email_types = (prefs or {}).get("email_types", {})
        if notif_type in email_types and not email_types[notif_type]:
            return

        user = await db["users"].find_one({"_id": ObjectId(user_id)}, {"email": 1, "name": 1})
        if not user or not user.get("email"):
            return

        await send_email_db(db, user["email"], f"mediaERP: {title}", _notif_email_html(title, message))
    except Exception as _e:
        logger.error("Email notification failed for user %s / type %s: %s", user_id, notif_type, _e, exc_info=True)


def _notif_email_html(title: str, message: str) -> str:
    return f"""<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 0;">
    <tr><td align="center">
      <table width="480" cellpadding="0" cellspacing="0"
             style="background:#fff;border-radius:12px;overflow:hidden;
                    box-shadow:0 2px 8px rgba(0,0,0,.08);">
        <tr><td style="background:#18181b;padding:28px 36px;">
          <span style="font-size:20px;font-weight:700;color:#fff;">mediaERP</span>
        </td></tr>
        <tr><td style="padding:36px;">
          <h2 style="margin:0 0 12px;color:#18181b;">{title}</h2>
          <p style="color:#555;font-size:15px;line-height:1.6;">{message}</p>
        </td></tr>
        <tr><td style="background:#f9f9f9;padding:16px 36px;border-top:1px solid #eee;">
          <p style="margin:0;font-size:12px;color:#aaa;">
            &copy; 2025 mediaERP &mdash; Carlton Trading Academy
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>"""


async def check_due_reminders(db, user_id: str) -> None:
    """Create due-date reminder notifications for tasks assigned to user_id due tomorrow."""
    try:
        from datetime import timedelta
        now      = datetime.now(timezone.utc)
        tomorrow = (now + timedelta(days=1)).strftime("%Y-%m-%d")
        today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)

        tasks = await db["project_tasks"].find({
            "assigned_to": user_id,
            "due_date": tomorrow,
            "status": {"$nin": ["approved"]},
        }).to_list(50)

        for task in tasks:
            task_id = str(task["_id"])
            # Skip if we already sent a reminder today
            existing = await db["notifications"].find_one({
                "user_id": ObjectId(user_id),
                "type": "due_date_reminder",
                "metadata.task_id": task_id,
                "created_at": {"$gte": today_start},
            })
            if not existing:
                await push_notification(
                    db, user_id, "due_date_reminder",
                    "Task due tomorrow",
                    f'"{task.get("title", "Task")}" is due tomorrow. Submit for review!',
                    {"task_id": task_id, "task_title": task.get("title", "")},
                )
    except Exception:
        pass  # never let reminder check break the main request


async def list_notifications(
    db,
    user_id: str,
    limit: int = 20,
    unread_only: bool = False,
) -> dict:
    """Return paginated notifications for a user, newest first."""
    query: dict = {"user_id": ObjectId(user_id)}
    if unread_only:
        query["read"] = False

    cursor = db["notifications"].find(query).sort("created_at", -1).limit(limit)
    items = []
    async for doc in cursor:
        items.append({
            "id": str(doc["_id"]),
            "type": doc["type"],
            "title": doc["title"],
            "message": doc["message"],
            "read": doc["read"],
            "metadata": doc.get("metadata", {}),
            "created_at": utc_iso(doc["created_at"]),
        })

    total_unread = await db["notifications"].count_documents(
        {"user_id": ObjectId(user_id), "read": False}
    )
    return {"items": items, "unread_count": total_unread}


async def mark_read(db, notification_id: str, user_id: str) -> bool:
    """Mark a single notification as read. Returns True if found+updated."""
    try:
        oid = ObjectId(notification_id)
    except InvalidId:
        return False

    result = await db["notifications"].update_one(
        {"_id": oid, "user_id": ObjectId(user_id)},
        {"$set": {"read": True}},
    )
    return result.matched_count > 0


async def mark_all_read(db, user_id: str) -> int:
    """Mark all notifications for a user as read. Returns count modified."""
    result = await db["notifications"].update_many(
        {"user_id": ObjectId(user_id), "read": False},
        {"$set": {"read": True}},
    )
    return result.modified_count
