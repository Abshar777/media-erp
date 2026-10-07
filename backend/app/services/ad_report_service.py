"""
Ad Reports — the Meta Ads Manager "Performance overview", filled in by hand.

The media team reads each campaign's numbers off Ads Manager every day. Here
the assigned person records them (one row per report per IST day), the team
leader watches the KPI tiles and chart, and a scheduler chases missing days.

Rules worth knowing
-------------------
* **An entry records one full IST day.** Ads Manager's "today" is partial until
  midnight, so people enter *yesterday's* final numbers each morning. A day is
  "expected" from the start date up to yesterday (and never past the end date),
  minus any days the report was paused. Sundays are expected too — ads run on
  Sundays — but nobody is *reminded* on a Sunday or holiday; the next working
  day asks for every missing day at once.
* **Money is integer paise.** ₹16,200.32 is stored as 1620032, so sums never
  drift. Cost per lead (and CTR/CPM/CPC) is always computed — never typed — and
  for a week or month it is total ÷ total, not an average of daily averages.
* **A missing day is not zero.** It is absent, and the chart shows a gap.
  "Campaign didn't run" is an explicit zero the person ticks.
* **Reminders are claimed, then sent.** `ad_report_reminders` has a unique index
  on (report_id, on_date, stage). Every worker tries the insert; only the one
  that succeeds delivers. Two gunicorn workers, a restart, or a slow tick can
  never send a reminder twice. (Do not copy the read-then-write pattern in the
  group daily report — it races.)
* **Delivery from the scheduler thread uses only the thread's own database
  handle.** push_notification's WebSocket push belongs to the main event loop,
  so the scheduler writes the bell row itself and sends web push / email with
  helpers that take `db` explicitly. The bell's 60 s poll shows it.
"""
from __future__ import annotations

import asyncio
import logging
import re
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal, InvalidOperation

from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorDatabase
from pymongo.errors import DuplicateKeyError

from app.utils.timezone import IST, today_ist, utc_iso

logger = logging.getLogger(__name__)

REPORTS, ENTRIES, REMINDERS = "ad_reports", "ad_report_entries", "ad_report_reminders"

ELEVATED_ROLES = ("Super Admin", "Admin", "Coordinator")
BASE_METRICS = ("leads", "spend")
EXTRA_METRICS = ("impressions", "reach", "clicks")
MAX_ASSIGNEES = 2                 # owner + one backup
OWNER_EDIT_DAYS = 7               # the assigned person may correct the last 7 days
MAX_COUNT = 10_000_000_000        # sanity ceiling for counts
MAX_SPEND_PAISE = 10_000_000_000  # ₹10 crore a day
MAX_RANGE_DAYS = 731
MANUAL_REMIND_GAP = timedelta(hours=1)
POLL_SECONDS = 60
NOTIF_DUE, NOTIF_OVERDUE = "ad_report_due", "ad_report_overdue"
CREATIVE_FOLDER = "ad-creatives"
MAX_CREATIVES = 12
CREATIVE_TYPES = ("image/", "video/", "application/pdf")
# SVG is XML that can carry script; ads don't use it, so it isn't accepted.
BLOCKED_CREATIVE_TYPES = ("image/svg+xml",)
_HHMM = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


class AdReportError(Exception):
    def __init__(self, message: str, status_code: int = 422):
        super().__init__(message)
        self.message, self.status_code = message, status_code


# ── Small helpers ─────────────────────────────────────────────────────────────

def parse_day(raw, field: str = "date") -> date:
    s = str(raw or "")
    if len(s) == 10:
        try:
            return date.fromisoformat(s)
        except ValueError:
            pass
    _bad(field)


def _bad(field: str):
    raise AdReportError(f"{field.replace('_', ' ').capitalize()} must be a date like 2026-10-07.")


def days_between(a: date, b: date):
    d = a
    while d <= b:
        yield d
        d += timedelta(days=1)


def is_elevated(user: dict) -> bool:
    return ((user.get("_role") or {}).get("role_name", "")) in ELEVATED_ROLES


