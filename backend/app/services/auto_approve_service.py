"""
Auto-approve — a team leader's own switch to have work their team submits for
review approved automatically, immediately or after a delay they choose.

Settings live on the leader's user document (`auto_approve`):
    {"enabled": bool, "delay_minutes": int, "enabled_since": datetime}
Off by default; each leader's switch affects only their own approvals.

When a task enters review, every leader of its team who has the switch on gets
an entry in the task's `auto_approvals` list:
    {"leader_id", "leader_name", "delay_minutes", "at"}   (at = submitted + delay)
Each leader's timer is independent; whichever comes due first approves the task
in that leader's name, and the rest end with it. The approval itself goes through
the normal edit endpoint *as that leader*, so every rule and side effect of a
manual approval applies unchanged (permissions, verifier sign-off, history,
notifications, chat, WhatsApp). History marks it `auto: True`.

Rules (agreed 2026-10-13):
  • only submissions made AFTER the leader switched it on are covered;
  • tasks with a named approver are covered too (leaders keep approval rights);
  • verifiers still come first — an entry waits until every verifier passed;
  • a leader may Hold a task (no auto-approval for it) or approve / send back by hand;
  • a leader's switch never covers their OWN submissions (another leader's may),
    and a deactivated leader's switch does nothing;
  • re-checked when it fires: the leader must still lead the team and still have
    the switch on (since before the submission), and the task must still be in
    review — otherwise the entry is dropped.
A background task in the web server's own event loop (run_forever, started from
main.py's lifespan) runs due entries every POLL_SECONDS — NOT a thread with its own
loop: approving goes through the request handler, which notifies people over the
live socket, and those sockets belong to the server's loop (from another loop the
send hangs). A 0-minute delay is approved right away on submission. A claim field
makes each run exclusive across workers.
"""
import asyncio
import logging
from datetime import datetime, timedelta, timezone

from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorDatabase

logger = logging.getLogger(__name__)

POLL_SECONDS = 30
MAX_DELAY_MINUTES = 24 * 60          # a day — longer than that is just "approve by hand"
CLAIM_TTL = timedelta(minutes=2)     # a crashed run releases its claim after this
DEFAULT = {"enabled": False, "delay_minutes": 0, "enabled_since": None}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(dt):
    if isinstance(dt, str):
        try:
            dt = datetime.fromisoformat(dt.replace("Z", "+00:00"))
        except ValueError:
            return None
    if not isinstance(dt, datetime):
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _is_active(user: dict) -> bool:
    """Deactivated either way the app records it (is_active false, or a non-active status)."""
    return user.get("is_active", True) is not False and user.get("status", "active") == "active"


def _oid(v) -> ObjectId | None:
    try:
        return ObjectId(str(v))
    except Exception:
        return None


# ── Settings ────────────────────────────────────────────────────────────────

async def led_teams(db: AsyncIOMotorDatabase, user_id: str) -> list[dict]:
    """Teams this user leads (by membership role)."""
    return await db["teams"].find(
        {"members": {"$elemMatch": {"user_id": user_id, "role": "leader"}}},
        {"name": 1, "color": 1},
    ).to_list(200)


def public_settings(raw: dict | None) -> dict:
    s = {**DEFAULT, **(raw or {})}
    since = _aware(s.get("enabled_since"))
    return {"enabled": bool(s["enabled"]), "delay_minutes": int(s["delay_minutes"] or 0),
            "enabled_since": since.isoformat() if since else None}


async def get_settings(db: AsyncIOMotorDatabase, user_id: str) -> dict:
    u = await db["users"].find_one({"_id": _oid(user_id)}, {"auto_approve": 1})
    return public_settings((u or {}).get("auto_approve"))


def validate(enabled, delay_minutes) -> str:
    if not isinstance(enabled, bool):
        return "enabled must be true or false."
    if isinstance(delay_minutes, bool) or not isinstance(delay_minutes, int):
        return "delay_minutes must be a whole number of minutes."
    if not 0 <= delay_minutes <= MAX_DELAY_MINUTES:
        return f"The delay must be between 0 minutes and {MAX_DELAY_MINUTES // 60} hours."
    return ""


