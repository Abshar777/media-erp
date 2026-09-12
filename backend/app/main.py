from contextlib import asynccontextmanager
import logging
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.database import connect_db, close_db, create_indexes

logger = logging.getLogger(__name__)

# ── Sentry (no-op when SENTRY_DSN is empty) ───────────────────────────────────
if settings.sentry_dsn:
    import sentry_sdk
    from sentry_sdk.integrations.fastapi import FastApiIntegration
    from sentry_sdk.integrations.starlette import StarletteIntegration

    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        environment=settings.app_env,
        traces_sample_rate=0.2,
        integrations=[StarletteIntegration(), FastApiIntegration()],
        send_default_pii=False,
    )
    logger.info("Sentry initialised (env=%s)", settings.app_env)
from app.routers import auth as auth_router
from app.routers import connectors as connectors_router
from app.routers import sync as sync_router
from app.routers import reports as reports_router
from app.routers import ai as ai_router
from app.routers import notifications as notifications_router
from app.routers import push as push_router
from app.routers import verify as verify_router
from app.routers import projects as projects_router
from app.routers import roles as roles_router
from app.routers import users as users_router
from app.routers import chat as chat_router
from app.routers import social as social_router
from app.routers import webhook as webhook_router
from app.routers import media as media_router
from app.routers import campaigns_write as campaigns_write_router
from app.routers import budget as budget_router
from app.routers import schedule as schedule_router
from app.routers import rules as rules_router
from app.routers import email_reports as email_reports_router
from app.routers import export as export_router
from app.routers import billing as billing_router
from app.routers import clients as clients_router
from app.routers import whitelabel as whitelabel_router
from app.routers import audit_logs as audit_logs_router
from app.routers import kpi_targets as kpi_targets_router
from app.routers import api_keys as api_keys_router
from app.routers import analytics as analytics_router
from app.routers import custom_metrics as custom_metrics_router
from app.routers import fx as fx_router
from app.routers import teams as teams_router
from app.routers import board_statuses as board_statuses_router
from app.routers import pipelines as pipelines_router
from app.routers import email_settings as email_settings_router
from app.routers import notification_prefs as notification_prefs_router
from app.routers import media_schedule as media_schedule_router
from app.routers import whatsapp as whatsapp_router
from app.routers import email_logs as email_logs_router
from app.middleware.rate_limit import RateLimitMiddleware
from app.utils.response import success_response


@asynccontextmanager
async def lifespan(app: FastAPI):
    await connect_db()
    await create_indexes()
    # Post scheduling daemon thread
    import threading
    from app.services.schedule_service import start_scheduler
    threading.Thread(target=start_scheduler, daemon=True, name="post-scheduler").start()
    logger.info("Post scheduler started")

    # Rules evaluation daemon thread (every 5 min)
    from app.services.rules_service import start_rules_evaluator
    threading.Thread(target=start_rules_evaluator, daemon=True, name="rules-evaluator").start()
    logger.info("Rules evaluator started")

    # Email report scheduler daemon thread (every 1 min)
    from app.services.email_report_service import start_email_scheduler
    threading.Thread(target=start_email_scheduler, daemon=True, name="email-scheduler").start()
    logger.info("Email scheduler started")

    # Media schedule activation daemon thread (every 60 s)
    from app.services.media_schedule_service import start_media_scheduler
    threading.Thread(target=start_media_scheduler, daemon=True, name="media-scheduler").start()
    logger.info("Media schedule scheduler started")

    # Team group daily-report daemon thread (posts at 21:00 IST)
    from app.services.group_chat_service import start_group_report_scheduler
    threading.Thread(target=start_group_report_scheduler, daemon=True, name="group-report-scheduler").start()
    logger.info("Group daily-report scheduler started")
    yield
    await close_db()


app = FastAPI(
    title="mediaERP API",
    version="1.0.0",
    docs_url="/docs" if settings.debug else None,
    redoc_url="/redoc" if settings.debug else None,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.allowed_origins.split(",")],
    # In dev, accept any localhost / 127.0.0.1 port so the frontend works no
    # matter which port Next picks (3000/3001/…) or whether it's served from
    # localhost vs 127.0.0.1. Production origins still come from ALLOWED_ORIGINS.
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(RateLimitMiddleware)


app.include_router(auth_router.router)
app.include_router(connectors_router.router)
app.include_router(sync_router.router)
app.include_router(reports_router.router)
app.include_router(ai_router.router)
app.include_router(notifications_router.router)
app.include_router(push_router.router)
app.include_router(verify_router.router)
app.include_router(projects_router.router)
app.include_router(roles_router.router)
app.include_router(users_router.router)
app.include_router(chat_router.router)
app.include_router(social_router.router)
app.include_router(webhook_router.router)
app.include_router(media_router.router)
app.include_router(campaigns_write_router.router)
app.include_router(budget_router.router)
app.include_router(schedule_router.router)
app.include_router(rules_router.router)
app.include_router(email_reports_router.router)
app.include_router(export_router.router)
app.include_router(billing_router.router)
app.include_router(clients_router.router)
app.include_router(whitelabel_router.router)
app.include_router(audit_logs_router.router)
app.include_router(kpi_targets_router.router)
app.include_router(api_keys_router.router)
app.include_router(analytics_router.router)
app.include_router(custom_metrics_router.router)
app.include_router(fx_router.router)
app.include_router(teams_router.router)
app.include_router(board_statuses_router.router)
app.include_router(pipelines_router.router)
app.include_router(email_settings_router.router)
app.include_router(notification_prefs_router.router)
app.include_router(media_schedule_router.router)
app.include_router(whatsapp_router.router)
app.include_router(email_logs_router.router)

# Serve uploaded files at /uploads/<filename>
# These are publicly reachable via ngrok so Instagram can fetch images.
_UPLOADS_DIR = Path(__file__).parent.parent / "uploads"
_UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=str(_UPLOADS_DIR)), name="uploads")


@app.get("/api/v1/health", tags=["health"])
async def health():
    return success_response(
        data={"env": settings.app_env, "version": "1.0.0"},
        message="API is healthy",
    )
