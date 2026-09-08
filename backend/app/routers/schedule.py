"""
Post scheduling CRUD — Phase 2.
Create, list, update, and cancel scheduled social media posts.
The actual publishing is handled by app/services/schedule_service.py (background thread).
"""
import logging
from datetime import datetime, timezone
from typing import Optional

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Depends, Query
from motor.motor_asyncio import AsyncIOMotorDatabase
from pydantic import BaseModel

from app.database import get_db
from app.middleware.auth import get_current_user
from app.utils.response import error_response, success_response
from app.utils.storage import key_from_url, resolve_media_url
from app.utils.timezone import utc_iso

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/schedule", tags=["schedule"])


def _store_media_url(url: str | None) -> str | None:
    """
    Reduce an incoming media URL to a bare storage key before persisting.

    The composer sends back the short-lived signed URL it was given; storing
    that would leave a dead link in a post that publishes hours later. Keeping
    the key means schedule_service can sign afresh at publish time. External
    URLs are stored untouched.
    """
    if not url:
        return url
    return key_from_url(url) or url


# ── Schemas ───────────────────────────────────────────────────────────────────

class ScheduledPostCreate(BaseModel):
    connector_id: str
    platform: str                        # "instagram_login" | "facebook_pages"
    caption: str
    image_url: Optional[str] = None
    video_url: Optional[str] = None
    scheduled_at: str                    # ISO datetime string (UTC)
    page_id: Optional[str] = None        # required for facebook_pages
    ig_user_id: Optional[str] = None     # for instagram_login (overrides connector default)


class ScheduledPostUpdate(BaseModel):
    scheduled_at: Optional[str] = None
    caption: Optional[str] = None
    image_url: Optional[str] = None
    video_url: Optional[str] = None


# ── Helpers ───────────────────────────────────────────────────────────────────

_SUPPORTED_PLATFORMS = {"instagram_login", "facebook_pages"}


