"""
Stand-in — a team leader hands their Leader Desk to a teammate for a few days
(leave, travel). Agreed 2026-10-14.

One open hand-over per leader, in `leader_standins`:
    {leader_id, leader_name, standin_id, standin_name, team_ids, can_review,
     start_date, end_date (IST "YYYY-MM-DD", both inclusive),
     starts_at, ends_at (UTC; ends_at = midnight IST after end_date),
     note, status: "open" | "ended", created_at, updated_at, ended_at}

While it's active (open, starts_at <= now < ends_at) the stand-in, for the
covered teams:
  • sees the Leader Desk — Assign Work and Reedit (and Pending Reviews only
    when can_review), and may assign work and send routed work back;
  • gets work another team routes directly to the leader;
  • gets the "new work in your team" alerts (and "ready for review" with can_review).
The leader keeps every right they had. Everything is re-checked live: the
leader must still lead the team, and the stand-in must still be an active
member of it — otherwise the hand-over does nothing for that team.
"""
from datetime import date, datetime, timedelta, timezone

from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.utils.timezone import ist_day_start_utc, today_ist

COLL = "leader_standins"
MAX_DAYS = 60                  # longer than this is a team change, not a stand-in
MAX_LEAD_DAYS = 60             # how far ahead a hand-over may be scheduled
NOTE_MAX = 200


class StandinError(Exception):
    def __init__(self, message: str, status_code: int = 422):
        super().__init__(message)
        self.message, self.status_code = message, status_code


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _today() -> date:
    return today_ist()


def _oid(v) -> ObjectId | None:
    try:
        return ObjectId(str(v))
    except Exception:
        return None


def _aware(dt):
    if isinstance(dt, datetime):
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    return None


def _is_active_user(u: dict | None) -> bool:
    return bool(u) and u.get("is_active", True) is not False and u.get("status", "active") == "active"


# ── Reading ─────────────────────────────────────────────────────────────────

async def led_teams(db: AsyncIOMotorDatabase, user_id: str) -> list[dict]:
    return await db["teams"].find(
        {"members": {"$elemMatch": {"user_id": user_id, "role": "leader"}}},
        {"name": 1, "color": 1, "members": 1},
    ).to_list(200)


async def open_handover(db: AsyncIOMotorDatabase, leader_id: str) -> dict | None:
    """The leader's current or upcoming hand-over (not ended, not yet over)."""
    return await db[COLL].find_one({"leader_id": leader_id, "status": "open", "ends_at": {"$gt": _now()}})


def is_live(doc: dict, now: datetime | None = None) -> bool:
    now = now or _now()
    s, e = _aware(doc.get("starts_at")), _aware(doc.get("ends_at"))
    return doc.get("status") == "open" and bool(s and e) and s <= now < e


async def _still_valid_for(db, doc: dict, team_id: str, cache: dict) -> bool:
    """Leader still leads the team; stand-in still an active member of it."""
    if team_id not in doc.get("team_ids", []):
        return False
    key = ("team", team_id)
    if key not in cache:
        cache[key] = await db["teams"].find_one({"_id": _oid(team_id)}, {"members": 1})
    team = cache[key]
    if not team:
        return False
    members = team.get("members") or []
    if not any(m.get("user_id") == doc["leader_id"] and m.get("role") == "leader" for m in members):
        return False
    if not any(m.get("user_id") == doc["standin_id"] for m in members):
        return False
    ukey = ("user", doc["standin_id"])
    if ukey not in cache:
        cache[ukey] = await db["users"].find_one({"_id": _oid(doc["standin_id"])}, {"is_active": 1, "status": 1})
    return _is_active_user(cache[ukey])


async def live_pairs_for_standin(db: AsyncIOMotorDatabase, user_id: str,
                                 now: datetime | None = None) -> list[tuple[str, dict]]:
    """(team_id, hand-over) for every live hand-over to this user, per covered team.
    One person may stand in for two leaders of the same team — both pairs are kept."""
    now = now or _now()
    docs = await db[COLL].find({"standin_id": user_id, "status": "open",
                                "starts_at": {"$lte": now}, "ends_at": {"$gt": now}}).to_list(50)
    pairs: list[tuple[str, dict]] = []
    cache: dict = {}
    for d in docs:
        for t in d.get("team_ids", []):
            if await _still_valid_for(db, d, t, cache):
                pairs.append((t, d))
    return pairs


async def live_for_standin(db: AsyncIOMotorDatabase, user_id: str, now: datetime | None = None) -> dict[str, dict]:
    """team_id -> the hand-over that grants the most for that team (review beats no review)."""
    out: dict[str, dict] = {}
    for t, d in await live_pairs_for_standin(db, user_id, now):
        if t not in out or (d.get("can_review") and not out[t].get("can_review")):
            out[t] = d
    return out


