import base64
import hmac as _hmac
import hashlib
import httpx
import logging
import secrets
import struct
import time
import urllib.parse

from bson import ObjectId
from fastapi import APIRouter, Depends
from jose import JWTError
from motor.motor_asyncio import AsyncIOMotorDatabase
from pydantic import BaseModel

logger = logging.getLogger(__name__)


# ── TOTP helpers (stdlib only — no pyotp dependency) ─────────────────────────

def _totp_secret() -> str:
    """Generate a random base32 TOTP secret (160-bit)."""
    return base64.b32encode(secrets.token_bytes(20)).decode()


def _totp_code(secret: str, ts: int | None = None) -> str:
    """Return the 6-digit TOTP code for a given 30-second counter."""
    if ts is None:
        ts = int(time.time()) // 30
    key = base64.b32decode(secret.upper() + "=" * (-len(secret) % 8))
    counter = struct.pack(">Q", ts)
    mac = _hmac.new(key, counter, hashlib.sha1).digest()
    offset = mac[-1] & 0x0F
    code = struct.unpack(">I", mac[offset: offset + 4])[0] & 0x7FFFFFFF
    return str(code % 1_000_000).zfill(6)


def _verify_totp(secret: str, code: str, window: int = 1) -> bool:
    """Verify a TOTP code with ±window interval tolerance."""
    ts = int(time.time()) // 30
    for offset in range(-window, window + 1):
        if _hmac.compare_digest(_totp_code(secret, ts + offset), str(code).strip()):
            return True
    return False


def _totp_uri(secret: str, email: str, issuer: str = "mediaERP") -> str:
    q = urllib.parse.quote
    return (
        f"otpauth://totp/{q(issuer)}:{q(email)}"
        f"?secret={secret}&issuer={q(issuer)}&algorithm=SHA1&digits=6&period=30"
    )


# ── 2FA schemas ───────────────────────────────────────────────────────────────

class TwoFaVerifyBody(BaseModel):
    code: str


class OnboardingCompleteBody(BaseModel):
    pass

from app.database import get_db
from app.middleware.auth import get_current_user
from app.config import settings
from app.schemas.auth import (
    ForgotPasswordRequest,
    LoginRequest,
    RefreshRequest,
    RegisterRequest,
    ResetPasswordRequest,
    UpdatePasswordRequest,
    UpdateProfileRequest,
)
from app.services.auth_service import (
    authenticate_user,
    create_password_reset_otp,
    register_user,
    reset_password_with_otp,
    update_password,
    update_profile,
)
from app.utils.email import send_otp_email
from app.utils.jwt import create_access_token, create_refresh_token, decode_refresh_token
from app.utils.response import error_response, success_response

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


async def _fetch_role(db: AsyncIOMotorDatabase, role_id: str) -> dict | None:
    """Fetch role document and serialize it."""
    if not role_id:
        return None
    try:
        role_doc = await db["roles"].find_one({"_id": ObjectId(role_id)})
    except Exception:
        return None
    if not role_doc:
        return None
    from app.services.role_service import _serialize_role
    return _serialize_role(role_doc)


async def _token_payload(user: dict, db: AsyncIOMotorDatabase) -> dict:
    user_id = str(user["_id"])
    role_id = user.get("role_id", "")
    role_data = await _fetch_role(db, role_id)
    return {
        "access_token": create_access_token(user_id, role_id),
        "refresh_token": create_refresh_token(user_id),
        "token_type": "bearer",
        "user": {
            "id": user_id,
            "email": user["email"],
            "name": user["name"],
            "role": role_data,
            "role_id": role_id,
            "designation": user.get("designation", ""),
            "status": user.get("status", "active"),
            "plan": user.get("plan", "free"),
        },
    }


@router.post("/register", status_code=201)
async def register(body: RegisterRequest, db: AsyncIOMotorDatabase = Depends(get_db)):
    try:
        user = await register_user(body.email, body.password, body.name, db)
    except ValueError as exc:
        return error_response(str(exc), status_code=409)
    return success_response(await _token_payload(user, db), "Registration successful", status_code=201)


@router.post("/login")
async def login(body: LoginRequest, db: AsyncIOMotorDatabase = Depends(get_db)):
    try:
        user = await authenticate_user(body.email, body.password, db)
    except ValueError:
        return error_response("Invalid email or password", status_code=401)
    return success_response(await _token_payload(user, db), "Login successful")


@router.post("/refresh")
async def refresh(body: RefreshRequest, db: AsyncIOMotorDatabase = Depends(get_db)):
    try:
        payload = decode_refresh_token(body.refresh_token)
    except JWTError:
        return error_response("Invalid or expired refresh token", status_code=401)
    user_id = payload.get("sub")
    try:
        oid = ObjectId(user_id)
    except Exception:
        return error_response("Invalid token subject", status_code=401)
    user = await db["users"].find_one({"_id": oid})
    if not user or not user.get("is_active", True):
        return error_response("User not found or inactive", status_code=401)
    return success_response(await _token_payload(user, db), "Token refreshed")