def to_paise(raw) -> int:
    """'2,732.52' / 2732.52 / '2732.5' → 273252. Refuses more than 2 decimals."""
    if raw is None or raw == "":
        raise AdReportError("Amount spent is required.")
    try:
        d = Decimal(str(raw).replace(",", "").strip())
    except InvalidOperation:
        raise AdReportError("Amount spent must be a number.")
    if not d.is_finite() or d < 0:
        raise AdReportError("Amount spent can't be negative.")
    paise = d * 100
    if paise != paise.to_integral_value():
        raise AdReportError("Amount spent can have at most 2 decimals.")
    if paise > MAX_SPEND_PAISE:
        raise AdReportError("Amount spent looks too large — please check it.")
    return int(paise)


def computed(t: dict) -> dict:
    """Derived metrics from (possibly summed) raw values. None when undefined."""
    def div(a, b, k=1):
        return round(a * k / b, 4) if a is not None and b else None
    return {
        "cpl": div(t.get("spend"), t.get("leads")),               # paise per lead
        "ctr": div(t.get("clicks"), t.get("impressions"), 100),   # percent
        "cpm": div(t.get("spend"), t.get("impressions"), 1000),   # paise per 1,000
        "cpc": div(t.get("spend"), t.get("clicks")),              # paise per click
    }


def metrics_of(report: dict) -> list[str]:
    return list(BASE_METRICS) + [m for m in report.get("extra_metrics", []) if m in EXTRA_METRICS]


def is_account(report: dict) -> bool:
    """An ad account: its numbers are the sum of the ads inside it. Missing `kind` = an ad."""
    return report.get("kind") == "account"


AD_ONLY = {"kind": {"$ne": "account"}}


async def children_of(db, account: dict) -> list[dict]:
    """The ads inside an account (accounts never nest)."""
    return await db[REPORTS].find({"account_id": str(account["_id"]), **AD_ONLY}).sort("created_at", 1).to_list(500)


def union_metrics(children: list[dict]) -> list[str]:
    extras = {m for c in children for m in c.get("extra_metrics", []) if m in EXTRA_METRICS}
    return list(BASE_METRICS) + [m for m in EXTRA_METRICS if m in extras]


# ── Which days are owed ───────────────────────────────────────────────────────

def _paused_on(report: dict, d: date) -> bool:
    for p in report.get("pauses", []):
        lo = date.fromisoformat(p["from"])
        hi = date.fromisoformat(p["to"]) if p.get("to") else None
        if d >= lo and (hi is None or d <= hi):
            return True
    return False


def expected_days(report: dict, until: date) -> list[date]:
    """Days that should have numbers, from the start up to `until` (inclusive)."""
    if is_account(report):
        return []                      # nothing is typed for an account
    start = date.fromisoformat(report["start_date"])
    end = date.fromisoformat(report["end_date"]) if report.get("end_date") else None
    last = min(until, end) if end else until
    if last < start:
        return []
    return [d for d in days_between(start, last) if not _paused_on(report, d)]


async def entered_dates(db, report_id: str, lo: date, hi: date) -> set[str]:
    rows = await db[ENTRIES].find(
        {"report_id": report_id, "date": {"$gte": lo.isoformat(), "$lte": hi.isoformat()}},
        {"date": 1},
    ).to_list(5000)
    return {r["date"] for r in rows}


async def missing_days(db, report: dict, today: date | None = None) -> list[str]:
    """Owed days (up to yesterday) with no numbers yet, oldest first."""
    today = today or today_ist()
    owed = expected_days(report, today - timedelta(days=1))
    if not owed:
        return []
    have = await entered_dates(db, str(report["_id"]), owed[0], owed[-1])
    return [d.isoformat() for d in owed if d.isoformat() not in have]


def _hhmm(s: str) -> time:
    h, m = s.split(":")
    return time(int(h), int(m))


def now_on(today: date) -> datetime:
    """The current IST time of day on `today` — keeps the status chip on the same day as the rest."""
    return datetime.combine(today, datetime.now(IST).time(), tzinfo=IST)


