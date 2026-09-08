"""
Post scheduling background service.
Runs as a daemon thread, polls every 60 seconds for due scheduled posts.
"""
import asyncio
import logging
import time
from datetime import datetime, timezone

logger = logging.getLogger(__name__)


def start_scheduler():
    """Entry point for the daemon thread. Runs forever."""
    logger.info("Post scheduler started")
    while True:
        try:
            _process_due_posts()
        except Exception as exc:
            logger.error("Scheduler error: %s", exc)
        time.sleep(60)


def _process_due_posts():
    from app.database import get_sync_db
    db = get_sync_db()
    now = datetime.now(timezone.utc)

    posts = list(db["scheduled_posts"].find({
        "status": "pending",
        "scheduled_at": {"$lte": now}
    }))

    if not posts:
        return

    logger.info("Processing %d due scheduled posts", len(posts))

    for post in posts:
        post_id = post["_id"]
        # Mark as processing (optimistic lock to avoid double-publish)
        result = db["scheduled_posts"].update_one(
            {"_id": post_id, "status": "pending"},
            {"$set": {"status": "processing", "updated_at": now}}
        )
        if result.modified_count == 0:
            continue  # another thread already grabbed it

        try:
            _publish_post(db, post)
            db["scheduled_posts"].update_one(
                {"_id": post_id},
                {"$set": {
                    "status": "published",
                    "published_at": datetime.now(timezone.utc),
                    "updated_at": datetime.now(timezone.utc),
                    "error": None,
                }}
            )
            logger.info("Published scheduled post %s", post_id)
        except Exception as exc:
            logger.error("Failed to publish scheduled post %s: %s", post_id, exc)
            # Sanitize error before storing — strip any access_token query params
            import re
            safe_err = re.sub(r'access_token=[^&\s"\']+', 'access_token=***', str(exc))[:500]
            db["scheduled_posts"].update_one(
                {"_id": post_id},
                {"$set": {
                    "status": "failed",
                    "error": safe_err,
                    "updated_at": datetime.now(timezone.utc),
                }}
            )


def _publish_post(db, post: dict):
    """Publish a single post via the appropriate platform."""
    platform = post["platform"]
    connector_id = post["connector_id"]

    # Load connector and decrypt token
    from bson import ObjectId
    from app.utils.encryption import decrypt
    connector = db["connectors"].find_one({"_id": ObjectId(connector_id)})
    if not connector:
        raise ValueError(f"Connector {connector_id} not found")
    if not connector.get("encrypted_access_token"):
        raise ValueError("Connector has no access token")

    access_token = decrypt(connector["encrypted_access_token"])

    # The bucket is private and this runs long after the post was scheduled, so
    # sign the media NOW — a URL signed at schedule time would have expired.
    # External URLs pass through unchanged.
    from app.utils.storage import resolve_media_url
    _MEDIA_TTL = 3600
    image_url = resolve_media_url(post.get("image_url"), _MEDIA_TTL)
    video_url = resolve_media_url(post.get("video_url"), _MEDIA_TTL)

    # Use asyncio.run to call async platform functions from sync context
    if platform == "instagram_login":
        ig_user_id = post.get("ig_user_id") or connector.get("platform_account_id")
        if not ig_user_id:
            raise ValueError("No Instagram user ID available")
        from app.platforms.instagram_login import publish_post
        asyncio.run(publish_post(
            ig_user_id=ig_user_id,
            access_token=access_token,
            caption=post.get("caption", ""),
            image_url=image_url,
            video_url=video_url,
        ))
    elif platform == "facebook_pages":
        page_id = post.get("page_id")
        if not page_id:
            raise ValueError("No Facebook page ID for scheduled post")
        from app.platforms.facebook_pages import publish_post as fb_publish
        asyncio.run(fb_publish(
            page_id=page_id,
            page_token=access_token,
            message=post.get("caption", ""),
            image_url=image_url,
        ))
    else:
        raise ValueError(f"Unsupported platform for scheduling: {platform}")