@router.get("/me")
async def me(current_user: dict = Depends(get_current_user), db: AsyncIOMotorDatabase = Depends(get_db)):
    role_id = current_user.get("role_id", "")
    role_data = await _fetch_role(db, role_id)
    return success_response(
        {
            "id": str(current_user["_id"]),
            "email": current_user["email"],
            "name": current_user["name"],
            "role": role_data,
            "role_id": role_id,
            "designation": current_user.get("designation", ""),
            "status": current_user.get("status", "active"),
            "plan": current_user.get("plan", "free"),
        },
        "User profile retrieved",
    )


@router.post("/logout")
async def logout(current_user: dict = Depends(get_current_user)):
    return success_response(None, "Logged out successfully")


@router.put("/me")
async def update_me(
    body: UpdateProfileRequest,
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    if body.name is None and body.email is None:
        return error_response("Provide at least one field to update (name or email)", status_code=422)
    try:
        updated = await update_profile(str(current_user["_id"]), body.name, body.email, db)
    except ValueError as exc:
        return error_response(str(exc), status_code=409)
    role_id = updated.get("role_id", "")
    role_data = await _fetch_role(db, role_id)
    return success_response(
        {
            "id": str(updated["_id"]),
            "email": updated["email"],
            "name": updated["name"],
            "role": role_data,
            "role_id": role_id,
            "designation": updated.get("designation", ""),
            "status": updated.get("status", "active"),
            "plan": updated.get("plan", "free"),
        },
        "Profile updated successfully",
    )


@router.post("/forgot-password")
async def forgot_password(
    body: ForgotPasswordRequest,
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """
    Send a 6-digit OTP to the user's email address.
    Always returns 200 — never reveals whether the email is registered.
    """
    otp = await create_password_reset_otp(body.email, db)
    if otp:
        try:
            await send_otp_email(body.email, otp)
            logger.info("OTP email dispatched to %s", body.email)
        except Exception as exc:
            logger.error("Failed to send OTP email to %s: %s", body.email, exc)
            # Return a generic error so the user knows something went wrong
            return error_response(
                "Could not send the OTP email. Please try again later.",
                status_code=503,
            )

    return success_response(
        {"message": "If that email is registered, a reset code has been sent."},
        "OTP sent",
    )


@router.post("/reset-password")
async def reset_password(
    body: ResetPasswordRequest,
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """Validate the OTP and set a new password."""
    try:
        await reset_password_with_otp(body.email, body.otp, body.new_password, db)
    except ValueError as exc:
        return error_response(str(exc), status_code=400)
    return success_response(None, "Password reset successfully. You can now log in.")


@router.put("/password")
async def change_password(
    body: UpdatePasswordRequest,
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    try:
        await update_password(str(current_user["_id"]), body.current_password, body.new_password, db)
    except ValueError as exc:
        status = 400 if "incorrect" in str(exc) or "differ" in str(exc) else 404
        return error_response(str(exc), status_code=status)
    return success_response(
        None,
        "Password changed successfully. Please log in again with your new password.",
    )


# ── 2FA endpoints ─────────────────────────────────────────────────────────────

@router.post("/2fa/setup")
async def setup_2fa(
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """Generate a TOTP secret and return QR code URI. Does NOT enable 2FA yet."""
    user_id = str(current_user["_id"])
    # Reuse existing secret if already set up (but not yet enabled), so QR stays stable
    secret = current_user.get("totp_secret") or _totp_secret()
    await db["users"].update_one({"_id": current_user["_id"]}, {"$set": {"totp_secret": secret}})
    uri = _totp_uri(secret, current_user["email"])
    return success_response({"secret": secret, "uri": uri}, "2FA setup initiated")


@router.post("/2fa/enable")
async def enable_2fa(
    body: TwoFaVerifyBody,
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """Verify the TOTP code and enable 2FA on the account."""
    secret = current_user.get("totp_secret")
    if not secret:
        return error_response("Run /2fa/setup first", status_code=400)
    if not _verify_totp(secret, body.code):
        return error_response("Invalid or expired code", status_code=400)
    await db["users"].update_one(
        {"_id": current_user["_id"]},
        {"$set": {"two_fa_enabled": True}},
    )
    return success_response({"two_fa_enabled": True}, "Two-factor authentication enabled")


@router.post("/2fa/disable")
async def disable_2fa(
    body: TwoFaVerifyBody,
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """Verify the TOTP code and disable 2FA."""
    secret = current_user.get("totp_secret")
    if not secret or not current_user.get("two_fa_enabled"):
        return error_response("2FA is not enabled", status_code=400)
    if not _verify_totp(secret, body.code):
        return error_response("Invalid or expired code", status_code=400)
    await db["users"].update_one(
        {"_id": current_user["_id"]},
        {"$set": {"two_fa_enabled": False, "totp_secret": None}},
    )
    return success_response({"two_fa_enabled": False}, "Two-factor authentication disabled")


@router.get("/2fa/status")
async def get_2fa_status(current_user: dict = Depends(get_current_user)):
    """Return whether 2FA is enabled for the current user."""
    return success_response(
        {"two_fa_enabled": bool(current_user.get("two_fa_enabled", False))},
        "2FA status retrieved",
    )


# ── Onboarding endpoint ───────────────────────────────────────────────────────

@router.post("/onboarding/complete")
async def complete_onboarding(
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """Mark onboarding as complete for the current user."""
    await db["users"].update_one(
        {"_id": current_user["_id"]},
        {"$set": {"onboarding_complete": True}},
    )
    return success_response({"onboarding_complete": True}, "Onboarding complete")


@router.get("/onboarding/status")
async def onboarding_status(current_user: dict = Depends(get_current_user)):
    """Return onboarding completion status."""
    return success_response(
        {"onboarding_complete": bool(current_user.get("onboarding_complete", False))},
        "Onboarding status retrieved",
    )


# ── Impersonation ─────────────────────────────────────────────────────────────

@router.post("/impersonate/{user_id}")
async def impersonate_user(
    user_id: str,
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    role = current_user.get("_role") or {}
    if not (role.get("is_system_role") and role.get("role_name") == "Super Admin"):
        return error_response("Only Super Admin can impersonate users", status_code=403)

    try:
        oid = ObjectId(user_id)
    except Exception:
        return error_response("Invalid user ID", status_code=400)

    if str(current_user["_id"]) == user_id:
        return error_response("Cannot impersonate yourself", status_code=400)

    target = await db["users"].find_one({"_id": oid})
    if not target:
        return error_response("User not found", status_code=404)

    # Block impersonating another Super Admin
    try:
        t_role = await db["roles"].find_one({"_id": ObjectId(target.get("role_id", ""))})
        if t_role and t_role.get("is_system_role") and t_role.get("role_name") == "Super Admin":
            return error_response("Cannot impersonate another Super Admin", status_code=403)
    except Exception:
        pass

    payload = await _token_payload(target, db)
    return success_response(payload, f"Impersonating {target.get('name', target.get('email', ''))}")


# ── Root ERP SSO Login ────────────────────────────────────────────────────────

class SsoLoginRequest(BaseModel):
    ssoToken: str

@router.post("/sso-login")
async def sso_login(body: SsoLoginRequest, db: AsyncIOMotorDatabase = Depends(get_db)):
    """
    Exchange a Root ERP SSO token for a local Media ERP access token.

    The portal is where this estate signs people in: once, there, and then into
    each system from it. What arrives is a single-use token this server cannot
    validate alone, so it asks the portal whether the token is good and who it
    belongs to.
    """
    # Unset means unavailable, never a default host. Falling back to localhost
    # in production means asking whatever happens to be listening there to
    # vouch for the token, which is the whole of the check.
    root_erp_url = (settings.root_erp_api_url or "").rstrip("/")
    if not root_erp_url:
        return error_response(
            "Signing in from the portal is not configured on this server", 503
        )

    try:
        async with httpx.AsyncClient(timeout=8) as http:
            resp = await http.get(
                f"{root_erp_url}/api/auth/verify-sso-token",
                params={"token": body.ssoToken},
            )
        if resp.status_code != 200:
            return error_response("Invalid or expired SSO token", 401)
        admin = resp.json().get("data", {})
        if not admin.get("email"):
            return error_response("Invalid SSO payload", 401)
    except httpx.RequestError:
        return error_response("Could not reach Root ERP", 503)

    email = str(admin["email"]).strip().lower()
    user = await db["users"].find_one({"email": email})

    # No account is created here, deliberately.
    #
    # This used to make one for any address the portal named, active and
    # awaiting a role. That turns a spoofed or compromised portal into an
    # instant account: the token is the only thing vouching for the address,
    # and it is checked by asking the very system that would be spoofed.
    # Somebody has to be given an account here on purpose first.
    if not user:
        return error_response(
            f"There is no account here for {email}. It has to be created "
            "before signing in from the portal.",
            403,
        )

    # The same gate a password sign-in applies: disabling somebody has to close
    # every door, not merely the one with a password on it.
    if not user.get("is_active", True):
        return error_response("Invalid or expired SSO token", 401)

    logger.info("User %s signed in via the Root portal", email)
    payload = await _token_payload(user, db)
    return success_response(payload, "SSO sign-in successful")
