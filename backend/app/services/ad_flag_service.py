"""
"Ad not performing" — marketing flags a weak ad, a chosen team leader (usually
the media team's) recreates it.

  open ──start──▶ in_progress ──done──▶ done
    │                 │
    ├──decline────────┴──────────────▶ declined   (reason required)
    └──withdraw (sender, while open) ─▶ withdrawn

Rules:
  • who may flag: whoever can work on the ad's report (its assignees, its
    team's leaders, admin roles) — ads only, not account rows;
  • who receives: an active team leader other than the sender, picked with the
    team they lead (the team shown on the card);
  • one active flag per ad, enforced by a unique partial index;
  • the flag carries what the receiver needs — a media leader usually can't
    open another team's report: a frozen snapshot of the numbers when it was
    sent (last 7 complete days vs the 7 before, the report's own calculation)
    plus the ad's current creatives, signed on every read.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import date, datetime, timedelta, timezone

from bson import ObjectId
from pymongo.errors import DuplicateKeyError

from app.services import ad_report_service as ar
from app.utils.timezone import today_ist, utc_iso

logger = logging.getLogger(__name__)

FLAGS = "ad_flags"
ACTIVE = ("open", "in_progress")
CLOSED_VISIBLE_DAYS = 14          # a closed flag still shows on the ad / desk this long
NOTE_MAX = 1000
NOTIF_FLAGGED, NOTIF_UPDATE = "ad_flagged", "ad_flag_update"

REASONS: dict[str, str] = {
    "high_cpl": "High cost per lead",
    "few_leads": "Too few leads",
    "low_clicks": "Low clicks",
    "creative_tired": "Ad looks tired",
    "wrong_audience": "Wrong audience",
    "other": "Other",
}
STATUS_LABEL = {
    "open": "Waiting", "in_progress": "Being recreated", "done": "Recreated",
    "declined": "Declined", "withdrawn": "Withdrawn",
}
ACTION_LABEL = {
    "flagged": "Marked not performing", "start": "Started recreating", "done": "Marked recreated",
    "decline": "Declined", "withdraw": "Withdrawn",
}


class FlagError(Exception):
    def __init__(self, message: str, status_code: int = 422):
        super().__init__(message)
        self.message, self.status_code = message, status_code


# ── People ────────────────────────────────────────────────────────────────────

async def leader_directory(db, exclude_uid: str = "") -> list[dict]:
    """Every team with its active leaders — the "Send to" list."""
    teams = await db["teams"].find({"members.role": "leader"}, {"name": 1, "color": 1, "members": 1}).to_list(500)
    leader_ids = {m["user_id"] for t in teams for m in t.get("members", []) if m.get("role") == "leader"}
    active = set(await ar._active_users(db, list(leader_ids)))
    names = await ar.names_for(db, active)
    # Same name, different people — among the leaders or ANY account (real data
    # has three "Basil Mohammed" accounts, one of them a leader): add the email
    # so the sender knows exactly who gets it.
    by_name: dict[str, int] = {}
    if names:
        async for u in db["users"].find({"name": {"$in": list(set(names.values()))}}, {"name": 1}):
            key = (u.get("name") or "").strip().lower()
            by_name[key] = by_name.get(key, 0) + 1
    emails: dict[str, str] = {}
    dupes = [i for i, n in names.items() if by_name.get(n.strip().lower(), 0) > 1]
    if dupes:
        docs = await db["users"].find({"_id": {"$in": [ObjectId(i) for i in dupes]}}, {"email": 1}).to_list(len(dupes))
        emails = {str(d["_id"]): d.get("email", "") for d in docs}
    out = []
    for t in teams:
        leaders = [{"id": m["user_id"], "name": names.get(m["user_id"], "") or "Team leader",
                    "email": emails.get(m["user_id"], "")}
                   for m in t.get("members", [])
                   if m.get("role") == "leader" and m["user_id"] in active and m["user_id"] != exclude_uid]
        if leaders:
            out.append({"team_id": str(t["_id"]), "team_name": t.get("name", ""), "color": t.get("color") or "",
                        "leaders": sorted(leaders, key=lambda x: x["name"].lower())})
    return sorted(out, key=lambda t: t["team_name"].lower())


async def default_recipient(db, report_id: str, flagger_id: str, directory: list[dict]) -> dict | None:
    """Who this ad was last sent to, else whom this person last sent one to — if still valid."""
    valid = {(l["id"], t["team_id"]) for t in directory for l in t["leaders"]}
    for q in ({"report_id": report_id}, {"flagged_by": flagger_id}):
        last = await db[FLAGS].find_one(q, {"recipient_id": 1, "recipient_team_id": 1}, sort=[("created_at", -1)])
        if last and (last.get("recipient_id"), last.get("recipient_team_id")) in valid:
            return {"recipient_id": last["recipient_id"], "team_id": last["recipient_team_id"]}
    return None


# ── The numbers, frozen at the moment of flagging ─────────────────────────────

async def snapshot(db, report: dict, today: date | None = None) -> dict:
    """Last 7 complete days vs the 7 before (the Performance overview's own maths) + 14-day leads."""
    today = today or today_ist()
    hi = today - timedelta(days=1)
    lo = hi - timedelta(days=6)
    s = await ar.series(db, report, lo, hi, "day", today)
    spark_lo = today - timedelta(days=14)
    rows = await db[ar.ENTRIES].find(
        {"report_id": str(report["_id"]), "date": {"$gte": spark_lo.isoformat(), "$lt": today.isoformat()}},
        {"date": 1, "values.leads": 1},
    ).to_list(20)
    have = {x["date"]: x["values"].get("leads") for x in rows}
    return {
        "range": s["range"], "metrics": s["metrics"], "currency": report.get("currency", "INR"),
        "totals": s["totals"], "previous": s["previous"], "reported_days": s["reported_days"],
        "sparkline": [have.get(d.isoformat()) for d in ar.days_between(spark_lo, hi)],
    }


# ── Create ────────────────────────────────────────────────────────────────────

def clean_note(raw) -> str:
    return (raw or "").strip()[:NOTE_MAX]


async def create(db, user: dict, report: dict, recipient_id: str, recipient_team_id: str,
                 reasons: list[str], note: str) -> dict:
    if ar.is_account(report):
        raise FlagError("Flag the ad inside this account, not the account.", 409)
    reasons = [r for r in dict.fromkeys(reasons or []) if r in REASONS]
    note = clean_note(note)
    if not reasons and not note:
        raise FlagError("Pick a reason or add a note — the media team needs to know what to fix.")
    uid = str(user["_id"])
    if recipient_id == uid:
        raise FlagError("Send it to another team leader — not yourself.")
    if not (ObjectId.is_valid(recipient_team_id) and recipient_id):
        raise FlagError("Choose who should recreate the ad.")
    team = await db["teams"].find_one(
        {"_id": ObjectId(recipient_team_id),
         "members": {"$elemMatch": {"user_id": recipient_id, "role": "leader"}}},
        {"name": 1},
    )
    if not team or not await ar._active_users(db, [recipient_id]):
        raise FlagError("Choose a team leader from the list.")

    names = await ar.names_for(db, [recipient_id])
    acc_name = ""
    if report.get("account_id") and ObjectId.is_valid(report["account_id"]):
        acc = await db[ar.REPORTS].find_one({"_id": ObjectId(report["account_id"])}, {"name": 1})
        acc_name = (acc or {}).get("name", "")
    ad_team = await db["teams"].find_one({"_id": ObjectId(report["team_id"])}, {"name": 1}) \
        if report.get("team_id") and ObjectId.is_valid(report["team_id"]) else None
    now = datetime.now(timezone.utc)
    doc = {
        "report_id": str(report["_id"]), "report_name": report.get("name", ""),
        "account_name": acc_name,
        "team_id": report.get("team_id"), "team_name": (ad_team or {}).get("name", ""),
        "recipient_id": recipient_id, "recipient_name": names.get(recipient_id, ""),
        "recipient_team_id": recipient_team_id, "recipient_team_name": team.get("name", ""),
        "reasons": reasons, "note": note,
        "snapshot": await snapshot(db, report),
        "status": "open", "active": True,
        "flagged_by": uid, "flagged_by_name": user.get("name", ""),
        "history": [{"action": "flagged", "by": uid, "by_name": user.get("name", ""), "at": now, "note": note}],
        "resolution_note": "",
        "created_at": now, "updated_at": now,
    }
    try:
        res = await db[FLAGS].insert_one(doc)
    except DuplicateKeyError:
        current = await db[FLAGS].find_one({"report_id": doc["report_id"], "active": True}, {"recipient_name": 1})
        who = (current or {}).get("recipient_name") or "a team leader"
        raise FlagError(f"This ad is already with {who} — wait for their answer or withdraw it first.", 409)
    doc["_id"] = res.inserted_id

    first = doc["flagged_by_name"] or "Someone"
    why = ", ".join(REASONS[r].lower() for r in reasons) or "see the note"
    meta = {"flag_id": str(res.inserted_id), "report_id": doc["report_id"], "team_id": recipient_team_id,
            "link": f"/leader?tab=ads&flag={res.inserted_id}"}
    asyncio.create_task(ar.deliver(
        db, recipient_id, NOTIF_FLAGGED, f"Ad not performing: {doc['report_name']}",
        f"{first} asked you to recreate it — {why}.", meta))
    return doc


# ── Read ──────────────────────────────────────────────────────────────────────

async def load(db, flag_id: str) -> dict | None:
    if not ObjectId.is_valid(flag_id):
        return None
    return await db[FLAGS].find_one({"_id": ObjectId(flag_id)})


async def can_view(db, user: dict, flag: dict, report: dict | None) -> bool:
    uid = str(user["_id"])
    if ar.is_elevated(user) or uid in (flag.get("recipient_id"), flag.get("flagged_by")):
        return True
    return bool(report) and await ar.can_enter(db, user, report)


def can_act(user: dict, flag: dict) -> bool:
    return str(user["_id"]) == flag.get("recipient_id") or ar.is_elevated(user)


async def serialize(db, flag: dict, user: dict, report: dict | None = None) -> dict:
    report = report if report is not None else await db[ar.REPORTS].find_one(
        {"_id": ObjectId(flag["report_id"])}) if ObjectId.is_valid(flag.get("report_id", "")) else None
    uid = str(user["_id"])
    return {
        "id": str(flag["_id"]),
        "report_id": flag["report_id"], "report_name": flag.get("report_name", ""),
        "account_name": flag.get("account_name", ""), "team_name": flag.get("team_name", ""),
        "status": flag["status"], "status_label": STATUS_LABEL.get(flag["status"], flag["status"]),
        "active": flag["status"] in ACTIVE,
        "reasons": [{"key": r, "label": REASONS.get(r, r)} for r in flag.get("reasons", [])],
        "note": flag.get("note", ""),
        "recipient": {"id": flag["recipient_id"], "name": flag.get("recipient_name", ""),
                      "team_name": flag.get("recipient_team_name", "")},
        "flagged_by": {"id": flag["flagged_by"], "name": flag.get("flagged_by_name", "")},
        "resolution_note": flag.get("resolution_note", ""),
        "snapshot": flag.get("snapshot"),
        # The ad itself as it is now — what the media team works from.
        "creatives": ar.serialize_creatives(report) if report else [],
        "history": [{"action": h["action"], "label": ACTION_LABEL.get(h["action"], h["action"]),
                     "by_name": h.get("by_name", ""), "at": utc_iso(h.get("at")), "note": h.get("note", "")}
                    for h in flag.get("history", [])],
        "created_at": utc_iso(flag.get("created_at")), "updated_at": utc_iso(flag.get("updated_at")),
        "can_act": flag["status"] in ACTIVE and can_act(user, flag),
        "can_withdraw": flag["status"] == "open" and (uid == flag.get("flagged_by") or ar.is_elevated(user)),
        "can_open_report": bool(report) and await ar.can_enter(db, user, report),
    }


async def summaries_for(db, report_ids: list[str]) -> dict[str, dict]:
    """Per report: its active flag, else the latest one closed in the last 14 days (for the status strip)."""
    if not report_ids:
        return {}
    since = datetime.now(timezone.utc) - timedelta(days=CLOSED_VISIBLE_DAYS)
    rows = await db[FLAGS].find(
        {"report_id": {"$in": report_ids}, "$or": [{"active": True}, {"updated_at": {"$gte": since}}]},
        {"report_id": 1, "status": 1, "recipient_name": 1, "recipient_team_name": 1, "flagged_by": 1,
         "flagged_by_name": 1, "created_at": 1, "updated_at": 1, "resolution_note": 1},
    ).sort("created_at", -1).to_list(len(report_ids) * 3)
    out: dict[str, dict] = {}
    for f in rows:
        rid = f["report_id"]
        if rid in out and not (f["status"] in ACTIVE and not out[rid]["active"]):
            continue
        out[rid] = {
            "id": str(f["_id"]), "status": f["status"], "status_label": STATUS_LABEL.get(f["status"], f["status"]),
            "active": f["status"] in ACTIVE, "recipient_name": f.get("recipient_name", ""),
            "recipient_team_name": f.get("recipient_team_name", ""), "flagged_by": f.get("flagged_by"),
            "flagged_by_name": f.get("flagged_by_name", ""), "created_at": utc_iso(f.get("created_at")),
            "updated_at": utc_iso(f.get("updated_at")), "resolution_note": f.get("resolution_note", ""),
        }
    return out


# ── Act ───────────────────────────────────────────────────────────────────────

_TRANSITIONS = {             # action → (allowed from, to)
    "start": (("open",), "in_progress"),
    "done": (ACTIVE, "done"),
    "decline": (ACTIVE, "declined"),
    "withdraw": (("open",), "withdrawn"),
}


async def act(db, user: dict, flag: dict, action: str, note: str) -> dict:
    if action not in _TRANSITIONS:
        raise FlagError("Unknown action.")
    uid = str(user["_id"])
    if action == "withdraw":
        if not (uid == flag.get("flagged_by") or ar.is_elevated(user)):
            raise FlagError("Only the person who sent it can withdraw it.", 403)
    elif not can_act(user, flag):
        raise FlagError("Only the team leader it was sent to can do that.", 403)
    note = clean_note(note)
    if action == "decline" and len(note) < 3:
        raise FlagError("Say why it can't be redone — the sender will see it.")
    allowed, to = _TRANSITIONS[action]
    if flag["status"] not in allowed:
        raise FlagError(f"It's already {STATUS_LABEL.get(flag['status'], flag['status']).lower()}.", 409)
    now = datetime.now(timezone.utc)
    upd = {"$set": {"status": to, "updated_at": now, **({"resolution_note": note} if note else {})},
           "$push": {"history": {"action": action, "by": uid, "by_name": user.get("name", ""), "at": now, "note": note}}}
    if to not in ACTIVE:
        upd["$unset"] = {"active": ""}       # frees the one-active-flag-per-ad slot
    # Compare-and-set: two leaders clicking at once can't both win.
    res = await db[FLAGS].update_one({"_id": flag["_id"], "status": flag["status"]}, upd)
    if not res.modified_count:
        raise FlagError("Someone just updated this — refresh and try again.", 409)
    flag = await db[FLAGS].find_one({"_id": flag["_id"]})

    who = user.get("name", "") or "The team leader"
    name = flag.get("report_name", "the ad")
    if action == "withdraw":
        people = [flag["recipient_id"]]
        title, msg = f"Withdrawn: {name}", f"{who} withdrew the request to recreate this ad."
        link, team = "/leader?tab=ads", flag.get("recipient_team_id")
    else:
        report = await db[ar.REPORTS].find_one({"_id": ObjectId(flag["report_id"])}, {"assignees": 1}) \
            if ObjectId.is_valid(flag["report_id"]) else None
        people = [flag["flagged_by"], *((report or {}).get("assignees", []))]
        title = {"start": f"Being recreated: {name}", "done": f"Recreated: {name}",
                 "decline": f"Declined: {name}"}[action]
        msg = {"start": f"{who} started recreating this ad.",
               "done": f"{who} marked this ad as recreated." + (f" “{note}”" if note else ""),
               "decline": f"{who} can't recreate it: “{note}”"}[action]
        link, team = f"/ad-reports?report={flag['report_id']}", flag.get("team_id")
    meta = {"flag_id": str(flag["_id"]), "report_id": flag["report_id"], "team_id": team, "link": link}
    for p in await ar._active_users(db, [p for p in people if p != uid]):
        asyncio.create_task(ar.deliver(db, p, NOTIF_FLAGGED if action == "withdraw" else NOTIF_UPDATE,
                                       title, msg, meta))
    return flag


async def ensure_indexes(db) -> None:
    # One active flag per ad: `active` exists only while open / in progress.
    await db[FLAGS].create_index([("report_id", 1)], unique=True, name="one_active_flag_per_ad",
                                 partialFilterExpression={"active": True})
    await db[FLAGS].create_index([("recipient_id", 1), ("created_at", -1)])
    await db[FLAGS].create_index([("flagged_by", 1), ("created_at", -1)])
    await db[FLAGS].create_index([("report_id", 1), ("created_at", -1)])
