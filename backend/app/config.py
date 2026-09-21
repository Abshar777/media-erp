from functools import lru_cache
from pathlib import Path
from pydantic import AliasChoices, Field, model_validator
from pydantic_settings import BaseSettings

# Resolve .env relative to this file so it works regardless of where uvicorn is launched from >> >>>>
_ENV_FILE = Path(__file__).parent.parent / ".env"


class Settings(BaseSettings):
    app_env: str = "development"
    app_host: str = "0.0.0.0"
    app_port: int = 8000
    debug: bool = True

    mongodb_url: str = "mongodb://localhost:27017"
    mongodb_db_name: str = "mediaerp"

    redis_url: str = "redis://localhost:6379/0"

    # Where the Root portal lives.
    #
    # Somebody arriving from it carries a single-use token this server cannot
    # validate alone, so it asks the portal to vouch for it. Blank means
    # signing in from the portal is unavailable — never a fall back to a
    # default host, which would mean trusting whatever answers there.
    root_erp_api_url: str = ""

    # The shared secret the Root portal presents when it asks this server
    # about its roles or its people. Distinct from root_erp_api_url above,
    # which is how this server calls the portal to verify a sign-in — this is
    # how the portal calls here. Blank means those endpoints are off rather
    # than open. Must match the portal's MEDIA_ERP_SSO_SECRET.
    root_erp_secret: str = ""

    jwt_secret_key: str = "change-me-in-production"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 15
    refresh_token_expire_days: int = 7

    encryption_key: str = "0" * 64  # 32-byte hex placeholder

    # AI — Gemini is used when GEMINI_API_KEY is set (recommended for production).
    # Ollama is the fallback for local/offline setups.
    gemini_api_key: str = ""
    gemini_model:   str = "gemini-1.5-flash"   # fast + cheap; override with gemini-1.5-pro

    # Ollama (local AI — no API key needed, requires `ollama serve` on the server)
    ollama_base_url: str = "http://localhost:11434"
    ollama_model:    str = "llama3.2:3b"

    # Email (SMTP)
    mail_username: str = ""
    mail_password: str = ""
    mail_from: str = ""
    mail_port: int = 587
    mail_server: str = "smtp.gmail.com"
    mail_from_name: str = "mediaERP"

    # Sentry (optional — leave empty to disable)
    sentry_dsn: str = ""

    # Worker concurrency (Railway / Docker env override)
    web_concurrency: int = 2
    celery_concurrency: int = 2

    allowed_origins: str = "http://localhost:3000,http://localhost:3001"
    frontend_url: str = "http://localhost:3000"

    # ── Base URL ──────────────────────────────────────────────────────────────
    # Single source of truth for all redirect URIs and public file URLs.
    # Set PUBLIC_BASE_URL in .env to your domain (e.g. https://api.example.com).
    # All redirect URIs below are auto-derived from this value if left empty.
    public_base_url: str = "http://localhost:8000"

    # ── Google OAuth2 (Google Ads + GA4) ──────────────────────────────────────
    google_client_id: str = ""
    google_client_secret: str = ""
    google_ads_developer_token: str = ""
    google_ads_redirect_uri: str = ""   # auto-derived if empty
    ga4_redirect_uri: str = ""          # auto-derived if empty

    # ── Facebook / Meta ───────────────────────────────────────────────────────
    facebook_webhook_verify_token: str = "mediaerp_webhook_verify"
    facebook_app_id: str = ""
    facebook_app_secret: str = ""
    facebook_redirect_uri: str = ""         # auto-derived if empty
    facebook_pages_redirect_uri: str = ""   # auto-derived if empty

    # ── Instagram ─────────────────────────────────────────────────────────────
    instagram_redirect_uri: str = ""        # auto-derived if empty
    instagram_app_id: str = ""
    instagram_app_secret: str = ""
    instagram_login_redirect_uri: str = ""  # auto-derived if empty

    # ── LinkedIn Ads ──────────────────────────────────────────────────────────
    linkedin_client_id: str = ""
    linkedin_client_secret: str = ""
    linkedin_redirect_uri: str = ""         # auto-derived if empty

    # ── TikTok Ads ────────────────────────────────────────────────────────────
    tiktok_app_id: str = ""
    tiktok_app_secret: str = ""
    tiktok_redirect_uri: str = ""           # auto-derived if empty

    # ── Cloudflare R2 (S3-compatible object storage) ──────────────────────────
    # Leave empty to fall back to local disk storage (uploads/ + PUBLIC_BASE_URL).
    r2_account_id:        str = ""
    r2_access_key_id:     str = ""
    r2_secret_access_key: str = ""
    # Accept either R2_BUCKET or R2_BUCKET_NAME from the environment
    r2_bucket:            str = Field(
        default="",
        validation_alias=AliasChoices("r2_bucket", "r2_bucket_name"),
    )
    # LEGACY — public base URL for the bucket (R2 public dev URL or custom domain).
    # The bucket is now PRIVATE, so URLs built from this value return 401. It is
    # kept only so `key_from_url()` can recover a storage key from rows written
    # while the bucket was public. Reads go through signed GETs — see
    # app/utils/storage.py:presign_get.
    r2_public_url:        str = ""

    # TTL (seconds) for read-time signed GET URLs. Long enough to view/download
    # an attachment, short enough that a leaked URL expires quickly. Clamped
    # 60 s … 24 h by the validator below.
    r2_get_url_ttl:       int = 3600

    # Root folder for everything mediaERP writes. The bucket is SHARED with the
    # Delta LMS (which owns images/ documents/ hls/ videos/ kyc/ …), so all of
    # our objects live under one namespace: mediaERP/<folder>/<file>. That keeps
    # the two projects from colliding and — more importantly — means the LMS can
    # exclude every mediaERP object from its unauthenticated /assets/* proxy by
    # blocking a single prefix. Set to "" to write at the bucket root (legacy).
    r2_root_prefix:       str = "mediaERP"

    # ── WhatsApp Cloud API ────────────────────────────────────────────────────
    whatsapp_phone_number_id: str = ""
    whatsapp_token: str = ""
    whatsapp_business_account_id: str = ""
    whatsapp_api_version: str = "v21.0"

    # ── Web Push (VAPID) ──────────────────────────────────────────────────────
    # Generate a pair once and keep it stable: rotating the public key
    # invalidates every stored browser subscription. Leave empty to disable
    # web push entirely — the socket and the bell keep working regardless.
    vapid_public_key:  str = ""
    vapid_private_key: str = ""
    # "mailto:" contact the push service can reach you on, per RFC 8292.
    vapid_subject:     str = "mailto:admin@deltainstitutions.com"

    # ── Stripe ────────────────────────────────────────────────────────────────
    stripe_secret_key: str = ""
    stripe_webhook_secret: str = ""
    stripe_price_free_monthly: str = ""
    stripe_price_free_yearly: str = ""
    stripe_price_pro_monthly: str = ""
    stripe_price_pro_yearly: str = ""
    stripe_price_enterprise_monthly: str = ""
    stripe_price_enterprise_yearly: str = ""

    model_config = {"env_file": str(_ENV_FILE), "case_sensitive": False, "extra": "ignore"}

    @property
    def web_push_enabled(self) -> bool:
        """True only when both halves of the VAPID pair are configured."""
        return bool(self.vapid_public_key and self.vapid_private_key)

    @property
    def r2_enabled(self) -> bool:
        """True only when all required R2 credentials are present."""
        return bool(
            self.r2_account_id
            and self.r2_access_key_id
            and self.r2_secret_access_key
            and self.r2_bucket
        )

    @property
    def r2_endpoint(self) -> str:
        return f"https://{self.r2_account_id}.r2.cloudflarestorage.com"

    @model_validator(mode="after")
    def _build_redirect_uris(self) -> "Settings":
        """
        Auto-derive any empty redirect URI from public_base_url.
        Override a specific URI in .env to bypass auto-derivation, e.g.:
            GOOGLE_ADS_REDIRECT_URI=https://custom.domain/callback
        """
        base = self.public_base_url.rstrip("/")
        cb = f"{base}/api/v1/connectors"

        if not self.google_ads_redirect_uri:
            self.google_ads_redirect_uri = f"{cb}/google_ads/callback"
        if not self.ga4_redirect_uri:
            self.ga4_redirect_uri = f"{cb}/ga4/callback"
        if not self.facebook_redirect_uri:
            self.facebook_redirect_uri = f"{cb}/facebook_ads/callback"
        if not self.facebook_pages_redirect_uri:
            self.facebook_pages_redirect_uri = f"{cb}/facebook_pages/callback"
        if not self.instagram_redirect_uri:
            self.instagram_redirect_uri = f"{cb}/instagram/callback"
        if not self.instagram_login_redirect_uri:
            self.instagram_login_redirect_uri = f"{cb}/instagram_login/callback"
        if not self.linkedin_redirect_uri:
            self.linkedin_redirect_uri = f"{cb}/linkedin_ads/callback"
        if not self.tiktok_redirect_uri:
            self.tiktok_redirect_uri = f"{cb}/tiktok_ads/callback"

        # Clamp the signed-URL TTL — a 0/negative value would mint URLs that are
        # already expired, and an unbounded one defeats the point of signing.
        self.r2_get_url_ttl = max(60, min(self.r2_get_url_ttl, 86_400))

        # Normalise the root prefix to a bare segment: no leading/trailing
        # slashes (they would produce "//" or an empty path segment in keys)
        # and no traversal.
        root = (self.r2_root_prefix or "").strip().strip("/")
        self.r2_root_prefix = "" if ".." in root else root

        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()


# Always read fresh from .env — clear cache so --reload picks up changes
get_settings.cache_clear()
settings = get_settings()
