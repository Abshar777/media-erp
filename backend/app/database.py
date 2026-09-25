from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from pymongo import MongoClient, ASCENDING, DESCENDING
from app.config import settings

_client: AsyncIOMotorClient | None = None

# ── Synchronous client for Celery tasks (Motor is async-only) ────────────────
_sync_client: MongoClient | None = None


def get_sync_db():
    """
    Return a synchronous PyMongo database handle.
    Used by Celery tasks which run in their own thread/process and cannot
    use asyncio. Call once per task — PyMongo handles connection pooling.
    """
    global _sync_client
    if _sync_client is None:
        _sync_client = MongoClient(settings.mongodb_url)
    return _sync_client[settings.mongodb_db_name]


async def connect_db() -> None:
    global _client
    _client = AsyncIOMotorClient(settings.mongodb_url)


async def close_db() -> None:
    global _client
    if _client is not None:
        _client.close()
        _client = None


def get_db() -> AsyncIOMotorDatabase:
    if _client is None:
        raise RuntimeError("Database not connected. Call connect_db() first.")
    return _client[settings.mongodb_db_name]


async def create_indexes() -> None:
    """Populated incrementally as models are added (features 1.7, 2.1, …)."""
    db = get_db()
    # 1.7 — users
    await db["users"].create_index("email", unique=True)
    # 2.1 — connectors
    await db["connectors"].create_index([("user_id", 1), ("platform", 1)])
    await db["connectors"].create_index("user_id")
    # 3.1 — marketing_data
    await db["marketing_data"].create_index(
        [
            ("user_id", ASCENDING),
            ("platform", ASCENDING),
            ("date", ASCENDING),
            ("campaign_id", ASCENDING),
        ],
        unique=True,
        name="unique_data_point",
    )
    await db["marketing_data"].create_index([("user_id", ASCENDING), ("date", DESCENDING)])
    await db["marketing_data"].create_index([("user_id", ASCENDING), ("platform", ASCENDING), ("date", DESCENDING)])
    await db["marketing_data"].create_index([("connector_id", ASCENDING), ("date", DESCENDING)])
    # 3.1 — sync_runs (history per connector)
    await db["sync_runs"].create_index([("connector_id", ASCENDING), ("started_at", DESCENDING)])
    # 4.5 — reports (saved reports)
    await db["reports"].create_index([("user_id", ASCENDING), ("created_at", DESCENDING)])
    await db["reports"].create_index("share_token", sparse=True)
    # 6.2 — ai_queries
    await db["ai_queries"].create_index([("user_id", ASCENDING), ("created_at", DESCENDING)])
    # 7.2 — notifications
    await db["notifications"].create_index([("user_id", ASCENDING), ("created_at", DESCENDING)])
    await db["notifications"].create_index([("user_id", ASCENDING), ("read", ASCENDING)])
    # projects / kanban tasks
    await db["project_tasks"].create_index([("created_at", DESCENDING)])
    await db["project_tasks"].create_index([("status", ASCENDING)])
    # roles
    await db["roles"].create_index("role_name", unique=True)
    # users — role_id lookup
    await db["users"].create_index("role_id")
    # chat messages
    await db["messages"].create_index([("from_user_id", ASCENDING), ("to_user_id", ASCENDING), ("created_at", DESCENDING)])
    await db["messages"].create_index([("to_user_id", ASCENDING), ("read", ASCENDING)])
    # password_resets — OTP-based (migrated from token-based)
    # Drop old token unique index if it exists from a previous schema
    try:
        await db["password_resets"].drop_index("token_1")
    except Exception:
        pass  # Index didn't exist — that's fine
    await db["password_resets"].create_index("user_id")   # one reset doc per user (upsert key)
    await db["password_resets"].create_index("email")     # lookup by email + otp
    await db["password_resets"].create_index(
        "expires_at", expireAfterSeconds=0  # TTL: MongoDB auto-deletes expired docs
    )
    # rules & triggers (Feature 9)
    await db["rules"].create_index([("user_id", ASCENDING), ("enabled", ASCENDING)])
    await db["rules"].create_index([("user_id", ASCENDING), ("created_at", DESCENDING)])
    await db["rule_triggers"].create_index([("user_id", ASCENDING), ("triggered_at", DESCENDING)])
    await db["rule_triggers"].create_index("rule_id")
    # email schedules (Feature 6)
    await db["email_schedules"].create_index([("user_id", ASCENDING), ("enabled", ASCENDING)])
    await db["email_schedules"].create_index("next_send_at")
    # subscriptions (Feature 5)
    await db["subscriptions"].create_index("user_id", unique=True)
    await db["subscriptions"].create_index("stripe_customer_id")
    # clients (Feature 10)
    await db["clients"].create_index([("agency_user_id", ASCENDING), ("status", ASCENDING)])
    await db["clients"].create_index([("agency_user_id", ASCENDING), ("created_at", DESCENDING)])
    await db["clients"].create_index("invite_token")
    # white-label (Feature 18)
    await db["whitelabel"].create_index("user_id", unique=True)
    # social_messages — webhook-persisted DMs (Feature: webhook DM persistence)
    await db["social_messages"].create_index("mid", unique=True, sparse=True)
    await db["social_messages"].create_index([("page_id", ASCENDING), ("created_at", DESCENDING)])
    await db["social_messages"].create_index([("user_id", ASCENDING), ("created_at", DESCENDING)])
    # api_keys — programmatic access
    await db["api_keys"].create_index("key_hash", unique=True)
    await db["api_keys"].create_index([("user_id", ASCENDING), ("created_at", DESCENDING)])
    await db["api_keys"].create_index(
        "expires_at",
        expireAfterSeconds=0,
        sparse=True,   # only index docs that have an expires_at field
    )
    # custom_metrics — formula builder (Sprint 3)
    await db["custom_metrics"].create_index([("user_id", ASCENDING), ("created_at", DESCENDING)])
    await db["custom_metrics"].create_index(
        [("user_id", ASCENDING), ("name", ASCENDING)], unique=True
    )
    # email_logs — outbound email audit trail (Super Admin monitor)
    await db["email_logs"].create_index([("created_at", DESCENDING)])
    await db["email_logs"].create_index([("status", ASCENDING), ("created_at", DESCENDING)])
    await db["email_logs"].create_index([("category", ASCENDING), ("created_at", DESCENDING)])
    # fund_requests — asks to finance for money out of Marketing's allocation
    await db["fund_requests"].create_index([("requested_by.id", ASCENDING), ("created_at", DESCENDING)])
    await db["fund_requests"].create_index([("status", ASCENDING), ("next_attempt_at", ASCENDING)])
    await db["fund_requests"].create_index([("created_at", DESCENDING)])