def day_status(report: dict, missing: list[str], now: datetime | None = None) -> str:
    """The chip on the report card: updated | due | missing | paused | ended | not_started."""
    now = (now or datetime.now(timezone.utc)).astimezone(IST)
    if report.get("status") == "ended":
        return "ended"
    if report.get("status") == "paused":
        return "paused"
    if date.fromisoformat(report["start_date"]) >= now.date():
        return "not_started"
    if not missing:
        return "updated"
    yesterday = (now.date() - timedelta(days=1)).isoformat()
    if missing == [yesterday] and now.time() < _hhmm(report.get("reminder_escalate", "17:00")):
        return "due"
    return "missing"


# ── Permissions ───────────────────────────────────────────────────────────────

async def leads_team(db, user_id: str, team_id) -> bool:
    if not team_id or not ObjectId.is_valid(team_id):
        return False
    return bool(await db["teams"].find_one(
        {"_id": ObjectId(team_id), "members": {"$elemMatch": {"user_id": user_id, "role": "leader"}}},
        {"_id": 1},
    ))


async def can_manage(db, user: dict, report: dict) -> bool:
    """Create-time rule, applied to the report's team: its leaders and the admin roles."""
    return is_elevated(user) or await leads_team(db, str(user["_id"]), report.get("team_id"))


async def can_enter(db, user: dict, report: dict) -> bool:
    return str(user["_id"]) in report.get("assignees", []) or await can_manage(db, user, report)


async def team_leader_ids(db, team_id) -> list[str]:
    if not team_id or not ObjectId.is_valid(team_id):
        return []
    team = await db["teams"].find_one({"_id": ObjectId(team_id)}, {"members": 1})
    return [m["user_id"] for m in (team or {}).get("members", []) if m.get("role") == "leader"]


async def visible_query(db, user: dict) -> dict:
    """Reports this user may see: theirs, their teams' (as leader), or all (admins)."""
    if is_elevated(user):
        return {}
    uid = str(user["_id"])
    led = await db["teams"].find(
        {"members": {"$elemMatch": {"user_id": uid, "role": "leader"}}}, {"_id": 1}
    ).to_list(500)
    return {"$or": [{"assignees": uid}, {"team_id": {"$in": [str(t["_id"]) for t in led]}}]}


# ── Validation ────────────────────────────────────────────────────────────────

async def validate_assignees(db, raw) -> tuple[list[str], dict[str, str]]:
    ids: list[str] = []
    for a in raw or []:
        a = str(a).strip()
        if a and a not in ids:
            ids.append(a)
    if not ids:
        raise AdReportError("Choose who will update this report.")
    if len(ids) > MAX_ASSIGNEES:
        raise AdReportError("Choose one person, plus an optional backup.")
    if not all(ObjectId.is_valid(a) for a in ids):
        raise AdReportError("That person no longer exists.")
    users = await db["users"].find(
        {"_id": {"$in": [ObjectId(a) for a in ids]}}, {"name": 1, "is_active": 1}
    ).to_list(len(ids))
    found = {str(u["_id"]): u for u in users}
    for a in ids:
        if a not in found:
            raise AdReportError("That person no longer exists.")
        if found[a].get("is_active") is False:
            raise AdReportError(f"{found[a].get('name', 'That person')} is deactivated.")
    return ids, {a: found[a].get("name", "") for a in ids}


def validate_times(due: str, escalate: str) -> None:
    for t in (due, escalate):
        if not _HHMM.match(t or ""):
            raise AdReportError("Reminder times must look like 12:00.")
    if _hhmm(escalate) <= _hhmm(due):
        raise AdReportError("The leader's reminder must come after the first reminder.")


