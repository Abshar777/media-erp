"""
Web Push subscription management.

  GET    /api/v1/push/public-key   — VAPID public key for pushManager.subscribe
  POST   /api/v1/push/subscribe    — store this browser's subscription
  DELETE /api/v1/push/subscribe    — drop it again
"""
from fastapi import APIRouter, Depends
from motor.motor_asyncio import AsyncIOMotorDatabase
from pydantic import BaseModel

from app.config import settings
from app.database import get_db
from app.middleware.auth import get_current_user
from app.services import web_push_service as wp
from app.utils.response import error_response, success_response

router = APIRouter(prefix="/api/v1/push", tags=["push"])


class SubscriptionKeys(BaseModel):
    p256dh: str
    auth: str


class PushSubscription(BaseModel):
    endpoint: str
    keys: SubscriptionKeys


class Unsubscribe(BaseModel):
    endpoint: str


@router.get("/public-key")
async def public_key(current_user: dict = Depends(get_current_user)):
    """
    The public half of the VAPID pair. Safe to hand to the browser — it is
    designed to be public, and subscribing requires it.
    """
    return success_response(
        data={
            "public_key": settings.vapid_public_key,
            "enabled": settings.web_push_enabled,
        },
        message="Push key retrieved",
    )


@router.post("/subscribe", status_code=201)
async def subscribe(
    body: PushSubscription,
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    if not settings.web_push_enabled:
        return error_response("Web push is not configured on this server.", status_code=503)
    try:
        await wp.save_subscription(db, str(current_user["_id"]), body.model_dump())
    except ValueError as exc:
        return error_response(str(exc), status_code=422)
    return success_response(data={"endpoint": body.endpoint}, message="Subscribed", status_code=201)


@router.delete("/subscribe")
async def unsubscribe(
    body: Unsubscribe,
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    removed = await wp.delete_subscription(db, body.endpoint)
    return success_response(data={"removed": removed}, message="Unsubscribed")