async def save_settings(db: AsyncIOMotorDatabase, user_id: str, enabled: bool, delay_minutes: int) -> dict:
    current = await get_settings(db, user_id)
    since = current["enabled_since"]
    if enabled and not current["enabled"]:
        since = _now()                       # covers submissions from now on
    elif not enabled:
        since = None
    doc = {"enabled": enabled, "delay_minutes": delay_minutes,
           "enabled_since": _aware(since) if since else None}
    await db["users"].update_one({"_id": _oid(user_id)}, {"$set": {"auto_approve": doc}})
    if not enabled:
        # Turning off ends this leader's timers on work already waiting, so no card or
        # task keeps promising an approval that will not come (the approver would skip
        # them anyway). Other leaders' timers stay.
        await db["project_tasks"].update_many(
            {"status": "pending_review", "auto_approvals.leader_id": str(user_id)},
            {"$pull": {"auto_approvals": {"leader_id": str(user_id)}}})
        await db["project_tasks"].update_many(
            {"auto_approvals": {"$size": 0}},
            {"$unset": {"auto_approvals": "", "auto_approve_submitted_at": ""}})
    return public_settings(doc)


# ── Scheduling on the task ──────────────────────────────────────────────────

_TASK_FIELDS = ("auto_approvals", "auto_approve_submitted_at", "auto_approve_claim")


async def clear(db: AsyncIOMotorDatabase, task_id: str, keep_hold: bool = False) -> None:
    unset = {f: "" for f in _TASK_FIELDS}
    if not keep_hold:
        unset["auto_approve_hold"] = ""
    await db["project_tasks"].update_one({"_id": _oid(task_id)}, {"$unset": unset})


async def schedule_on_submit(db: AsyncIOMotorDatabase, task_id: str, submitted_at: datetime | None = None) -> list[dict]:
    """A task just entered review: one entry per leader of its team with the switch on."""
    submitted_at = submitted_at or _now()
    task = await db["project_tasks"].find_one({"_id": _oid(task_id)}, {"team_id": 1, "assigned_to": 1})
    team = await db["teams"].find_one({"_id": _oid((task or {}).get("team_id"))}, {"members": 1}) if task else None
    await clear(db, task_id)                  # a resubmission starts afresh (and lifts a Hold)
    if not team:
        return []
    leader_ids = [m.get("user_id") for m in team.get("members") or [] if m.get("role") == "leader"]
    oids = [o for o in (_oid(x) for x in leader_ids) if o]
    leaders = await db["users"].find(
        {"_id": {"$in": oids}, "auto_approve.enabled": True},
        {"name": 1, "email": 1, "auto_approve": 1, "is_active": 1, "status": 1},
    ).to_list(50)
    entries = []
    for u in leaders:
        # A leader's switch stands in for reviewing the team's work — never their own
        # (another leader's switch, or a person, signs that off). Deactivated: none.
        if str(u["_id"]) == str(task.get("assigned_to") or "") or not _is_active(u):
            continue
        s = public_settings(u.get("auto_approve"))
        since = _aware(s["enabled_since"])
        if since and since > submitted_at:
            continue
        entries.append({
            "leader_id": str(u["_id"]),
            "leader_name": u.get("name") or u.get("email") or "Team leader",
            "delay_minutes": s["delay_minutes"],
            "at": submitted_at + timedelta(minutes=s["delay_minutes"]),
        })
    entries.sort(key=lambda e: e["at"])
    if entries:
        await db["project_tasks"].update_one({"_id": _oid(task_id)}, {"$set": {
            "auto_approvals": entries, "auto_approve_submitted_at": submitted_at}})
    return entries


async def set_hold(db: AsyncIOMotorDatabase, task_id: str, user: dict, hold: bool) -> None:
    if hold:
        await db["project_tasks"].update_one({"_id": _oid(task_id)}, {"$set": {"auto_approve_hold": {
            "by": str(user["_id"]), "by_name": user.get("name") or "", "at": _now()}}})
    else:
        await db["project_tasks"].update_one({"_id": _oid(task_id)}, {"$unset": {"auto_approve_hold": ""}})


def _pending_verifiers(task: dict) -> bool:
    from app.services.workflow import VERIFY_PASSED
    return any(v.get("status") != VERIFY_PASSED for v in task.get("verifications") or [])