def validate_entry(report: dict, body: dict) -> dict:
    """Return the values to store (spend in paise). campaign_off records zeros."""
    want = metrics_of(report)
    if body.get("campaign_off"):
        return {m: 0 for m in want}
    out: dict = {}
    for m in want:
        if m == "spend":
            out[m] = to_paise(body.get("spend"))
            continue
        v = body.get(m)
        label = {"leads": "Leads", "impressions": "Impressions", "reach": "Reach", "clicks": "Link clicks"}[m]
        if v is None or isinstance(v, bool):
            raise AdReportError(f"{label} is required.")
        if v < 0:
            raise AdReportError(f"{label} can't be negative.")
        if v > MAX_COUNT:
            raise AdReportError(f"{label} looks too large — please check it.")
        out[m] = int(v)
    if "impressions" in out:
        if out.get("reach", 0) > out["impressions"]:
            raise AdReportError("Reach can't be more than impressions — check the two numbers.")
        if out.get("clicks", 0) > out["impressions"]:
            raise AdReportError("Link clicks can't be more than impressions — check the two numbers.")
    return out


# ── Creatives (the ad itself, shown above the numbers) ───────────────────────

def creative_prefix() -> str:
    from app.config import settings
    root = (settings.r2_root_prefix or "").strip("/")
    return f"{root}/{CREATIVE_FOLDER}/" if root else f"{CREATIVE_FOLDER}/"


def validate_creative(att: dict) -> dict:
    """
    Accept only a file this app uploaded into its own ad-creatives folder.

    The bucket is shared with the Delta LMS and the read path signs whatever key
    is stored, so an arbitrary key would hand out a signed link to someone
    else's object. The upload must also really exist (no phantom references).
    """
    from app.utils import storage
    key = str(att.get("key") or "").strip()
    name = str(att.get("filename") or "").strip()[:200] or "creative"
    if not key.startswith(creative_prefix()) or ".." in key:
        raise AdReportError("That file wasn't uploaded here — please upload it again.")
    # Type and size come from STORAGE, not the request: the browser chose the
    # Content-Type when it asked for the upload URL, so an HTML page could be
    # uploaded as text/html and then claimed here as image/png.
    meta = storage.object_meta(key)
    if not meta:
        raise AdReportError("The upload didn't finish — please try again.")
    ctype = meta["content_type"]
    if not ctype.startswith(CREATIVE_TYPES) or ctype in BLOCKED_CREATIVE_TYPES:
        raise AdReportError("Upload an image (JPG, PNG, GIF or WebP), a video or a PDF.")
    return {"key": key, "url": key, "filename": name, "content_type": ctype,
            "size": meta["size"], "backend": "r2"}


def serialize_creatives(r: dict) -> list[dict]:
    from app.utils.storage import sign_attachment
    out = []
    for c in r.get("creatives", []):
        s = sign_attachment(c)
        out.append({
            "id": c["id"], "url": s.get("url", ""), "key": c.get("key", ""),
            "filename": c.get("filename", ""), "content_type": c.get("content_type", ""),
            "size": c.get("size", 0), "uploaded_by": c.get("uploaded_by"),
            "uploaded_by_name": c.get("uploaded_by_name", ""), "uploaded_at": utc_iso(c.get("uploaded_at")),
        })
    return out


# ── Series (KPI tiles + chart) ────────────────────────────────────────────────

def _bucket(d: date, granularity: str) -> tuple[str, date, date]:
    if granularity == "week":                        # Monday-start weeks
        lo = d - timedelta(days=d.weekday())
        return lo.isoformat(), lo, lo + timedelta(days=6)
    if granularity == "month":
        lo = d.replace(day=1)
        nxt = (lo.replace(day=28) + timedelta(days=4)).replace(day=1)
        return lo.isoformat()[:7], lo, nxt - timedelta(days=1)
    return d.isoformat(), d, d


def _pair(rows: list[dict], a: str, b: str) -> tuple[int | None, int | None]:
    """Sums of `a` and `b` over only the days that recorded BOTH."""
    both = [r["values"] for r in rows if a in r["values"] and b in r["values"]]
    return (sum(v[a] for v in both), sum(v[b] for v in both)) if both else (None, None)


