"""
Fund requests — money for ad spend, out of Marketing's allocation in finance.

A request is saved here first and handed to finance after, so nothing typed in
is lost when finance is down or not configured yet: the worker keeps trying.
Finance decides, and the worker polls for the decision and tells the requester.

    pending    saved here, not yet accepted by finance — retried with backoff
    failed     finance refused it outright; it says why, and it can be resent
    submitted  finance has it, waiting for somebody there to review it
    approved   the amount comes off Marketing's month in finance
    rejected   nothing changes; the reviewer's note says why

Every transition is a conditional update on the status it leaves, because the
API runs several workers and each starts this worker: two of them may reach
the same request, and only the one whose update lands acts on it.
"""
import asyncio
import logging
import re
import time
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation

from bson import ObjectId
from bson.errors import InvalidId
from pymongo import ReturnDocument

from app.config import settings
from app.services import finance_client
from app.utils.timezone import utc_iso

logger = logging.getLogger(__name__)

COLLECTION = "fund_requests"
SOURCE = "media-erp"
NOTIFICATION_TYPE = "fund_request"

PLATFORMS = [
    "Meta (Facebook & Instagram)",
    "Google Ads",
    "YouTube",
    "TikTok",
    "LinkedIn",
    "Snapchat",
    "X (Twitter)",
    "WhatsApp",
    "Influencers",
    "Print & outdoor",
    "Other",
]

# Who sees everybody's requests rather than only their own — the same
# elevated set the media schedule uses.
ELEVATED_ROLES = {"Super Admin", "Admin", "Coordinator"}

STATUSES = ("pending", "failed", "submitted", "approved", "rejected")

_WORKER_EVERY_SECONDS = 60
_CLAIM_SECONDS = 120
_BACKOFF_MINUTES = (1, 2, 5, 10, 30, 60)
_MAX_MINOR = 9_000_000_000_000
_PERIOD = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def is_elevated(user: dict) -> bool:
    role = user.get("_role") or {}
    return role.get("role_name", "") in ELEVATED_ROLES


def serialize(doc: dict) -> dict:
    review = doc.get("review") or {}
    requester = doc.get("requested_by") or {}
    return {
        "id": str(doc["_id"]),
        "title": doc.get("title", ""),
        "purpose": doc.get("purpose", ""),
        "platform": doc.get("platform", ""),
        "amount_minor": doc.get("amount_minor", 0),
        "currency": doc.get("currency", settings.finance_currency),
        "period": doc.get("period", ""),
        "status": doc.get("status", "pending"),
        "requested_by": {
            "id": requester.get("id", ""),
            "name": requester.get("name", ""),
            "email": requester.get("email", ""),
        },
        "finance_error": doc.get("finance_error") or None,
        "reviewed_by": review.get("by") or None,
        "reviewed_at": utc_iso(review.get("at")),
        "review_note": review.get("note") or "",
        "created_at": utc_iso(doc.get("created_at")),
        "submitted_at": utc_iso(doc.get("submitted_at")),
        "decided_at": utc_iso(doc.get("decided_at")),
    }


# ── Validation ────────────────────────────────────────────────────────────────

def validate_create(data: dict) -> dict:
    """The same limits finance applies, checked here so the message is ours."""
    title = str(data.get("title") or "").strip()
    purpose = str(data.get("purpose") or "").strip()
    platform = str(data.get("platform") or "").strip()
    period = str(data.get("period") or "").strip()

    if not 3 <= len(title) <= 120:
        raise ValueError("Give the request a title of 3 to 120 characters")
    if not 10 <= len(purpose) <= 2000:
        raise ValueError("Explain what the money is for in 10 to 2000 characters")
    if platform not in PLATFORMS:
        raise ValueError("Choose the platform the money will be spent on")
    if not _PERIOD.match(period):
        raise ValueError("Choose the month the money is for")

    try:
        amount = Decimal(str(data.get("amount", "")).strip())
    except InvalidOperation:
        raise ValueError("Enter the amount as a number")
    if not amount.is_finite() or amount <= 0:
        raise ValueError("The amount must be more than zero")
    if amount != amount.quantize(Decimal("0.01")):
        raise ValueError("The amount can have at most two decimal places")
    amount_minor = int(amount * 100)
    if amount_minor > _MAX_MINOR:
        raise ValueError("The amount is too large")

    return {"title": title, "purpose": purpose, "platform": platform, "period": period, "amount_minor": amount_minor}


# ── API side (Motor) ──────────────────────────────────────────────────────────

