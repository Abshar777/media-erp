"""
4-case test suite for feature 1.7 — auth utils (jwt.py + encryption.py).
No DB or HTTP layer needed.
"""
import time
import pytest
from unittest.mock import patch
from jose import JWTError

from app.utils.jwt import create_access_token, create_refresh_token, decode_access_token
from app.utils.encryption import encrypt, decrypt

USER_ID = "64a1b2c3d4e5f6a7b8c9d0e1"


# ── Case 1 — Happy Path ───────────────────────────────────────────────────────

def test_access_token_round_trip():
    token = create_access_token(USER_ID)
    payload = decode_access_token(token)
    assert payload["sub"] == USER_ID
    assert payload["type"] == "access"


def test_encryption_round_trip():
    secret = "ya29.super_sensitive_oauth_token"
    assert decrypt(encrypt(secret)) == secret


def test_encryption_nonce_is_random():
    """Same plaintext must produce different ciphertext every time (random nonce)."""
    ct1 = encrypt("same_value")
    ct2 = encrypt("same_value")
    assert ct1 != ct2


# ── Case 2 — Edge / Boundary ──────────────────────────────────────────────────

def test_refresh_token_rejected_as_access_token():
    """A refresh token passed to decode_access_token must raise JWTError."""
    refresh = create_refresh_token(USER_ID)
    with pytest.raises(JWTError):
        decode_access_token(refresh)


# ── Case 3 — Error / Invalid Input ───────────────────────────────────────────

def test_expired_access_token_raises():
    with patch("app.utils.jwt.settings") as mock_cfg:
        mock_cfg.jwt_secret_key = "test-secret"
        mock_cfg.jwt_algorithm = "HS256"
        mock_cfg.access_token_expire_minutes = -1  # already expired
        token = create_access_token.__wrapped__(USER_ID) if hasattr(create_access_token, "__wrapped__") else _make_expired_token()
    with pytest.raises(JWTError):
        decode_access_token(token)


def _make_expired_token() -> str:
    from datetime import datetime, timedelta, timezone
    from jose import jwt
    from app.config import settings
    expire = datetime.now(timezone.utc) - timedelta(seconds=1)
    return jwt.encode(
        {"sub": USER_ID, "exp": expire, "type": "access"},
        settings.jwt_secret_key,
        algorithm=settings.jwt_algorithm,
    )


def test_expired_access_token_raises_real():
    token = _make_expired_token()
    with pytest.raises(JWTError):
        decode_access_token(token)


def test_tampered_ciphertext_raises():
    ct = encrypt("value")
    corrupted = ct[:-4] + "XXXX"
    with pytest.raises(Exception):
        decrypt(corrupted)


# ── Case 4 — Permission / Auth ────────────────────────────────────────────────

def test_tampered_jwt_signature_raises():
    """Changing one char in the token signature must raise JWTError."""
    token = create_access_token(USER_ID)
    parts = token.split(".")
    # Flip a character in the MIDDLE of the signature. The last base64url
    # character of a 32-byte HMAC carries 2 padding bits that decoders ignore,
    # so changing it sometimes leaves the signature valid (a random failure).
    mid = len(parts[2]) // 2
    parts[2] = parts[2][:mid] + ("A" if parts[2][mid] != "A" else "B") + parts[2][mid + 1:]
    bad_token = ".".join(parts)
    with pytest.raises(JWTError):
        decode_access_token(bad_token)


def test_wrong_secret_raises():
    """Token signed with a different secret must be rejected."""
    from jose import jwt
    from app.config import settings
    from datetime import datetime, timedelta, timezone
    expire = datetime.now(timezone.utc) + timedelta(minutes=15)
    token = jwt.encode(
        {"sub": USER_ID, "exp": expire, "type": "access"},
        "wrong-secret-key",
        algorithm=settings.jwt_algorithm,
    )
    with pytest.raises(JWTError):
        decode_access_token(token)