def _sum(rows: list[dict], metrics: list[str]) -> dict:
    """
    Totals plus ratios. A ratio uses only days that recorded both of its parts:
    when Impressions is switched on mid-campaign, weeks of spend with no
    impressions must not be divided by a few days of impressions (that is how
    CPM came out at ₹3,16,942 and CTR above 100%).
    """
    t = {m: (sum(r["values"].get(m, 0) for r in rows) if rows else None) for m in metrics}
    def ratio(a: str, b: str, k: float = 1):
        num, den = _pair(rows, a, b)
        return round(num * k / den, 4) if num is not None and den else None
    return {**t, "cpl": ratio("spend", "leads"), "ctr": ratio("clicks", "impressions", 100),
            "cpm": ratio("spend", "impressions", 1000), "cpc": ratio("spend", "clicks")}


async def series(db, report: dict, lo: date, hi: date, granularity: str, today: date | None = None,
                 children: list[dict] | None = None) -> dict:
    """
    KPI totals and chart points for one ad — or, with `children`, for an
    account: the ads' rows added up day by day. A day is "missing" when any ad
    owed numbers for it and has none (for an account, an incomplete day).
    """
    today = today or today_ist()
    if hi < lo:
        raise AdReportError("The end of the range is before its start.")
    if (hi - lo).days > MAX_RANGE_DAYS:
        raise AdReportError("Choose a range of up to two years.")
    members = children if children is not None else [report]
    rids = [str(m["_id"]) for m in members]
    metrics = union_metrics(members) if children is not None else metrics_of(report)
    start = min((m["start_date"] for m in members), default=report.get("start_date") or lo.isoformat())

    async def rows_between(a: date, b: date) -> list[dict]:
        if not rids:
            return []
        return await db[ENTRIES].find(
            {"report_id": {"$in": rids}, "date": {"$gte": a.isoformat(), "$lte": b.isoformat()}}
        ).sort("date", 1).to_list(20000)

    rows = await rows_between(lo, hi)
    span = (hi - lo).days + 1
    prev_lo = lo - timedelta(days=span)
    # Compare only against a previous period the report fully covered — a
    # period that began before the start date would show "+319%" off two days.
    prev_rows = (await rows_between(prev_lo, lo - timedelta(days=1))
                 if prev_lo.isoformat() >= start else [])
    by_day: dict[str, list[dict]] = {}
    for r in rows:
        by_day.setdefault(r["date"], []).append(r)
    yesterday = today - timedelta(days=1)
    owed: dict[str, set[str]] = {}
    for m in members:
        for d in expected_days(m, yesterday):
            owed.setdefault(d.isoformat(), set()).add(str(m["_id"]))

    points: dict[str, dict] = {}
    for d in days_between(lo, hi):
        key, b_lo, b_hi = _bucket(d, granularity)
        p = points.setdefault(key, {"key": key, "from": max(b_lo, lo).isoformat(),
                                    "to": min(b_hi, hi).isoformat(), "_rows": [], "_days": set(),
                                    "missing": [], "edited": [], "off": []})
        iso = d.isoformat()
        day_rows = by_day.get(iso, [])
        if day_rows:
            p["_rows"].extend(day_rows)
            p["_days"].add(iso)
            if any(r.get("edits") for r in day_rows):
                p["edited"].append(iso)
            if any(r.get("campaign_off") for r in day_rows):
                p["off"].append(iso)
        if owed.get(iso, set()) - {r["report_id"] for r in day_rows}:
            p["missing"].append(iso)
    out_points = []
    for p in points.values():
        reported = p.pop("_rows")
        days = p.pop("_days")
        out_points.append({**p, "reported_days": len(days),
                           "values": _sum(reported, metrics) if reported else None})

    out = {
        "range": {"from": lo.isoformat(), "to": hi.isoformat()},
        "granularity": granularity,
        "metrics": metrics,
        "totals": _sum(rows, metrics),
        "previous": _sum(prev_rows, metrics) if prev_rows else None,
        "reported_days": len({r["date"] for r in rows}),
        "points": out_points,
    }
    if children is not None:
        out["breakdown"] = await _breakdown(db, members, rows, today)
    return out