async def live_for_team(db: AsyncIOMotorDatabase, team_id: str, now: datetime | None = None) -> list[dict]:
    """Every live hand-over covering this team (a team may have several leaders)."""
    now = now or _now()
    docs = await db[COLL].find({"team_ids": team_id, "status": "open",
                                "starts_at": {"$lte": now}, "ends_at": {"$gt": now}}).to_list(20)
    cache: dict = {}
    return [d for d in docs if await _still_valid_for(db, d, team_id, cache)]


async def standing_in_for(db: AsyncIOMotorDatabase, user_id: str, team_id: str | None,
                          review: bool = False) -> dict | None:
    """The live hand-over that lets this user act for this team (review=True: may review too)."""
    if not team_id:
        return None
    d = (await live_for_standin(db, user_id)).get(str(team_id))
    if d and (not review or d.get("can_review")):
        return d
    return None


async def redirect_target(db: AsyncIOMotorDatabase, leader_id: str, team_id: str) -> dict | None:
    """Work routed straight to an away leader goes to their live stand-in for that team."""
    if not leader_id or not team_id:
        return None
    for d in await live_for_team(db, str(team_id)):
        if d["leader_id"] == leader_id:
            return d
    return None


def public(doc: dict | None, team_names: dict[str, str] | None = None, now: datetime | None = None) -> dict | None:
    if not doc:
        return None
    now = now or _now()
    names = team_names or {}
    return {
        "id": str(doc["_id"]),
        "leader_id": doc["leader_id"], "leader_name": doc.get("leader_name", ""),
        "standin_id": doc["standin_id"], "standin_name": doc.get("standin_name", ""),
        "team_ids": doc.get("team_ids", []),
        "teams": [{"id": t, "name": names.get(t, "")} for t in doc.get("team_ids", [])],
        "can_review": bool(doc.get("can_review")),
        "start_date": doc.get("start_date"), "end_date": doc.get("end_date"),
        "note": doc.get("note", ""),
        "state": ("active" if is_live(doc, now) else
                  "scheduled" if doc.get("status") == "open" and _aware(doc.get("starts_at")) > now else "ended"),
    }


# ── Writing ─────────────────────────────────────────────────────────────────

def _parse_day(raw, field: str) -> date:
    try:
        return date.fromisoformat(str(raw))
    except (TypeError, ValueError):
        raise StandinError(f"{field} must be a date (YYYY-MM-DD).")


async def save(db: AsyncIOMotorDatabase, leader: dict, standin_id: str, team_ids: list[str] | None,
               start_date: str, end_date: str, can_review: bool, note: str = "") -> tuple[dict, dict | None]:
    """Create or replace the leader's open hand-over. Returns (new doc, replaced doc or None)."""
    leader_id = str(leader["_id"])
    led = await led_teams(db, leader_id)
    if not led:
        raise StandinError("Stand-in is for team leaders — you don't lead a team.", 403)
    if not standin_id or standin_id == leader_id:
        raise StandinError("Choose a teammate to stand in for you.")
    person = await db["users"].find_one({"_id": _oid(standin_id)}, {"name": 1, "email": 1, "is_active": 1, "status": 1})
    if not person:
        raise StandinError("That person no longer exists.")
    if not _is_active_user(person):
        raise StandinError(f"{person.get('name', 'That person')} is deactivated.")
    theirs = [t for t in led if any(m.get("user_id") == standin_id for m in t.get("members") or [])]
    if not theirs:
        raise StandinError("Choose someone from a team you lead.")
    allowed = {str(t["_id"]) for t in theirs}
    if team_ids:
        chosen = list(dict.fromkeys(str(t) for t in team_ids))
        bad = [t for t in chosen if t not in allowed]
        if bad:
            raise StandinError("They can only stand in for teams you lead and they belong to.")
    else:
        chosen = [str(t["_id"]) for t in theirs]

    today = _today()
    start, end = _parse_day(start_date, "start_date"), _parse_day(end_date, "end_date")
    if start < today:
        raise StandinError("The start can't be in the past.")
    if start > today + timedelta(days=MAX_LEAD_DAYS):
        raise StandinError(f"Start within the next {MAX_LEAD_DAYS} days.")
    if end < start:
        raise StandinError("The end date can't be before the start.")
    if (end - start).days + 1 > MAX_DAYS:
        raise StandinError(f"A stand-in can last up to {MAX_DAYS} days.")
    note = (note or "").strip()
    if len(note) > NOTE_MAX:
        raise StandinError(f"Keep the note under {NOTE_MAX} characters.")

    now = _now()
    # Today's start means "from now", not from this morning.
    starts_at = max(ist_day_start_utc(start), now) if start == today else ist_day_start_utc(start)
    doc = {
        "leader_id": leader_id, "leader_name": leader.get("name") or leader.get("email") or "Team leader",
        "standin_id": standin_id, "standin_name": person.get("name") or person.get("email") or "",
        "team_ids": chosen, "can_review": bool(can_review),
        "start_date": start.isoformat(), "end_date": end.isoformat(),
        "starts_at": starts_at, "ends_at": ist_day_start_utc(end + timedelta(days=1)),
        "note": note, "status": "open", "created_at": now, "updated_at": now,
    }
    old = await open_handover(db, leader_id)
    if old:
        await db[COLL].update_one({"_id": old["_id"]}, {"$set": {"status": "ended", "ended_at": now,
                                                                "ended_reason": "replaced", "updated_at": now}})
    res = await db[COLL].insert_one(doc)
    doc["_id"] = res.inserted_id
    return doc, old