async def create_request(db, user: dict, data: dict) -> dict:
    clean = validate_create(data)
    now = _now()
    doc = {
        **clean,
        "currency": settings.finance_currency.upper(),
        "status": "pending",
        "requested_by": {
            "id": str(user["_id"]),
            "name": user.get("name") or user.get("email", ""),
            "email": user.get("email", ""),
        },
        "finance_request_id": None,
        "finance_error": None,
        "attempts": 0,
        "next_attempt_at": now,
        "claimed_until": None,
        "review": None,
        "created_at": now,
        "updated_at": now,
        "submitted_at": None,
        "decided_at": None,
    }
    res = await db[COLLECTION].insert_one(doc)
    # Straight to finance, so the requester sees "waiting for approval" rather
    # than "queued". The worker is the fallback for when this does not land.
    await asyncio.to_thread(deliver_now, str(res.inserted_id))
    fresh = await db[COLLECTION].find_one({"_id": res.inserted_id})
    return serialize(fresh)


async def list_requests(db, user: dict, scope: str = "mine", status: str | None = None) -> dict:
    can_see_all = is_elevated(user)
    query: dict = {}
    if scope != "all" or not can_see_all:
        query["requested_by.id"] = str(user["_id"])
    if status in STATUSES:
        query["status"] = status
    docs = await db[COLLECTION].find(query).sort("created_at", -1).limit(300).to_list(300)
    return {
        "items": [serialize(d) for d in docs],
        "meta": {"can_see_all": can_see_all, "finance_configured": finance_client.configured()},
    }


async def retry_request(db, user: dict, request_id: str) -> dict:
    try:
        oid = ObjectId(request_id)
    except (InvalidId, TypeError):
        raise LookupError("Fund request not found")
    doc = await db[COLLECTION].find_one({"_id": oid})
    if not doc:
        raise LookupError("Fund request not found")
    if (doc.get("requested_by") or {}).get("id") != str(user["_id"]) and not is_elevated(user):
        raise PermissionError("Only the person who made this request can send it again")
    if doc.get("status") not in ("failed", "pending"):
        raise ValueError("Finance already has this request")

    now = _now()
    await db[COLLECTION].update_one(
        {"_id": oid, "status": {"$in": ["failed", "pending"]}},
        {"$set": {"status": "pending", "finance_error": None, "next_attempt_at": now, "claimed_until": None, "updated_at": now}},
    )
    await asyncio.to_thread(deliver_now, request_id)
    return serialize(await db[COLLECTION].find_one({"_id": oid}))


def meta(user: dict) -> dict:
    return {
        "platforms": PLATFORMS,
        "currency": settings.finance_currency.upper(),
        "finance_configured": finance_client.configured(),
        "can_see_all": is_elevated(user),
    }


# ── Delivery and polling (blocking; worker thread or asyncio.to_thread) ──────

def _money(doc: dict) -> str:
    return f"{doc.get('currency', '')} {doc.get('amount_minor', 0) / 100:,.2f}"


def _claim(db, request_id: str | None = None):
    """Take one pending request for delivery, so no other worker sends it too."""
    now = _now()
    query: dict = {"status": "pending", "$or": [{"claimed_until": None}, {"claimed_until": {"$lt": now}}]}
    if request_id:
        query["_id"] = ObjectId(request_id)
    else:
        query["next_attempt_at"] = {"$lte": now}
    return db[COLLECTION].find_one_and_update(
        query,
        {"$set": {"claimed_until": now + timedelta(seconds=_CLAIM_SECONDS)}},
        return_document=ReturnDocument.AFTER,
    )


def _deliver(db, doc: dict, interactive: bool) -> bool:
    """Hand one claimed request to finance. True when finance accepted it."""
    now = _now()
    requester = doc.get("requested_by") or {}
    payload = {
        "source": SOURCE,
        # Our own id: finance is idempotent on it, so a retry after a timeout
        # returns the request already made instead of making a second one.
        "externalId": str(doc["_id"]),
        "departmentId": settings.finance_department_id,
        "period": doc["period"],
        "currency": doc["currency"],
        "amountMinor": doc["amount_minor"],
        "title": doc["title"],
        "purpose": doc["purpose"],
        "platform": doc.get("platform", ""),
        "requestedBy": {"name": requester.get("name", ""), "email": requester.get("email", "")},
    }
    attempts = int(doc.get("attempts") or 0) + 1
    try:
        data = finance_client.submit_fund_request(payload)
    except finance_client.FinanceNotConfigured as exc:
        db[COLLECTION].update_one(
            {"_id": doc["_id"], "status": "pending"},
            {"$set": {"finance_error": str(exc), "next_attempt_at": now + timedelta(minutes=10), "claimed_until": None, "updated_at": now}},
        )
        return False
    except finance_client.FinanceError as exc:
        if exc.permanent:
            res = db[COLLECTION].update_one(
                {"_id": doc["_id"], "status": "pending"},
                {"$set": {"status": "failed", "finance_error": str(exc), "attempts": attempts, "claimed_until": None, "updated_at": now}},
            )
            # Somebody who just pressed submit sees the reason on screen; one
            # whose request failed later, in the background, needs telling.
            if res.modified_count and not interactive:
                _notify(db, doc, "Fund request not accepted", f"Finance refused “{doc['title']}” ({_money(doc)}): {exc}. Open it to send it again.", "failed")
        else:
            wait = _BACKOFF_MINUTES[min(attempts - 1, len(_BACKOFF_MINUTES) - 1)]
            db[COLLECTION].update_one(
                {"_id": doc["_id"], "status": "pending"},
                {"$set": {"finance_error": str(exc), "attempts": attempts, "next_attempt_at": now + timedelta(minutes=wait), "claimed_until": None, "updated_at": now}},
            )
        logger.warning("fund_requests: %s not delivered: %s", doc["_id"], exc)
        return False

    db[COLLECTION].update_one(
        {"_id": doc["_id"], "status": "pending"},
        {"$set": {
            "status": "submitted", "finance_request_id": (data or {}).get("id"), "finance_error": None,
            "attempts": attempts, "claimed_until": None, "submitted_at": now, "updated_at": now,
        }},
    )
    # Finance returns the request it already had on a retry — which may have
    # been decided in the meantime.
    if (data or {}).get("status") in ("approved", "rejected"):
        _apply_decision(db, {
            "externalId": str(doc["_id"]), "status": data["status"],
            "reviewedByName": data.get("reviewedByName", ""), "reviewedAt": data.get("reviewedAt", ""),
            "reviewNote": data.get("reviewNote", ""),
        })
    return True