async def _breakdown(db, children: list[dict], rows: list[dict], today: date) -> list[dict]:
    """One line per ad in an account, for the same range as the totals."""
    names = await names_for(db, [a for c in children for a in c.get("assignees", [])])
    by_ad: dict[str, list[dict]] = {}
    for r in rows:
        by_ad.setdefault(r["report_id"], []).append(r)
    out = []
    for c in children:
        cid = str(c["_id"])
        missing = await missing_days(db, c, today)
        cover = serialize_creatives(c)[:1]
        out.append({
            "id": cid, "name": c.get("name", ""), "status": c.get("status", "active"),
            "day_status": day_status(c, missing, now_on(today)), "missing": missing,
            "owners": [names.get(a, "") for a in c.get("assignees", [])],
            "totals": _sum(by_ad.get(cid, []), metrics_of(c)),
            "cover": cover[0] if cover else None,
        })
    return out


# ── Serialisation ─────────────────────────────────────────────────────────────

async def names_for(db, ids) -> dict[str, str]:
    ids = {i for i in ids if i and ObjectId.is_valid(i)}
    if not ids:
        return {}
    users = await db["users"].find({"_id": {"$in": [ObjectId(i) for i in ids]}}, {"name": 1}).to_list(len(ids))
    return {str(u["_id"]): u.get("name", "") for u in users}


def serialize_entry(e: dict, names: dict[str, str] | None = None) -> dict:
    names = names or {}
    return {
        "date": e["date"],
        "values": e.get("values", {}),
        "campaign_off": e.get("campaign_off", False),
        "note": e.get("note", ""),
        "entered_by": e.get("entered_by"),
        "entered_by_name": names.get(e.get("entered_by"), e.get("entered_by_name", "")),
        "entered_at": utc_iso(e.get("entered_at")),
        "updated_at": utc_iso(e.get("updated_at")),
        "edits": [{**x, "at": utc_iso(x.get("at"))} for x in e.get("edits", [])],
    }


async def serialize_report(db, r: dict, names: dict[str, str], team_names: dict[str, str],
                           user: dict | None = None, today: date | None = None,
                           account_names: dict[str, str] | None = None) -> dict:
    today = today or today_ist()
    missing = await missing_days(db, r, today)
    acct = None
    if is_account(r):
        kids = await children_of(db, r)
        statuses = [day_status(k, await missing_days(db, k, today), now_on(today)) for k in kids]
        rollup = ("ended" if r.get("status") == "ended" else
                  "missing" if "missing" in statuses else "due" if "due" in statuses else
                  "updated" if "updated" in statuses else "not_started")
        acct = {"ads": len(kids), "active_ads": sum(1 for k in kids if k.get("status") == "active"),
                "missing_ads": statuses.count("missing"), "rollup_status": rollup,
                "metrics": union_metrics(kids),
                "start": min((k["start_date"] for k in kids), default=r.get("start_date"))}
    spark_lo = today - timedelta(days=14)
    spark_rows = await db[ENTRIES].find(
        {"report_id": str(r["_id"]), "date": {"$gte": spark_lo.isoformat(), "$lt": today.isoformat()}},
        {"date": 1, "values.leads": 1},
    ).to_list(20)
    have = {x["date"]: x["values"].get("leads") for x in spark_rows}
    out = {
        "id": str(r["_id"]),
        "name": r.get("name", ""),
        "platform": r.get("platform", "meta"),
        "team_id": r.get("team_id"),
        "team_name": team_names.get(r.get("team_id"), ""),
        "assignees": [{"id": a, "name": names.get(a, "")} for a in r.get("assignees", [])],
        "start_date": (acct["start"] if acct else r.get("start_date")),
        "end_date": r.get("end_date"),
        "metrics": acct["metrics"] if acct else metrics_of(r),
        "extra_metrics": r.get("extra_metrics", []),
        "kind": "account" if acct else "ad",
        "account_id": r.get("account_id"),
        "account_name": (account_names or {}).get(r.get("account_id") or "", ""),
        "ad_account_ref": r.get("ad_account_ref") or "",
        "account": acct,
        "currency": r.get("currency", "INR"),
        "reminder_due": r.get("reminder_due", "12:00"),
        "reminder_escalate": r.get("reminder_escalate", "17:00"),
        "status": r.get("status", "active"),
        "day_status": acct["rollup_status"] if acct else day_status(r, missing, now_on(today)),
        "creatives": serialize_creatives(r),       # first one is the cover
        "missing": missing,
        "sparkline": [have.get(d.isoformat()) for d in days_between(spark_lo, today - timedelta(days=1))],
        "created_by": r.get("created_by"),
        "created_by_name": r.get("created_by_name", ""),
        "created_at": utc_iso(r.get("created_at")),
        "updated_at": utc_iso(r.get("updated_at")),
    }
    if user is not None:
        out["can_manage"] = await can_manage(db, user, r)
        out["can_enter"] = out["can_manage"] or str(user["_id"]) in r.get("assignees", [])
    return out