async def _still_eligible(db: AsyncIOMotorDatabase, entry: dict, task: dict) -> dict | None:
    """The leader's user doc (with _role) if this entry may still approve, else None."""
    leader = await db["users"].find_one({"_id": _oid(entry.get("leader_id"))})
    if not leader or not _is_active(leader):
        return None
    s = public_settings(leader.get("auto_approve"))
    since, submitted = _aware(s["enabled_since"]), _aware(task.get("auto_approve_submitted_at"))
    if not s["enabled"] or not since or (submitted and since > submitted):
        return None
    team = await db["teams"].find_one({"_id": _oid(task.get("team_id"))}, {"members": 1})
    if not team or not any(m.get("user_id") == entry["leader_id"] and m.get("role") == "leader"
                           for m in team.get("members") or []):
        return None
    if str(task.get("assigned_to") or "") == entry["leader_id"]:
        return None                           # reassigned to this leader while waiting
    leader["_role"] = await db["roles"].find_one({"_id": _oid(leader.get("role_id"))}) if leader.get("role_id") else None
    return leader


async def try_auto_approve(db: AsyncIOMotorDatabase, task_id: str, now: datetime | None = None) -> bool:
    """Approve this task if one of its entries is due and still valid. Exclusive across workers."""
    now = now or _now()
    oid = _oid(task_id)
    task = await db["project_tasks"].find_one_and_update(
        {"_id": oid, "status": "pending_review",
         "auto_approvals": {"$elemMatch": {"at": {"$lte": now}}},
         "auto_approve_hold": {"$exists": False},
         "$or": [{"auto_approve_claim": {"$exists": False}}, {"auto_approve_claim": {"$lt": now - CLAIM_TTL}}]},
        {"$set": {"auto_approve_claim": now}},
    )
    if not task:
        return False
    try:
        if _pending_verifiers(task):
            return False                      # verifiers first; retried on a later tick / on sign-off
        due = sorted((e for e in task.get("auto_approvals") or [] if _aware(e.get("at")) and _aware(e["at"]) <= now),
                     key=lambda e: _aware(e["at"]))
        dropped = []
        from app.routers.projects import edit_task
        from app.schemas.project import UpdateTaskRequest
        for entry in due:
            leader = await _still_eligible(db, entry, task)
            if not leader:
                dropped.append(entry["leader_id"])
                continue
            leader["_auto_approval"] = True
            resp = await edit_task(str(oid), UpdateTaskRequest(status="approved"), current_user=leader, db=db)
            if getattr(resp, "status_code", 500) == 200:
                logger.info("Auto-approved task %s as %s", task_id, entry["leader_name"])
                return True
            logger.warning("Auto-approve of %s as %s refused: %s", task_id, entry["leader_name"],
                           getattr(resp, "body", b"")[:200])
            dropped.append(entry["leader_id"])
        if dropped:
            await db["project_tasks"].update_one(
                {"_id": oid}, {"$pull": {"auto_approvals": {"leader_id": {"$in": dropped}}}})
        return False
    finally:
        await db["project_tasks"].update_one({"_id": oid, "auto_approve_claim": now},
                                             {"$unset": {"auto_approve_claim": ""}})


async def run_due(db: AsyncIOMotorDatabase, now: datetime | None = None) -> int:
    now = now or _now()
    ids = await db["project_tasks"].find(
        {"status": "pending_review", "auto_approvals": {"$elemMatch": {"at": {"$lte": now}}},
         "auto_approve_hold": {"$exists": False}},
        {"_id": 1},
    ).to_list(500)
    done = 0
    for d in ids:
        try:
            done += bool(await try_auto_approve(db, str(d["_id"]), now))
        except Exception as exc:              # one bad task must not stop the rest
            print(f"[auto-approve] task {d['_id']} failed: {exc!r}", flush=True)
    return done


async def ensure_indexes(db: AsyncIOMotorDatabase) -> None:
    await db["project_tasks"].create_index([("status", 1), ("auto_approvals.at", 1)], sparse=True)


async def run_forever(db: AsyncIOMotorDatabase) -> None:
    """Started with asyncio.create_task from main.py's lifespan; cancelled on shutdown."""
    try:
        await ensure_indexes(db)
    except Exception as exc:
        print(f"[auto-approve] index: {exc!r}", flush=True)
    while True:
        try:
            n = await run_due(db)
            if n:
                print(f"[auto-approve] approved {n} task(s)", flush=True)
        except asyncio.CancelledError:
            raise
        except Exception as exc:              # keep the loop alive
            print(f"[auto-approve] tick failed: {exc!r}", flush=True)
        await asyncio.sleep(POLL_SECONDS)
