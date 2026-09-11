"""
Web Push delivery (RFC 8030 / VAPID).

Complements the WebSocket push: the socket reaches an open tab instantly, this
reaches a browser that is closed or has the app unloaded. Both are best-effort
on top of the notification row, which is always written first.

Subscriptions are per browser+device, so one user legitimately has several.
"""
import asyncio
import json
import logging

from app.config import settings

logger = logging.getLogger(__name__)

COLLECTION = "push_subscriptions"

# Only interrupt someone for these. Mirrors ALERT_TYPES in the frontend's
# lib/browserNotifications.ts — keep the two in step.
ALERT_TYPES = {"mention", "task_assigned", "pending_review", "task_reedit"}


async def save_subscription(db, user_id: str, subscription: dict) -> None:
    """
    Upsert by endpoint: the endpoint is the browser's unique address, so
    re-subscribing the same device updates rather than duplicating.
    """
    endpoint = (subscription or {}).get("endpoint")
    if not endpoint:
        raise ValueError("subscription has no endpoint")
    from datetime import datetime, timezone
    await db[COLLECTION].update_one(
        {"endpoint": endpoint},
        {"$set": {
            "user_id": user_id,
            "endpoint": endpoint,
            "keys": (subscription or {}).get("keys", {}),
            "updated_at": datetime.now(timezone.utc),
        },
         "$setOnInsert": {"created_at": datetime.now(timezone.utc)}},
        upsert=True,
    )


async def delete_subscription(db, endpoint: str) -> int:
    res = await db[COLLECTION].delete_one({"endpoint": endpoint})
    return res.deleted_count


def _send_one_sync(sub: dict, payload: dict) -> int | None:
    """
    Blocking send. Returns the HTTP status when the push service rejected it,
    or None on success. pywebpush is requests-based, so callers push this to a
    worker thread rather than blocking the event loop.
    """
    from pywebpush import webpush, WebPushException
    try:
        webpush(
            subscription_info={"endpoint": sub["endpoint"], "keys": sub.get("keys", {})},
            data=json.dumps(payload),
            vapid_private_key=settings.vapid_private_key,
            vapid_claims={"sub": settings.vapid_subject},
            timeout=10,
            # Default TTL is 0 — "deliver this instant or throw it away", so a
            # phone that is briefly offline loses the alert outright. A day
            # lets the push service hold it until the device reappears.
            ttl=86400,
        )
        return None
    except WebPushException as exc:
        return getattr(exc.response, "status_code", 0) or 0
    except Exception:
        return 0


async def send_to_user(db, user_id: str, notification: dict) -> None:
    """
    Fan a notification out to every browser this user has subscribed.

    Never raises — the notification row already exists, so a push failure only
    costs the alert. Subscriptions the push service reports as gone (404/410)
    are deleted, otherwise dead endpoints accumulate forever and every send
    pays for them.
    """
    if not settings.web_push_enabled:
        return
    if notification.get("type") not in ALERT_TYPES:
        return

    subs = await db[COLLECTION].find({"user_id": user_id}).to_list(50)
    if not subs:
        return

    payload = {
        "id": notification.get("id", ""),
        "type": notification.get("type", "info"),
        "title": notification.get("title", "mediaERP"),
        "message": notification.get("message", ""),
        "metadata": notification.get("metadata", {}),
    }

    for sub in subs:
        try:
            status = await asyncio.to_thread(_send_one_sync, sub, payload)
        except Exception as exc:
            logger.warning("web push failed: %s", exc)
            continue
        if status in (404, 410):
            # Subscription is permanently gone (site data cleared, app removed).
            await db[COLLECTION].delete_one({"_id": sub["_id"]})
        elif status:
            logger.warning("web push rejected (%s) for %s", status, sub.get("endpoint", "")[:60])