# ── Delivery (safe from any event loop: everything goes through `db`) ─────────

def _fmt_day(iso: str) -> str:
    d = date.fromisoformat(iso)
    return f"{d.day} {d.strftime('%b')}"


def missing_phrase(missing: list[str]) -> str:
    shown = ", ".join(_fmt_day(d) for d in missing[:4])
    return shown + (f" and {len(missing) - 4} more" if len(missing) > 4 else "")


async def deliver(db, user_id: str, notif_type: str, title: str, message: str, metadata: dict) -> None:
    """Bell row + web push + opted-in email, using only the given database handle."""
    from app.models.notification import notification_doc
    from app.services import notification_service, web_push_service
    try:
        doc = notification_doc(user_id, notif_type, title, message, metadata)
        res = await db["notifications"].insert_one(doc)
    except Exception as exc:
        logger.error("Ad report reminder for %s not stored: %s", user_id, exc)
        return
    try:
        await web_push_service.send_to_user(db, user_id, {
            "id": str(res.inserted_id), "type": notif_type, "title": title,
            "message": message, "metadata": metadata,
        })
    except Exception:
        pass
    await notification_service._send_email_if_opted_in(db, user_id, notif_type, title, message, metadata)


async def _active_users(db, ids) -> list[str]:
    ids = [i for i in dict.fromkeys(ids) if i and ObjectId.is_valid(i)]
    if not ids:
        return []
    users = await db["users"].find(
        {"_id": {"$in": [ObjectId(i) for i in ids]}, "is_active": {"$ne": False}}, {"_id": 1}
    ).to_list(len(ids))
    ok = {str(u["_id"]) for u in users}
    return [i for i in ids if i in ok]


async def send_stage(db, report: dict, stage: int, missing: list[str]) -> int:
    """Notify for one stage. Returns how many people were notified."""
    rid, name = str(report["_id"]), report.get("name", "Ad report")
    names = await names_for(db, report.get("assignees", []))
    owners = " & ".join(n for n in (names.get(a) for a in report.get("assignees", [])) if n) or "the assignee"
    when = missing_phrase(missing)
    meta = {"report_id": rid, "team_id": report.get("team_id"), "missing": missing,
            "link": f"/ad-reports?report={rid}&entry=1", "stage": stage}
    if stage == 1:
        people = await _active_users(db, report.get("assignees", []))
        title = f"Add numbers: {name}"
        msg = f"Please add the Meta numbers for {when}."
        kind = NOTIF_DUE
    else:
        assignees = await _active_users(db, report.get("assignees", []))
        leaders = await _active_users(db, await team_leader_ids(db, report.get("team_id")))
        people = list(dict.fromkeys(assignees + leaders))
        title = f"Still missing: {name}"
        msg = f"No numbers yet for {when} ({owners})."
        kind = NOTIF_OVERDUE
    for uid in people:
        await deliver(db, uid, kind, title, msg, meta)
    return len(people)