async def end_now(db: AsyncIOMotorDatabase, leader_id: str) -> dict | None:
    old = await open_handover(db, leader_id)
    if not old:
        return None
    now = _now()
    await db[COLL].update_one({"_id": old["_id"], "status": "open"},
                              {"$set": {"status": "ended", "ended_at": now, "ended_reason": "ended", "updated_at": now}})
    return old


async def team_names(db: AsyncIOMotorDatabase, ids) -> dict[str, str]:
    oids = [o for o in (_oid(t) for t in ids) if o]
    rows = await db["teams"].find({"_id": {"$in": oids}}, {"name": 1}).to_list(len(oids) or 1) if oids else []
    return {str(t["_id"]): t.get("name", "") for t in rows}


def fmt_day(iso: str) -> str:
    d = date.fromisoformat(iso)
    return f"{d.strftime('%a')} {d.day} {d.strftime('%b')}"


async def notify_handover(db: AsyncIOMotorDatabase, doc: dict, replaced: dict | None) -> None:
    """The stand-in, and everyone else in the covered teams, hear who to go to."""
    from app.services.notification_service import push_notification
    names = await team_names(db, doc["team_ids"])
    teams_txt = ", ".join(names.get(t, "") for t in doc["team_ids"]) or "your team"
    when = (f"until {fmt_day(doc['end_date'])}" if doc["start_date"] <= _today().isoformat()
            else f"from {fmt_day(doc['start_date'])} to {fmt_day(doc['end_date'])}")
    can = "assign new work and handle reedits" + (", and review submissions" if doc.get("can_review") else "")
    meta = {"standin_id": str(doc["_id"]), "link": "/leader"}
    await push_notification(
        db, doc["standin_id"], "standin_assigned", f"You're standing in for {doc['leader_name']}",
        f"{doc['leader_name']} handed you the Leader Desk for {teams_txt} {when}. You can {can}.", meta)
    if replaced and replaced["standin_id"] != doc["standin_id"]:
        await push_notification(
            db, replaced["standin_id"], "standin_ended", f"No longer standing in for {replaced['leader_name']}",
            f"{replaced['leader_name']} chose someone else to stand in.", {"link": "/leader"})
    teams = await db["teams"].find({"_id": {"$in": [_oid(t) for t in doc["team_ids"]]}}, {"members": 1}).to_list(20)
    told = {doc["leader_id"], doc["standin_id"]}
    for t in teams:
        for m in t.get("members") or []:
            uid = m.get("user_id")
            if uid and uid not in told:
                told.add(uid)
                await push_notification(
                    db, uid, "standin_team", f"{doc['standin_name']} is standing in for {doc['leader_name']}",
                    f"{doc['leader_name']} is away {when}. {doc['standin_name']} looks after new work and reedits"
                    f"{' and reviews submissions' if doc.get('can_review') else ''} for {teams_txt} until then.", {"link": "/projects"})


async def notify_ended(db: AsyncIOMotorDatabase, doc: dict) -> None:
    from app.services.notification_service import push_notification
    if is_live(doc):
        title, msg = f"{doc['leader_name']} is back", f"Your stand-in for {doc['leader_name']} has ended — thank you!"
    else:
        title, msg = "Stand-in cancelled", f"{doc['leader_name']} no longer needs you to stand in."
    await push_notification(db, doc["standin_id"], "standin_ended", title, msg, {"link": "/projects"})


async def ensure_indexes(db: AsyncIOMotorDatabase) -> None:
    await db[COLL].create_index([("standin_id", 1), ("status", 1), ("ends_at", 1)])
    await db[COLL].create_index([("team_ids", 1), ("status", 1), ("ends_at", 1)])
    await db[COLL].create_index([("leader_id", 1), ("status", 1)])