def deliver_now(request_id: str) -> bool:
    """Send one request straight away (the submit and resend buttons)."""
    from app.database import get_sync_db
    db = get_sync_db()
    doc = _claim(db, request_id)
    return _deliver(db, doc, interactive=True) if doc else False


def deliver_due(db) -> int:
    delivered = 0
    for _ in range(50):
        doc = _claim(db)
        if not doc:
            break
        delivered += 1 if _deliver(db, doc, interactive=False) else 0
    return delivered


def _parse_iso(value: str) -> datetime | None:
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")) if value else None
    except ValueError:
        return None


def _apply_decision(db, row: dict) -> bool:
    try:
        oid = ObjectId(row.get("externalId", ""))
    except (InvalidId, TypeError):
        return False
    now = _now()
    doc = db[COLLECTION].find_one_and_update(
        {"_id": oid, "status": "submitted"},
        {"$set": {
            "status": row["status"],
            "review": {
                "by": row.get("reviewedByName") or "",
                "at": _parse_iso(row.get("reviewedAt") or "") or now,
                "note": row.get("reviewNote") or "",
            },
            "decided_at": now,
            "updated_at": now,
        }},
        return_document=ReturnDocument.AFTER,
    )
    if not doc:
        return False  # another worker got there first, and it has told them

    note = (doc.get("review") or {}).get("note") or ""
    if doc["status"] == "approved":
        _notify(db, doc, "Fund request approved",
                f"Finance approved {_money(doc)} for “{doc['title']}” ({doc.get('platform', '')})." + (f" Note: {note}" if note else ""),
                "approved")
    else:
        _notify(db, doc, "Fund request rejected",
                f"Finance rejected “{doc['title']}” ({_money(doc)}): {note or 'no reason given'}",
                "rejected")
    return True


def poll_decisions(db) -> int:
    ids = [str(d["_id"]) for d in db[COLLECTION].find({"status": "submitted"}, {"_id": 1}).sort("submitted_at", 1).limit(200)]
    if not ids:
        return 0
    rows = finance_client.fund_request_statuses(SOURCE, ids)
    return sum(1 for row in rows if row.get("status") in ("approved", "rejected") and _apply_decision(db, row))


def _notify(db, doc: dict, title: str, message: str, status: str) -> None:
    """In-app row first, then web push. Never raises: the decision stands regardless."""
    from app.services.notification_service import create_notification_sync
    from app.services import web_push_service

    user_id = (doc.get("requested_by") or {}).get("id")
    if not user_id:
        return
    metadata = {"fund_request_id": str(doc["_id"]), "status": status}
    try:
        notification_id = create_notification_sync(db, user_id, NOTIFICATION_TYPE, title, message, metadata)
    except Exception:
        logger.exception("fund_requests: could not write the notification for %s", doc["_id"])
        return
    try:
        web_push_service.send_to_user_sync(db, user_id, {
            "id": notification_id, "type": NOTIFICATION_TYPE, "title": title, "message": message, "metadata": metadata,
        })
    except Exception:
        logger.warning("fund_requests: web push failed for %s", doc["_id"])


def run_once() -> tuple[int, int]:
    """One pass: send what is due, then collect decisions. Returns (sent, decided)."""
    from app.database import get_sync_db
    if not finance_client.configured():
        return (0, 0)
    db = get_sync_db()
    sent = deliver_due(db)
    try:
        decided = poll_decisions(db)
    except finance_client.FinanceError as exc:
        logger.warning("fund_requests: could not ask finance for decisions: %s", exc)
        decided = 0
    return (sent, decided)


def start_fund_request_worker():
    """Entry point for the daemon thread. Runs forever."""
    logger.info("Fund request worker started")
    while True:
        try:
            run_once()
        except Exception:
            logger.exception("fund_requests: error in worker loop")
        time.sleep(_WORKER_EVERY_SECONDS)