def _parse_dt(dt_str: str) -> datetime:
    """Parse an ISO datetime string, returning a UTC-aware datetime."""
    dt = datetime.fromisoformat(dt_str.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def _serialize_post(doc: dict) -> dict:
    """Convert a scheduled_posts MongoDB document to a JSON-serialisable dict."""
    def _iso(val):
        if isinstance(val, datetime):
            return utc_iso(val)
        return val

    return {
        "id": str(doc["_id"]),
        "user_id": doc.get("user_id", ""),
        "connector_id": doc.get("connector_id", ""),
        "platform": doc.get("platform", ""),
        "caption": doc.get("caption", ""),
        # Stored as a key; signed here so the composer can preview it.
        "image_url": resolve_media_url(doc.get("image_url")),
        "video_url": resolve_media_url(doc.get("video_url")),
        "scheduled_at": _iso(doc.get("scheduled_at")),
        "status": doc.get("status", "pending"),
        "published_at": _iso(doc.get("published_at")),
        "error": doc.get("error"),
        "page_id": doc.get("page_id"),
        "ig_user_id": doc.get("ig_user_id"),
        "created_at": _iso(doc.get("created_at")),
        "updated_at": _iso(doc.get("updated_at")),
    }


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/posts", summary="Create a new scheduled post")
async def create_scheduled_post(
    body: ScheduledPostCreate,
    db: AsyncIOMotorDatabase = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Schedule a post for future publishing on Instagram Login or Facebook Pages."""
    user_id = str(current_user["_id"])

    # Validate platform
    if body.platform not in _SUPPORTED_PLATFORMS:
        return error_response(
            message=f"Unsupported platform '{body.platform}'. Must be one of: {', '.join(_SUPPORTED_PLATFORMS)}",
            status_code=422,
        )

    # Validate platform-specific requirements
    if body.platform == "facebook_pages" and not body.page_id:
        return error_response(message="page_id is required for facebook_pages posts", status_code=422)

    # Parse and validate scheduled_at
    try:
        scheduled_dt = _parse_dt(body.scheduled_at)
    except (ValueError, TypeError) as exc:
        return error_response(message=f"Invalid scheduled_at datetime: {exc}", status_code=422)

    if scheduled_dt <= datetime.now(timezone.utc):
        return error_response(message="scheduled_at must be in the future", status_code=422)

    # Verify the connector exists and belongs to the user
    try:
        connector_oid = ObjectId(body.connector_id)
    except InvalidId:
        return error_response(message="Invalid connector_id", status_code=422)

    connector = await db["connectors"].find_one({
        "_id": connector_oid,
        "user_id": user_id,
        "platform": body.platform,
    })
    if not connector:
        return error_response(message="Connector not found or platform mismatch", status_code=404)

    now = datetime.now(timezone.utc)
    doc = {
        "user_id": user_id,
        "connector_id": body.connector_id,
        "platform": body.platform,
        "caption": body.caption,
        "image_url": _store_media_url(body.image_url),
        "video_url": _store_media_url(body.video_url),
        "scheduled_at": scheduled_dt,
        "status": "pending",
        "published_at": None,
        "error": None,
        "page_id": body.page_id,
        "ig_user_id": body.ig_user_id,
        "created_at": now,
        "updated_at": now,
    }

    result = await db["scheduled_posts"].insert_one(doc)
    doc["_id"] = result.inserted_id

    return success_response(data=_serialize_post(doc), message="Post scheduled successfully")


@router.get("/posts", summary="List scheduled posts")
async def list_scheduled_posts(
    status: Optional[str] = Query(None, description="Filter by status: pending|published|failed|cancelled"),
    platform: Optional[str] = Query(None, description="Filter by platform"),
    from_date: Optional[str] = Query(None, alias="from", description="ISO date, lower bound on scheduled_at"),
    to_date: Optional[str] = Query(None, alias="to", description="ISO date, upper bound on scheduled_at"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncIOMotorDatabase = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """List the current user's scheduled posts with optional filters."""
    user_id = str(current_user["_id"])

    query: dict = {"user_id": user_id}

    if status:
        query["status"] = status
    if platform:
        query["platform"] = platform

    scheduled_at_filter: dict = {}
    if from_date:
        try:
            scheduled_at_filter["$gte"] = _parse_dt(from_date)
        except (ValueError, TypeError):
            return error_response(message="Invalid from date format", status_code=422)
    if to_date:
        try:
            scheduled_at_filter["$lte"] = _parse_dt(to_date)
        except (ValueError, TypeError):
            return error_response(message="Invalid to date format", status_code=422)
    if scheduled_at_filter:
        query["scheduled_at"] = scheduled_at_filter

    total = await db["scheduled_posts"].count_documents(query)
    cursor = (
        db["scheduled_posts"]
        .find(query)
        .sort("scheduled_at", 1)
        .skip(offset)
        .limit(limit)
    )
    posts = [_serialize_post(doc) async for doc in cursor]

    return success_response(
        data={"posts": posts, "total": total, "limit": limit, "offset": offset},
        message="Scheduled posts retrieved",
    )


@router.get("/posts/{post_id}", summary="Get a single scheduled post")
async def get_scheduled_post(
    post_id: str,
    db: AsyncIOMotorDatabase = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    user_id = str(current_user["_id"])

    try:
        oid = ObjectId(post_id)
    except InvalidId:
        return error_response(message="Invalid post ID", status_code=422)

    doc = await db["scheduled_posts"].find_one({"_id": oid, "user_id": user_id})
    if not doc:
        return error_response(message="Scheduled post not found", status_code=404)

    return success_response(data=_serialize_post(doc), message="Scheduled post retrieved")


@router.patch("/posts/{post_id}", summary="Update a scheduled post")
async def update_scheduled_post(
    post_id: str,
    body: ScheduledPostUpdate,
    db: AsyncIOMotorDatabase = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """
    Update scheduled_at, caption, image_url, or video_url for a pending post.
    Only pending posts can be updated.
    """
    user_id = str(current_user["_id"])

    try:
        oid = ObjectId(post_id)
    except InvalidId:
        return error_response(message="Invalid post ID", status_code=422)

    doc = await db["scheduled_posts"].find_one({"_id": oid, "user_id": user_id})
    if not doc:
        return error_response(message="Scheduled post not found", status_code=404)

    if doc.get("status") != "pending":
        return error_response(
            message=f"Cannot update a post with status '{doc.get('status')}'. Only pending posts can be updated.",
            status_code=409,
        )

    updates: dict = {"updated_at": datetime.now(timezone.utc)}

    if body.scheduled_at is not None:
        try:
            scheduled_dt = _parse_dt(body.scheduled_at)
        except (ValueError, TypeError) as exc:
            return error_response(message=f"Invalid scheduled_at: {exc}", status_code=422)
        if scheduled_dt <= datetime.now(timezone.utc):
            return error_response(message="scheduled_at must be in the future", status_code=422)
        updates["scheduled_at"] = scheduled_dt

    if body.caption is not None:
        updates["caption"] = body.caption
    if body.image_url is not None:
        updates["image_url"] = _store_media_url(body.image_url)
    if body.video_url is not None:
        updates["video_url"] = _store_media_url(body.video_url)

    await db["scheduled_posts"].update_one({"_id": oid}, {"$set": updates})

    updated_doc = await db["scheduled_posts"].find_one({"_id": oid})
    return success_response(data=_serialize_post(updated_doc), message="Scheduled post updated")


@router.delete("/posts/{post_id}", summary="Cancel a scheduled post")
async def cancel_scheduled_post(
    post_id: str,
    db: AsyncIOMotorDatabase = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Cancel a pending scheduled post (sets status to 'cancelled')."""
    user_id = str(current_user["_id"])

    try:
        oid = ObjectId(post_id)
    except InvalidId:
        return error_response(message="Invalid post ID", status_code=422)

    doc = await db["scheduled_posts"].find_one({"_id": oid, "user_id": user_id})
    if not doc:
        return error_response(message="Scheduled post not found", status_code=404)

    if doc.get("status") not in ("pending",):
        return error_response(
            message=f"Cannot cancel a post with status '{doc.get('status')}'. Only pending posts can be cancelled.",
            status_code=409,
        )

    now = datetime.now(timezone.utc)
    await db["scheduled_posts"].update_one(
        {"_id": oid},
        {"$set": {"status": "cancelled", "updated_at": now}},
    )

    return success_response(data={"id": post_id, "status": "cancelled"}, message="Scheduled post cancelled")
