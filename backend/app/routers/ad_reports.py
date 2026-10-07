"""
Ad Reports — Meta-style performance numbers, entered daily by the media team.

Rules live in services/ad_report_service.py; this router is permissions + I/O.
Anyone a report doesn't involve gets the same 404 as a missing id, so a stranger
can't confirm a report exists.
"""
import asyncio
from datetime import datetime, timedelta, timezone

from bson import ObjectId
from fastapi import APIRouter, Depends, Query
from motor.motor_asyncio import AsyncIOMotorDatabase
from pymongo.errors import DuplicateKeyError

from app.database import get_db
from app.middleware.auth import get_current_user
from app.schemas.ad_report import CreateAdReportRequest, EntryRequest, UpdateAdReportRequest
from app.services import ad_report_service as ar
from app.utils.response import error_response, success_response
from app.utils.timezone import today_ist

router = APIRouter(prefix="/api/v1/ad-reports", tags=["ad-reports"])

STATUS_RANK = {"missing": 0, "due": 1, "updated": 2, "not_started": 3, "paused": 4, "ended": 5}
NOT_FOUND = "Ad report not found."


def _err(exc: ar.AdReportError):
    return error_response(exc.message, status_code=exc.status_code)


async def _team_names(db, team_ids) -> dict[str, str]:
    ids = {t for t in team_ids if t and ObjectId.is_valid(t)}
    if not ids:
        return {}
    teams = await db["teams"].find({"_id": {"$in": [ObjectId(t) for t in ids]}}, {"name": 1}).to_list(len(ids))
    return {str(t["_id"]): t.get("name", "") for t in teams}


async def _serialize_many(db, docs: list[dict], user: dict) -> list[dict]:
    names = await ar.names_for(db, [a for d in docs for a in d.get("assignees", [])])
    teams = await _team_names(db, [d.get("team_id") for d in docs])
    today = today_ist()
    return [await ar.serialize_report(db, d, names, teams, user, today) for d in docs]


async def _load(db, report_id: str, user: dict) -> dict | None:
    """The report, or None when it's missing OR not shared with this user."""
    if not ObjectId.is_valid(report_id):
        return None
    r = await db[ar.REPORTS].find_one({"_id": ObjectId(report_id)})
    if not r or not await ar.can_enter(db, user, r):
        return None
    return r


async def _leads_any_team(db, uid: str) -> bool:
    return bool(await db["teams"].find_one(
        {"members": {"$elemMatch": {"user_id": uid, "role": "leader"}}}, {"_id": 1}))


# ── Collection ────────────────────────────────────────────────────────────────

