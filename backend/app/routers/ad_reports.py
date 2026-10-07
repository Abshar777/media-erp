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
from app.schemas.ad_report import CreateAdReportRequest, CreativeRequest, EntryRequest, UpdateAdReportRequest
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
    acc_ids = {d.get("account_id") for d in docs if d.get("account_id") and ObjectId.is_valid(d["account_id"])}
    accounts = await db[ar.REPORTS].find({"_id": {"$in": [ObjectId(a) for a in acc_ids]}}, {"name": 1}).to_list(len(acc_ids) or 1) if acc_ids else []
    account_names = {str(a["_id"]): a.get("name", "") for a in accounts}
    today = today_ist()
    return [await ar.serialize_report(db, d, names, teams, user, today, account_names) for d in docs]


async def _check_account(db, account_id: str, team_id: str):
    """An ad may join an account of its own team that is still open. Returns an error response or None."""
    if not ObjectId.is_valid(account_id):
        return error_response("Choose an account from the list.", status_code=422)
    acc = await db[ar.REPORTS].find_one({"_id": ObjectId(account_id)})
    if not acc or not ar.is_account(acc):
        return error_response("Choose an account from the list.", status_code=422)
    if acc.get("team_id") != team_id:
        return error_response("An ad can only join an account of its own team.", status_code=422)
    if acc.get("status") == "ended":
        return error_response("That account has ended — choose another one.", status_code=422)
    return None


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

    now = datetime.now(timezone.utc)
    if body.kind == "account":
        ref = (body.ad_account_ref or "").strip()
        if len(ref) > 60:
            return error_response("Keep the ad account ID under 60 characters.", status_code=422)
        doc = {
            "kind": "account", "name": name, "platform": "meta", "team_id": body.team_id, "assignees": [],
            "ad_account_ref": ref, "start_date": today_ist().isoformat(), "end_date": None,
            "extra_metrics": [], "currency": "INR", "status": "active", "pauses": [],
            "created_by": str(current_user["_id"]), "created_by_name": current_user.get("name", ""),
            "created_at": now, "updated_at": now,
        }
        res = await db[ar.REPORTS].insert_one(doc)
        doc["_id"] = res.inserted_id
        return success_response(data=(await _serialize_many(db, [doc], current_user))[0],
                                message="Ad account created", status_code=201)

    if body.account_id:
        bad = await _check_account(db, body.account_id, body.team_id)
        if bad:
            return bad
    try:
        assignees, _ = await ar.validate_assignees(db, body.assignees)
        start = ar.parse_day(body.start_date or "", "start_date")
        end = ar.parse_day(body.end_date, "end_date") if body.end_date else None
        ar.validate_times(body.reminder_due, body.reminder_escalate)
    except ar.AdReportError as exc:
        return _err(exc)
    today = today_ist()
    if not (today - timedelta(days=365) <= start <= today + timedelta(days=365)):
        return error_response("The start date must be within a year of today.", status_code=422)
    if end and end < start:
        return error_response("The end date can't be before the start date.", status_code=422)

    doc = {
        "kind": "ad", "account_id": body.account_id or None,
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
        q = {"$and": [q, {"status": "active"}, ar.AD_ONLY]} if q else {"status": "active", **ar.AD_ONLY}
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
    account = ar.is_account(r)
    if account and body.action in ("pause", "resume"):
        return error_response("Pause the ads inside the account instead.", status_code=409)
    if account and (body.assignees is not None or body.extra_metrics is not None or body.end_date is not None
                    or body.reminder_due is not None or body.reminder_escalate is not None
                    or body.account_id or body.clear_account):
        return error_response("An account has no people, dates or numbers of its own — edit its ads.", status_code=422)
    if not account:
        if body.clear_account:
            upd["account_id"] = None
        elif body.account_id:
            bad = await _check_account(db, body.account_id, r.get("team_id"))
            if bad:
                return bad
            upd["account_id"] = body.account_id
    if body.ad_account_ref is not None:
        if not account:
            return error_response("Only an account has an ad account ID.", status_code=422)
        ref = body.ad_account_ref.strip()
        if len(ref) > 60:
            return error_response("Keep the ad account ID under 60 characters.", status_code=422)
        upd["ad_account_ref"] = ref
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
        if not account:
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
    children = await ar.children_of(db, r) if ar.is_account(r) else None
    try:
        hi = ar.parse_day(to, "to") if to else today - timedelta(days=1)
        lo = ar.parse_day(from_, "from") if from_ else hi - timedelta(days=13)
        data = await ar.series(db, r, lo, hi, granularity, today, children=children)
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
    if ar.is_account(r):
        return error_response("Numbers are entered on the ads inside this account.", status_code=422)
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
    if ar.is_account(r):
        return error_response("Remind the people on the ads inside this account.", status_code=409)
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


# ── Creatives — the ad itself, shown above the numbers ───────────────────────

async def _creative_target(db, report_id: str, user: dict):
    """(report, error_response). Assignees and leaders may add; ended = leaders only."""
    r = await _load(db, report_id, user)
    if not r:
        return None, error_response(NOT_FOUND, status_code=404)
    if r.get("status") == "ended" and not await ar.can_manage(db, user, r):
        return None, error_response("This report has ended — ask your team leader.", status_code=409)
    return r, None


@router.post("/{report_id}/creatives", status_code=201)
async def add_creative(
    report_id: str,
    body: CreativeRequest,
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    import uuid
    r, err = await _creative_target(db, report_id, current_user)
    if err:
        return err
    if len(r.get("creatives", [])) >= ar.MAX_CREATIVES:
        return error_response(f"A report can hold up to {ar.MAX_CREATIVES} creatives — remove one first.", status_code=422)
    try:
        item = await asyncio.to_thread(ar.validate_creative, body.model_dump())   # HEAD to R2 is blocking
    except ar.AdReportError as exc:
        return _err(exc)
    item.update(id=uuid.uuid4().hex, uploaded_by=str(current_user["_id"]),
                uploaded_by_name=current_user.get("name", ""), uploaded_at=datetime.now(timezone.utc))
    # The size check lives in the filter, so two simultaneous uploads can't overshoot the cap.
    res = await db[ar.REPORTS].update_one(
        {"_id": r["_id"], f"creatives.{ar.MAX_CREATIVES - 1}": {"$exists": False}},
        {"$push": {"creatives": item}, "$set": {"updated_at": datetime.now(timezone.utc)}},
    )
    if not res.modified_count:
        return error_response(f"A report can hold up to {ar.MAX_CREATIVES} creatives — remove one first.", status_code=422)
    r = await db[ar.REPORTS].find_one({"_id": r["_id"]})
    return success_response(data=ar.serialize_creatives(r), message="Creative added", status_code=201)


@router.post("/{report_id}/creatives/{creative_id}/cover")
async def set_cover(
    report_id: str,
    creative_id: str,
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    r, err = await _creative_target(db, report_id, current_user)
    if err:
        return err
    items = r.get("creatives", [])
    pick = next((c for c in items if c.get("id") == creative_id), None)
    if not pick:
        return error_response("Creative not found.", status_code=404)
    ordered = [pick] + [c for c in items if c is not pick]
    # Compare-and-set on the list we read, so a creative added meanwhile isn't dropped.
    res = await db[ar.REPORTS].update_one({"_id": r["_id"], "creatives": items},
                                          {"$set": {"creatives": ordered, "updated_at": datetime.now(timezone.utc)}})
    if not res.matched_count:
        return error_response("The creatives just changed — refresh and try again.", status_code=409)
    r = await db[ar.REPORTS].find_one({"_id": r["_id"]})
    return success_response(data=ar.serialize_creatives(r), message="Cover updated")


@router.delete("/{report_id}/creatives/{creative_id}")
async def remove_creative(
    report_id: str,
    creative_id: str,
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """Detaches the file (house rule: stored objects are never deleted from the shared bucket)."""
    r, err = await _creative_target(db, report_id, current_user)
    if err:
        return err
    pick = next((c for c in r.get("creatives", []) if c.get("id") == creative_id), None)
    if not pick:
        return error_response("Creative not found.", status_code=404)
    if pick.get("uploaded_by") != str(current_user["_id"]) and not await ar.can_manage(db, current_user, r):
        return error_response("Only the person who added it or the team leader can remove it.", status_code=403)
    await db[ar.REPORTS].update_one({"_id": r["_id"]}, {"$pull": {"creatives": {"id": creative_id}},
                                                        "$set": {"updated_at": datetime.now(timezone.utc)}})
    r = await db[ar.REPORTS].find_one({"_id": r["_id"]})
    return success_response(data=ar.serialize_creatives(r), message="Creative removed")