# ── Reminder scheduler ────────────────────────────────────────────────────────

async def claim(db, report_id: str, on_date: date, stage: int, now: datetime) -> bool:
    """Exactly-once gate. True only for the single caller whose insert lands."""
    try:
        await db[REMINDERS].insert_one({"report_id": report_id, "on_date": on_date.isoformat(),
                                        "stage": stage, "created_at": now})
        return True
    except DuplicateKeyError:
        return False


async def run_reminders(db, now: datetime | None = None, holidays: frozenset[date] | None = None) -> int:
    """One tick: send every stage that has come due today. Returns stages sent."""
    from app.services.worktime import is_working_day, load_holidays
    now = (now or datetime.now(timezone.utc)).astimezone(IST)
    today = now.date()
    if holidays is None:
        holidays = await load_holidays(db)
    await auto_end(db, today)
    if not is_working_day(today, holidays):
        return 0
    sent = 0
    for r in await db[REPORTS].find({"status": "active", **AD_ONLY}).to_list(2000):
        try:
            stages = [s for s, t in ((1, r.get("reminder_due", "12:00")),
                                     (2, r.get("reminder_escalate", "17:00"))) if now.time() >= _hhmm(t)]
            if not stages:
                continue
            missing = await missing_days(db, r, today)
            if not missing:
                continue
            # Both stages due at once (the server was down at 12:00): send only
            # the later one, and mark the earlier as done so it never follows.
            top = max(stages)
            for stage in stages:
                if await claim(db, str(r["_id"]), today, stage, now) and stage == top:
                    await send_stage(db, r, stage, missing)
                    sent += 1
        except Exception as exc:                          # one bad report never blocks the rest
            logger.error("Ad report %s reminder failed: %s", r.get("_id"), exc)
    return sent


async def auto_end(db, today: date) -> int:
    """Reports past their end date with every day filled in become 'ended'."""
    n = 0
    for r in await db[REPORTS].find(
        {"status": "active", "end_date": {"$ne": None, "$lt": today.isoformat()}, **AD_ONLY}
    ).to_list(1000):
        if not await missing_days(db, r, today):
            res = await db[REPORTS].update_one(
                {"_id": r["_id"], "status": "active"},
                {"$set": {"status": "ended", "ended_at": datetime.now(timezone.utc),
                          "updated_at": datetime.now(timezone.utc)}},
            )
            n += res.modified_count
    return n


async def ensure_indexes(db: AsyncIOMotorDatabase) -> None:
    await db[REPORTS].create_index([("status", 1)])
    await db[REPORTS].create_index([("assignees", 1)])
    await db[REPORTS].create_index([("team_id", 1)])
    await db[REPORTS].create_index([("account_id", 1)])
    await db[ENTRIES].create_index([("report_id", 1), ("date", 1)], unique=True, name="unique_ad_report_day")
    await db[REMINDERS].create_index([("report_id", 1), ("on_date", 1), ("stage", 1)],
                                     unique=True, name="unique_ad_report_reminder")
    # The ledger only needs to outlive the day it guards.
    await db[REMINDERS].create_index("created_at", expireAfterSeconds=60 * 60 * 24 * 40)


def start_ad_report_scheduler() -> None:
    """Entry point from main.py lifespan — runs forever in a daemon thread."""
    async def _run():
        from motor.motor_asyncio import AsyncIOMotorClient
        from app.config import settings
        client = AsyncIOMotorClient(settings.mongodb_url)
        db = client[settings.mongodb_db_name]
        await ensure_indexes(db)
        while True:
            try:
                sent = await run_reminders(db)
                if sent:
                    logger.info("Ad report scheduler sent %d reminder stage(s)", sent)
            except Exception as exc:
                logger.error("Ad report scheduler tick failed: %s", exc)
            await asyncio.sleep(POLL_SECONDS)

    try:
        asyncio.new_event_loop().run_until_complete(_run())
    except Exception as exc:
        logger.error("Ad report scheduler thread crashed: %s", exc)
