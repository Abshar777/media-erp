"""
Repeating tasks.

A *series* (collection `recurring_tasks`) is a template that spawns ordinary
tasks on a schedule. Every copy is born through task_factory.raise_task — the
same path as a hand-made task — so it gets the same validation, approver,
verifier, notifications and chat DM. Copies are ordinary tasks, so Overview,
Projects, Leader Desk, Performance and the member filter show them for free.

Series document
---------------
  title, description, priority, team_id, approver_id, approver_name,
  verify_users, verify_teams, attachments        ← template for each copy
  assignees           [user_id, …]               ← one copy per person
  frequency           daily | weekly | monthly
  anchor_date         "YYYY-MM-DD" (IST)          ← fixes the weekday / day-of-month
  next_index          anchor-relative index of the next occurrence
  next_date           its date, or None once finished
  occurrences_total   N, or None = until stopped
  occurrences_done    copies actually created (what N counts)
  due_offset_days     each copy due this many days after its own date
  status              active | paused | completed | stopped

Two indices on purpose: `next_index` walks the calendar, `occurrences_done`
counts copies. They differ only after a pause — paused days are skipped and
must not count toward N.

Why it can never double-assign
------------------------------
Production runs two worker processes and each runs this scheduler. So:
  1. CREATE FIRST, idempotently. A partial unique index on
     (recurrence.id, recurrence.date, assigned_to) means a second attempt at
     the same person's copy for the same day fails with DuplicateKeyError,
     before any notification is sent.
  2. THEN ADVANCE with compare-and-set on `next_index`. Each write is derived
     from the state that worker read, so two workers racing on the same day
     just write the same values. What the compare-and-set really prevents is a
     STALE write after a pause+resume: resume jumps past the paused days, and a
     worker that read the series before the pause would otherwise rewind it —
     and the next run would create copies for days the leader paused, which
     nothing de-duplicates because they never existed.
     (tests/test_recurrence.py :: test_pause_and_resume_during_a_run_…)
A crash between the two simply retries next tick — the index stops duplicates,
so nothing is lost and nothing is doubled.
"""
import asyncio
import calendar
import logging
from datetime import date, datetime, timedelta, timezone

from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorDatabase
from pymongo.errors import DuplicateKeyError

from app.utils.timezone import today_ist

logger = logging.getLogger(__name__)

FREQUENCIES = ("daily", "weekly", "monthly")
MAX_COUNT = {"daily": 365, "weekly": 104, "monthly": 36}
MAX_ASSIGNEES = 25
MAX_DUE_OFFSET_DAYS = 60
CATCHUP_CAP = 31          # most missed copies one series creates in one run
POLL_SECONDS = 60
ELEVATED_ROLES = ("Super Admin", "Admin", "Coordinator")

TEMPLATE_FIELDS = ("title", "description", "priority", "team_id", "approver_id",
                   "approver_name", "verify_users", "verify_teams", "attachments")


# ── Date engine ───────────────────────────────────────────────────────────────

def add_months(d: date, months: int, anchor_day: int) -> date:
    """`d` moved by `months`, landing on `anchor_day` or the month's last day."""
    y, m0 = divmod(d.month - 1 + months, 12)
    year, month = d.year + y, m0 + 1
    return date(year, month, min(anchor_day, calendar.monthrange(year, month)[1]))


def occurrence_date(frequency: str, anchor: date, index: int, month_day: int | None = None) -> date:
    """
    Date of occurrence `index` (0 = the anchor itself).

    Always computed from the anchor, never from the previous occurrence. That is
    what keeps a series set on the 31st landing on the 31st whenever a month
    has one — stepping month-to-month would decay 31 → 30 → 28 → 28 → … forever.

    `month_day` is the day the leader chose (monthly). It matters when the
    anchor itself was clamped: the 31st chosen in February anchors on the 28th,
    and without it every later month would land on the 28th too.
    """
    if frequency == "daily":
        return anchor + timedelta(days=index)
    if frequency == "weekly":
        return anchor + timedelta(weeks=index)
    if frequency == "monthly":
        return add_months(anchor, index, month_day or anchor.day)
    raise ValueError(f"unknown frequency: {frequency!r}")