@router.get("")
async def list_reports(
    scope: str = Query(default="all"),
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """Reports you can see. scope=mine → only the ones you update."""
    uid = str(current_user["_id"])
    query = {"assignees": uid} if scope == "mine" else await ar.visible_query(db, current_user)
    docs = await db[ar.REPORTS].find(query).sort("created_at", -1).to_list(500)
    data = await _serialize_many(db, docs, current_user)
    data.sort(key=lambda d: (STATUS_RANK.get(d["day_status"], 9), d["name"].lower()))
    return success_response(data=data, message="Ad reports retrieved")


@router.post("", status_code=201)
async def create_report(
    body: CreateAdReportRequest,
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    from app.services import workflow

    name = body.name.strip()
    if not name:
        return error_response("Give the report a name.", status_code=422)
    if len(name) > 120:
        return error_response("Keep the name under 120 characters.", status_code=422)
    if not ObjectId.is_valid(body.team_id) or not await db["teams"].find_one({"_id": ObjectId(body.team_id)}, {"_id": 1}):
        return error_response("Please select a team.", status_code=422)
    if not await workflow.can_assign_to_others(current_user, body.team_id, db):
        return error_response("Only a team leader can create ad reports.", status_code=403)
    try:
        assignees, _ = await ar.validate_assignees(db, body.assignees)
        start = ar.parse_day(body.start_date, "start_date")
        end = ar.parse_day(body.end_date, "end_date") if body.end_date else None
        ar.validate_times(body.reminder_due, body.reminder_escalate)
    except ar.AdReportError as exc:
        return _err(exc)
    today = today_ist()
    if not (today - timedelta(days=365) <= start <= today + timedelta(days=365)):
        return error_response("The start date must be within a year of today.", status_code=422)
    if end and end < start:
        return error_response("The end date can't be before the start date.", status_code=422)

    now = datetime.now(timezone.utc)
    doc = {
        "name": name, "platform": "meta", "team_id": body.team_id, "assignees": assignees,
        "start_date": start.isoformat(), "end_date": end.isoformat() if end else None,
        "extra_metrics": [m for m in dict.fromkeys(body.extra_metrics)],
        "currency": "INR", "reminder_due": body.reminder_due, "reminder_escalate": body.reminder_escalate,
        "status": "active", "pauses": [],
        "created_by": str(current_user["_id"]), "created_by_name": current_user.get("name", ""),
        "created_at": now, "updated_at": now,
    }
    res = await db[ar.REPORTS].insert_one(doc)
    doc["_id"] = res.inserted_id
    data = (await _serialize_many(db, [doc], current_user))[0]
    return success_response(data=data, message="Ad report created", status_code=201)


@router.get("/today")
async def today_summary(
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """Sidebar badge, Overview banner and the leader's 'who has updated' strip."""
    uid = str(current_user["_id"])
    today = today_ist()
    can_create = ar.is_elevated(current_user) or await _leads_any_team(db, uid)

    mine = await db[ar.REPORTS].find({"assignees": uid, "status": "active"}).to_list(200)
    my_due = []
    for r in mine:
        missing = await ar.missing_days(db, r, today)
        if missing:
            my_due.append({"id": str(r["_id"]), "name": r.get("name", ""), "missing": missing})
    has_any = bool(mine) or bool(await db[ar.REPORTS].find_one({"assignees": uid}, {"_id": 1}))

    team = None
    if can_create:
        q = await ar.visible_query(db, current_user)
        q = {"$and": [q, {"status": "active"}]} if q else {"status": "active"}
        managed = await db[ar.REPORTS].find(q).to_list(500)
        names = await ar.names_for(db, [a for r in managed for a in r.get("assignees", [])])
        missing_list, started = [], 0
        for r in managed:
            if r["start_date"] >= today.isoformat():
                continue
            started += 1
            missing = await ar.missing_days(db, r, today)
            if missing:
                missing_list.append({
                    "id": str(r["_id"]), "name": r.get("name", ""),
                    "owners": [names.get(a, "") for a in r.get("assignees", [])],
                    "missing_count": len(missing), "oldest": missing[0],
                })
        team = {"active": started, "updated": started - len(missing_list), "missing": missing_list}

    return success_response(data={
        "visible": can_create or has_any,
        "can_create": can_create,
        "my_due": my_due,
        "my_due_count": len(my_due),
        "team": team,
    }, message="Today's ad reports")


# ── One report ────────────────────────────────────────────────────────────────

@router.get("/{report_id}")
async def get_report(
    report_id: str,
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    r = await _load(db, report_id, current_user)
    if not r:
        return error_response(NOT_FOUND, status_code=404)
    return success_response(data=(await _serialize_many(db, [r], current_user))[0], message="Ad report retrieved")


@router.patch("/{report_id}")
async def update_report(
    report_id: str,
    body: UpdateAdReportRequest,
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    r = await _load(db, report_id, current_user)
    if not r:
        return error_response(NOT_FOUND, status_code=404)
    if not await ar.can_manage(db, current_user, r):
        return error_response("Only the team leader can change this report.", status_code=403)

    today = today_ist()
    yesterday = today - timedelta(days=1)
    now = datetime.now(timezone.utc)
    ended = r.get("status") == "ended"
    upd: dict = {}
    try:
        if body.name is not None:
            name = body.name.strip()
            if not name or len(name) > 120:
                return error_response("Give the report a name (under 120 characters).", status_code=422)
            upd["name"] = name
        if body.assignees is not None:
            upd["assignees"], _ = await ar.validate_assignees(db, body.assignees)
        if body.extra_metrics is not None:
            upd["extra_metrics"] = list(dict.fromkeys(body.extra_metrics))
        if body.reminder_due is not None or body.reminder_escalate is not None:
            due = body.reminder_due or r.get("reminder_due", "12:00")
            esc = body.reminder_escalate or r.get("reminder_escalate", "17:00")
            ar.validate_times(due, esc)
            upd.update(reminder_due=due, reminder_escalate=esc)
        if body.clear_end_date:
            upd["end_date"] = None
        elif body.end_date is not None:
            end = ar.parse_day(body.end_date, "end_date")
            if end.isoformat() < r["start_date"]:
                return error_response("The end date can't be before the start date.", status_code=422)
            upd["end_date"] = end.isoformat()
    except ar.AdReportError as exc:
        return _err(exc)
    if upd and ended:
        return error_response("This report has ended and can't be changed.", status_code=409)

    if body.action == "pause":
        if r.get("status") != "active":
            return error_response("Only an active report can be paused.", status_code=409)
        upd["status"] = "paused"
        upd["pauses"] = r.get("pauses", []) + [{"from": today.isoformat(), "to": None}]
    elif body.action == "resume":
        if r.get("status") != "paused":
            return error_response("Only a paused report can be resumed.", status_code=409)
        pauses = list(r.get("pauses", []))
        if pauses and pauses[-1].get("to") is None:
            if pauses[-1]["from"] > yesterday.isoformat():
                pauses.pop()                       # paused and resumed the same day: no gap
            else:
                pauses[-1] = {**pauses[-1], "to": yesterday.isoformat()}
        upd.update(status="active", pauses=pauses)
    elif body.action == "end":
        if ended:
            return error_response("This report has already ended.", status_code=409)
        last = max(yesterday.isoformat(), r["start_date"])
        if not r.get("end_date") or r["end_date"] > last:
            upd["end_date"] = last
        upd.update(status="ended", ended_at=now)

    if upd:
        upd["updated_at"] = now
        cond = {"_id": r["_id"]}
        if body.action:                             # no lost update between two leaders
            cond["status"] = r.get("status")
        res = await db[ar.REPORTS].update_one(cond, {"$set": upd})
        if body.action and not res.matched_count:
            return error_response("Someone else just changed this report — refresh and try again.", status_code=409)
        r = await db[ar.REPORTS].find_one({"_id": r["_id"]})
    msg = {"pause": "Report paused", "resume": "Report resumed", "end": "Report ended"}.get(body.action or "", "Report updated")
    return success_response(data=(await _serialize_many(db, [r], current_user))[0], message=msg)


@router.get("/{report_id}/series")
async def report_series(
    report_id: str,
    from_: str = Query(default="", alias="from"),
    to: str = Query(default=""),
    granularity: str = Query(default="day"),
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    r = await _load(db, report_id, current_user)
    if not r:
        return error_response(NOT_FOUND, status_code=404)
    if granularity not in ("day", "week", "month"):
        return error_response("Granularity must be day, week or month.", status_code=422)
    today = today_ist()
    try:
        hi = ar.parse_day(to, "to") if to else today - timedelta(days=1)
        lo = ar.parse_day(from_, "from") if from_ else hi - timedelta(days=13)
        data = await ar.series(db, r, lo, hi, granularity, today)
    except ar.AdReportError as exc:
        return _err(exc)
    return success_response(data=data, message="Series retrieved")


@router.get("/{report_id}/entries")
async def list_entries(
    report_id: str,
    from_: str = Query(default="", alias="from"),
    to: str = Query(default=""),
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    r = await _load(db, report_id, current_user)
    if not r:
        return error_response(NOT_FOUND, status_code=404)
    today = today_ist()
    try:
        hi = ar.parse_day(to, "to") if to else today
        lo = ar.parse_day(from_, "from") if from_ else hi - timedelta(days=30)
    except ar.AdReportError as exc:
        return _err(exc)
    rows = await db[ar.ENTRIES].find(
        {"report_id": report_id, "date": {"$gte": lo.isoformat(), "$lte": hi.isoformat()}}
    ).sort("date", -1).to_list(800)
    names = await ar.names_for(db, [x.get("entered_by") for x in rows])
    return success_response(data=[ar.serialize_entry(x, names) for x in rows], message="Entries retrieved")


@router.put("/{report_id}/entries/{day}")
async def save_entry(
    report_id: str,
    day: str,
    body: EntryRequest,
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    r = await _load(db, report_id, current_user)
    if not r:
        return error_response(NOT_FOUND, status_code=404)
    manager = await ar.can_manage(db, current_user, r)
    if r.get("status") == "ended" and not manager:
        return error_response("This report has ended — ask your team leader to correct it.", status_code=409)
    today = today_ist()
    try:
        d = ar.parse_day(day)
        values = ar.validate_entry(r, body.model_dump())
    except ar.AdReportError as exc:
        return _err(exc)
    if d.isoformat() < r["start_date"]:
        return error_response("That day is before the report started.", status_code=422)
    if d > today:
        return error_response("You can't enter numbers for a future day.", status_code=422)
    if r.get("end_date") and d.isoformat() > r["end_date"]:
        return error_response("That day is after the report's end date.", status_code=422)
    note = (body.note or "").strip()
    if len(note) > 500:
        return error_response("Keep the note under 500 characters.", status_code=422)

    uid, now = str(current_user["_id"]), datetime.now(timezone.utc)
    iso = d.isoformat()
    for _ in range(2):                                   # second pass only after an insert race
        existing = await db[ar.ENTRIES].find_one({"report_id": report_id, "date": iso})
        if existing is None:
            try:
                await db[ar.ENTRIES].insert_one({
                    "report_id": report_id, "date": iso, "values": values,
                    "campaign_off": body.campaign_off, "note": note,
                    "entered_by": uid, "entered_by_name": current_user.get("name", ""),
                    "entered_at": now, "updated_at": now, "edits": [],
                })
                created = True
                break
            except DuplicateKeyError:
                continue
        if not manager and d < today - timedelta(days=ar.OWNER_EDIT_DAYS):
            return error_response(
                f"Only your team leader can change numbers older than {ar.OWNER_EDIT_DAYS} days.", status_code=403)
        same = (existing["values"] == values and existing.get("campaign_off", False) == body.campaign_off)
        change = {"by": uid, "by_name": current_user.get("name", ""), "at": now,
                  "old": existing["values"], "new": values}
        upd = {"$set": {"values": values, "campaign_off": body.campaign_off, "note": note, "updated_at": now}}
        if not same:
            upd["$push"] = {"edits": {"$each": [change], "$slice": -50}}
        await db[ar.ENTRIES].update_one({"_id": existing["_id"]}, upd)
        created = False
        break

    await ar.auto_end(db, today)
    entry = await db[ar.ENTRIES].find_one({"report_id": report_id, "date": iso})
    r = await db[ar.REPORTS].find_one({"_id": r["_id"]})
    missing = await ar.missing_days(db, r, today)
    return success_response(data={
        "entry": ar.serialize_entry(entry),
        "missing": missing,
        "day_status": ar.day_status(r, missing),
        "report_status": r.get("status"),
    }, message="Numbers saved" if created else "Numbers updated", status_code=201 if created else 200)


@router.post("/{report_id}/remind")
async def remind_now(
    report_id: str,
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """The leader's nudge — at most once an hour per report."""
    r = await _load(db, report_id, current_user)
    if not r:
        return error_response(NOT_FOUND, status_code=404)
    if not await ar.can_manage(db, current_user, r):
        return error_response("Only the team leader can send a reminder.", status_code=403)
    if r.get("status") != "active":
        return error_response("This report isn't active.", status_code=409)
    missing = await ar.missing_days(db, r)
    if not missing:
        return error_response("Nothing is missing — all numbers are in.", status_code=409)
    now = datetime.now(timezone.utc)
    res = await db[ar.REPORTS].update_one(
        {"_id": r["_id"], "$or": [{"last_manual_remind_at": {"$exists": False}},
                                  {"last_manual_remind_at": {"$lte": now - ar.MANUAL_REMIND_GAP}}]},
        {"$set": {"last_manual_remind_at": now}},
    )
    if not res.modified_count:
        return error_response("A reminder was sent less than an hour ago.", status_code=429)

    people = await ar._active_users(db, r.get("assignees", []))
    title = f"Reminder: {r.get('name', 'Ad report')}"
    msg = f"{current_user.get('name', 'Your team leader')} asked you to add the numbers for {ar.missing_phrase(missing)}."
    meta = {"report_id": report_id, "team_id": r.get("team_id"), "missing": missing,
            "link": f"/ad-reports?report={report_id}&entry=1", "stage": 0}
    for uid in people:
        asyncio.create_task(ar.deliver(db, uid, ar.NOTIF_DUE, title, msg, meta))
    return success_response(data={"notified": len(people)}, message="Reminder sent")