def first_date(frequency: str, today: date, weekday: int | None = None, month_day: int | None = None) -> date:
    """
    The series' first day: today, or the next chosen weekday / day of the month.
    `weekday` uses Python's numbering (Monday 0 … Sunday 6).
    """
    if frequency == "weekly" and weekday is not None:
        return today + timedelta(days=(weekday - today.weekday()) % 7)
    if frequency == "monthly" and month_day:
        this_month = add_months(today, 0, month_day)
        return this_month if this_month >= today else add_months(today, 1, month_day)
    return today


def first_index_on_or_after(frequency: str, anchor: date, start: int, target: date,
                            month_day: int | None = None) -> int:
    """Smallest index >= `start` whose date is on or after `target` (used on resume)."""
    days = (target - anchor).days
    if frequency == "daily":
        return max(start, days)
    if frequency == "weekly":
        return max(start, -(-days // 7))          # ceiling division
    i = start
    while occurrence_date(frequency, anchor, i, month_day) < target:
        i += 1
    return i


# ── Permissions ───────────────────────────────────────────────────────────────

def _is_elevated(user: dict) -> bool:
    return ((user.get("_role") or {}).get("role_name", "")) in ELEVATED_ROLES


async def can_create_series(user: dict, team_id, db: AsyncIOMotorDatabase) -> bool:
    """Repetition keeps assigning work on someone's behalf, so it's a leadership action."""
    from app.services import workflow
    return await workflow.can_assign_to_others(user, team_id, db)


async def can_manage_series(user: dict, series: dict, db: AsyncIOMotorDatabase) -> bool:
    """Creator, a leader of the series' team, or an admin role."""
    if _is_elevated(user) or series.get("created_by") == str(user["_id"]):
        return True
    team_id = series.get("team_id")
    if team_id and ObjectId.is_valid(team_id):
        return bool(await db["teams"].find_one({
            "_id": ObjectId(team_id),
            "members": {"$elemMatch": {"user_id": str(user["_id"]), "role": "leader"}},
        }, {"_id": 1}))
    return False


async def can_view_series(user: dict, series: dict, db: AsyncIOMotorDatabase) -> bool:
    """
    Anyone who can manage it, a current assignee, or someone a copy involves
    (past assignee, approver, verifier) — the people whose task detail shows
    the series strip. Everyone else must not learn it exists.
    """
    uid = str(user["_id"])
    if uid in series.get("assignees", []) or await can_manage_series(user, series, db):
        return True
    return bool(await db["project_tasks"].find_one({
        "recurrence.id": str(series["_id"]),
        "$or": [{"assigned_to": uid}, {"approver_id": uid}, {"verify_users": uid}],
    }, {"_id": 1}))


async def _load_actor(db: AsyncIOMotorDatabase, user_id: str) -> dict | None:
    """The series creator as get_current_user would build them, or None if inactive."""
    if not user_id or not ObjectId.is_valid(user_id):
        return None
    user = await db["users"].find_one({"_id": ObjectId(user_id)})
    if not user or not user.get("is_active", True):
        return None
    role_id = user.get("role_id")
    user["_role"] = (await db["roles"].find_one({"_id": ObjectId(role_id)})
                     if role_id and ObjectId.is_valid(role_id) else None)
    return user


async def _creator_still_allowed(db, series) -> tuple[dict | None, str]:
    """Copies are created in the creator's name, so they must still be allowed to."""
    actor = await _load_actor(db, series.get("created_by", ""))
    if not actor:
        return None, "The person who set this up is no longer active."
    if not await can_create_series(actor, series.get("team_id"), db):
        return None, "The person who set this up can no longer assign work in this team."
    return actor, ""


# ── Validation shared by create + edit ───────────────────────────────────────

async def validate_assignees(db: AsyncIOMotorDatabase, assignees) -> tuple[list[str], dict, str]:
    """
    De-duplicate and check assignees. Returns (ids, {id: name}, error).
    Order is preserved so copies are created in the order people were picked.
    """
    ids: list[str] = []
    for a in assignees or []:
        a = (a or "").strip()
        if a and a not in ids:
            ids.append(a)
    if not ids:
        return [], {}, "Please assign this task to at least one person."
    if len(ids) > MAX_ASSIGNEES:
        return [], {}, f"You can assign one task to at most {MAX_ASSIGNEES} people at a time."
    bad = [a for a in ids if not ObjectId.is_valid(a)]
    users = {} if bad else {
        str(u["_id"]): u for u in await db["users"].find(
            {"_id": {"$in": [ObjectId(a) for a in ids]}}, {"name": 1, "is_active": 1}
        ).to_list(MAX_ASSIGNEES)
    }
    missing = bad or [a for a in ids if a not in users or not users[a].get("is_active", True)]
    if missing:
        return [], {}, "Some of the people you picked are no longer active. Please refresh and pick again."
    return ids, {a: users[a].get("name", "") for a in ids}, ""


def validate_repeat(frequency: str, count, due_offset_days, weekday=None, month_day=None) -> str:
    if frequency not in FREQUENCIES:
        return "Choose daily, weekly or monthly."
    if weekday is not None and (frequency != "weekly" or isinstance(weekday, bool) or not 0 <= weekday <= 6):
        return "Choose a day of the week for a weekly task."
    if month_day is not None and (frequency != "monthly" or isinstance(month_day, bool) or not 1 <= month_day <= 31):
        return "Choose a date between 1 and 31 for a monthly task."
    if count is not None:
        if not isinstance(count, int) or count < 1:
            return "Repeat at least once."
        if count > MAX_COUNT[frequency]:
            unit = {"daily": "days", "weekly": "weeks", "monthly": "months"}[frequency]
            return f"A {frequency} task can repeat at most {MAX_COUNT[frequency]} {unit}."
    if due_offset_days is not None and not (0 <= due_offset_days <= MAX_DUE_OFFSET_DAYS):
        return f"Each copy can be due at most {MAX_DUE_OFFSET_DAYS} days after it's created."
    return ""


# ── Spawning ──────────────────────────────────────────────────────────────────

async def _spawn_occurrence(db, series: dict, copy_number: int, occ: date, actor: dict):
    """
    Create one copy per assignee for occurrence date `occ`. Idempotent — a copy
    that already exists raises DuplicateKeyError and is skipped silently.
    Returns (created_tasks, errors, duplicates).
    """
    from app.services.task_factory import TaskRaiseError, raise_task

    due = (occ + timedelta(days=series.get("due_offset_days") or 0)).isoformat()
    created, errors, dupes = [], [], 0
    for uid in series.get("assignees", []):
        user = (await db["users"].find_one({"_id": ObjectId(uid)}, {"name": 1, "is_active": 1})
                if ObjectId.is_valid(uid) else None)
        if not user or not user.get("is_active", True):
            errors.append({"user_id": uid, "message": "No longer active — skipped."})
            continue
        data = {k: series.get(k) for k in TEMPLATE_FIELDS}
        data.update({
            "assigned_to": uid,
            "assigned_to_name": user.get("name", ""),
            "due_date": due,
            "recurrence": {
                "id": str(series["_id"]),
                "frequency": series["frequency"],
                "index": copy_number,
                "total": series.get("occurrences_total"),
                "date": occ.isoformat(),
            },
        })
        try:
            created.append(await raise_task(db, data, actor))
        except DuplicateKeyError:
            dupes += 1          # another worker already made this copy
        except TaskRaiseError as exc:
            errors.append({"user_id": uid, "message": exc.message})
    return created, errors, dupes


async def advance_series(db: AsyncIOMotorDatabase, series_id: ObjectId,
                         today: date | None = None, cap: int = CATCHUP_CAP) -> dict:
    """
    Create every due copy of one series (missed ones included, up to `cap`).
    Safe to call from any number of workers at once.
    """
    today = today or today_ist()
    out = {"created": [], "errors": [], "processed": 0, "paused_reason": ""}
    for _ in range(cap):
        s = await db["recurring_tasks"].find_one({"_id": series_id})
        if not s or s.get("status") != "active" or not s.get("next_date"):
            break
        occ = date.fromisoformat(s["next_date"])
        if occ > today:
            break

        actor, reason = await _creator_still_allowed(db, s)
        if not actor:
            await _pause(db, s, reason)
            out["paused_reason"] = reason
            break

        copy_no = s.get("occurrences_done", 0) + 1
        created, errors, dupes = await _spawn_occurrence(db, s, copy_no, occ, actor)

        # Nobody could get a copy (every assignee refused, none merely already
        # done by another worker). Pause rather than fail silently every day.
        if not created and not dupes and errors and len(errors) == len(s.get("assignees", [])):
            reason = errors[0]["message"]
            await _pause(db, s, reason)
            out["errors"] += errors
            out["paused_reason"] = reason
            break

        done = s.get("occurrences_done", 0) + 1
        total = s.get("occurrences_total")
        nxt = s["next_index"] + 1
        finished = total is not None and done >= total
        now = datetime.now(timezone.utc)
        upd = {
            "occurrences_done": done,
            "next_index": nxt,
            "next_date": None if finished else occurrence_date(
                s["frequency"], date.fromisoformat(s["anchor_date"]), nxt, s.get("month_day")).isoformat(),
            "status": "completed" if finished else "active",
            "last_run_at": now,
            "updated_at": now,
            "last_errors": errors[-10:],
        }
        # Compare-and-set: only the worker that still sees this next_index wins.
        res = await db["recurring_tasks"].update_one(
            {"_id": series_id, "status": "active", "next_index": s["next_index"]}, {"$set": upd}
        )
        if res.modified_count:
            out["created"] += created
            out["errors"] += errors
            out["processed"] += 1
    return out


async def _pause(db, series: dict, reason: str) -> None:
    await db["recurring_tasks"].update_one(
        {"_id": series["_id"], "status": "active"},
        {"$set": {"status": "paused", "paused_reason": reason,
                  "updated_at": datetime.now(timezone.utc)}},
    )
    logger.warning("Recurring series %s paused: %s", series["_id"], reason)


# ── Lifecycle ─────────────────────────────────────────────────────────────────

async def create_series(db: AsyncIOMotorDatabase, template: dict, assignees: list[str],
                        frequency: str, count, due_offset_days: int, creator: dict,
                        weekday: int | None = None, month_day: int | None = None) -> tuple[dict, dict]:
    """
    Insert a series anchored on its first day — today, or the chosen weekday /
    day of the month — and create today's copy now when the first day is today.
    """
    today = today_ist()
    anchor = first_date(frequency, today, weekday, month_day)
    now = datetime.now(timezone.utc)
    doc = {k: template.get(k) for k in TEMPLATE_FIELDS}
    doc.update({
        "assignees": assignees,
        "frequency": frequency,
        "anchor_date": anchor.isoformat(),
        "month_day": (month_day or anchor.day) if frequency == "monthly" else None,
        "weekday": anchor.weekday() if frequency == "weekly" else None,
        "next_index": 0,
        "next_date": anchor.isoformat(),
        "occurrences_total": count,
        "occurrences_done": 0,
        "due_offset_days": due_offset_days or 0,
        "status": "active",
        "paused_reason": "",
        "last_errors": [],
        "created_by": str(creator["_id"]),
        "created_by_name": creator.get("name", ""),
        "created_at": now,
        "updated_at": now,
    })
    doc["_id"] = (await db["recurring_tasks"].insert_one(doc)).inserted_id
    result = await advance_series(db, doc["_id"], today)
    return await db["recurring_tasks"].find_one({"_id": doc["_id"]}), result


async def resume_series(db: AsyncIOMotorDatabase, series: dict) -> dict:
    """
    Resume from the next occurrence on or after today. Days that passed while
    paused are skipped on purpose — pausing means "not on those days" — and do
    not count toward N. (Missed days from server DOWNTIME are different: those
    are caught up, because nobody chose to skip them.)
    """
    anchor = date.fromisoformat(series["anchor_date"])
    md = series.get("month_day")
    idx = first_index_on_or_after(series["frequency"], anchor, series["next_index"], today_ist(), md)
    await db["recurring_tasks"].update_one(
        {"_id": series["_id"], "status": "paused"},
        {"$set": {"status": "active", "paused_reason": "", "next_index": idx,
                  "next_date": occurrence_date(series["frequency"], anchor, idx, md).isoformat(),
                  "updated_at": datetime.now(timezone.utc)}},
    )
    await advance_series(db, series["_id"])          # today's copy now, if today is a day
    return await db["recurring_tasks"].find_one({"_id": series["_id"]})


async def ensure_indexes(db: AsyncIOMotorDatabase) -> None:
    """Idempotent. The unique index is what makes concurrent workers safe."""
    await db["recurring_tasks"].create_index([("status", 1), ("next_date", 1)])
    await db["recurring_tasks"].create_index([("created_by", 1), ("created_at", -1)])
    await db["recurring_tasks"].create_index("team_id")
    await db["project_tasks"].create_index(
        [("recurrence.id", 1), ("recurrence.date", 1), ("assigned_to", 1)],
        unique=True,
        name="unique_recurrence_copy",
        # Only copies of a series — ordinary tasks carry no `recurrence` at all.
        partialFilterExpression={"recurrence.id": {"$type": "string"}},
    )


def serialize_series(s: dict, names: dict[str, str]) -> dict:
    from app.utils.timezone import utc_iso
    return {
        "id": str(s["_id"]),
        "title": s.get("title", ""),
        "description": s.get("description", ""),
        "priority": s.get("priority", "medium"),
        "team_id": s.get("team_id"),
        "assignees": [{"id": a, "name": names.get(a, "")} for a in s.get("assignees", [])],
        "frequency": s.get("frequency"),
        "anchor_date": s.get("anchor_date"),
        "month_day": s.get("month_day"),
        "weekday": s.get("weekday"),
        "next_date": s.get("next_date"),
        "occurrences_total": s.get("occurrences_total"),
        "occurrences_done": s.get("occurrences_done", 0),
        "due_offset_days": s.get("due_offset_days", 0),
        "status": s.get("status"),
        "paused_reason": s.get("paused_reason", ""),
        "last_errors": s.get("last_errors", []),
        "created_by": s.get("created_by"),
        "created_by_name": s.get("created_by_name", ""),
        "created_at": utc_iso(s.get("created_at")),
        "updated_at": utc_iso(s.get("updated_at")),
    }


# ── Scheduler (house pattern: daemon thread, own loop, own Motor client) ─────

async def run_due(db: AsyncIOMotorDatabase, today: date | None = None) -> int:
    """Advance every series with a copy due on or before today. Returns copies created."""
    today = today or today_ist()
    made = 0
    due = await db["recurring_tasks"].find(
        {"status": "active", "next_date": {"$ne": None, "$lte": today.isoformat()}}, {"_id": 1}
    ).to_list(1000)
    for s in due:
        try:
            made += len((await advance_series(db, s["_id"], today))["created"])
        except Exception as exc:                        # one bad series never blocks the rest
            logger.error("Recurring series %s failed: %s", s["_id"], exc)
    return made


def start_recurring_scheduler() -> None:
    """Entry point from main.py lifespan — runs forever in a daemon thread."""
    async def _run():
        from motor.motor_asyncio import AsyncIOMotorClient
        from app.config import settings
        client = AsyncIOMotorClient(settings.mongodb_url)
        db = client[settings.mongodb_db_name]
        await ensure_indexes(db)
        while True:
            try:
                made = await run_due(db)
                if made:
                    logger.info("Recurring scheduler created %d task(s)", made)
            except Exception as exc:
                logger.error("Recurring scheduler tick failed: %s", exc)
            await asyncio.sleep(POLL_SECONDS)

    try:
        asyncio.new_event_loop().run_until_complete(_run())
    except Exception as exc:
        logger.error("Recurring scheduler thread crashed: %s", exc)
