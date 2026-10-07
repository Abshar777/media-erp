"""
Ad Reports — daily Meta numbers entered by the team, with escalating reminders.

Pure-rule tests, plus integration tests that drive the real endpoints and the
real reminder scheduler against a throwaway MongoDB database (created and
dropped here; the developer's database is never touched). The IST clock is
frozen so days and reminder times can be walked deliberately. Skips without Mongo.
"""
import asyncio
import secrets
from datetime import date, datetime, timedelta

import pytest
from bson import ObjectId
from httpx import ASGITransport, AsyncClient
from motor.motor_asyncio import AsyncIOMotorClient

from app.config import settings
from app.database import get_db
from app.main import app
from app.middleware.auth import get_current_user
from app.routers import ad_reports as ar_router
from app.services import ad_report_service as ar
from app.utils.timezone import IST

WED = date(2026, 10, 14)          # "today" for most tests (a Wednesday)
START = "2026-10-10"              # a Saturday: owed days are 10, 11, 12, 13 Oct


def at(d: date, hh: int, mm: int = 0) -> datetime:
    return datetime(d.year, d.month, d.day, hh, mm, tzinfo=IST)


# ════════════════════════════════════════════════════════════════════════════
# Pure rules
# ════════════════════════════════════════════════════════════════════════════

def test_money_is_exact_paise():
    assert ar.to_paise("2,732.52") == 273252
    assert ar.to_paise(2732.52) == 273252
    assert ar.to_paise("16200.3") == 1620030
    assert ar.to_paise(0) == 0
    for bad in ("12.345", "-1", "abc", "", None, "1e20"):
        with pytest.raises(ar.AdReportError):
            ar.to_paise(bad)


def test_cost_per_lead_is_total_over_total():
    # Day 1: ₹100 / 1 lead (₹100). Day 2: ₹900 / 9 leads (₹100). Day 3: ₹300 / 1 (₹300).
    # Average of daily CPLs would be ₹166.67; the right answer is ₹1300 / 11 = ₹118.18.
    t = {"spend": 10000 + 90000 + 30000, "leads": 11}
    assert round(ar.computed(t)["cpl"] / 100, 2) == 118.18
    assert ar.computed({"spend": 500, "leads": 0})["cpl"] is None


def test_expected_days_respect_start_end_and_pauses():
    r = {"start_date": START, "end_date": None, "pauses": []}
    assert [d.isoformat() for d in ar.expected_days(r, WED - timedelta(days=1))] == \
        ["2026-10-10", "2026-10-11", "2026-10-12", "2026-10-13"]
    r["end_date"] = "2026-10-11"
    assert len(ar.expected_days(r, WED)) == 2
    r = {"start_date": START, "end_date": None, "pauses": [{"from": "2026-10-11", "to": "2026-10-12"}]}
    assert [d.day for d in ar.expected_days(r, WED - timedelta(days=1))] == [10, 13]
    r["pauses"] = [{"from": "2026-10-12", "to": None}]          # still paused
    assert [d.day for d in ar.expected_days(r, WED - timedelta(days=1))] == [10, 11]


def test_day_status_chip():
    r = {"start_date": START, "status": "active", "reminder_escalate": "17:00"}
    assert ar.day_status(r, [], at(WED, 9)) == "updated"
    assert ar.day_status(r, ["2026-10-13"], at(WED, 16, 59)) == "due"
    assert ar.day_status(r, ["2026-10-13"], at(WED, 17)) == "missing"
    assert ar.day_status(r, ["2026-10-12", "2026-10-13"], at(WED, 9)) == "missing"
    assert ar.day_status({**r, "status": "paused"}, ["x"], at(WED, 9)) == "paused"
    assert ar.day_status({**r, "start_date": WED.isoformat()}, [], at(WED, 9)) == "not_started"


# ════════════════════════════════════════════════════════════════════════════
# Integration — real endpoints + scheduler, throwaway database
# ════════════════════════════════════════════════════════════════════════════

class Clock:
    def __init__(self, d: date):
        self.today = d

    def __call__(self):
        return self.today


@pytest.fixture
async def world(monkeypatch):
    client = AsyncIOMotorClient(settings.mongodb_url, serverSelectionTimeoutMS=3000)
    try:
        await client.admin.command("ping")
    except Exception:
        client.close()
        pytest.skip("MongoDB not reachable — integration tests skipped")
    name = f"mediaerp_test_adrep_{secrets.token_hex(4)}"
    db = client[name]

    import app.database as dbmod
    monkeypatch.setattr(dbmod, "_client", client)
    monkeypatch.setitem(settings.__dict__, "mongodb_db_name", name)

    clock = Clock(WED)
    monkeypatch.setattr(ar, "today_ist", clock)
    monkeypatch.setattr(ar_router, "today_ist", clock)

    roles = {r: {"_id": ObjectId(), "role_name": r} for r in ("Team Leader", "Employee", "Super Admin")}
    await db["roles"].insert_many(list(roles.values()))
    people = {"lead": "Team Leader", "lead2": "Team Leader", "asha": "Employee",
              "mira": "Employee", "out": "Employee", "sa": "Super Admin"}
    U = {k: ObjectId() for k in people}
    await db["users"].insert_many([{"_id": U[k], "name": k.title(), "email": f"{k}@t.io",
                                    "is_active": True, "role_id": str(roles[r]["_id"])}
                                   for k, r in people.items()])
    s = {k: str(v) for k, v in U.items()}
    T1 = {"_id": ObjectId(), "name": "Media", "members": [
        {"user_id": s["lead"], "role": "leader"}, {"user_id": s["asha"], "role": "member"},
        {"user_id": s["mira"], "role": "member"}]}
    T2 = {"_id": ObjectId(), "name": "Other", "members": [{"user_id": s["lead2"], "role": "leader"}]}
    await db["teams"].insert_many([T1, T2])
    await ar.ensure_indexes(db)

    def as_user(k):
        async def _u():
            return {"_id": U[k], "name": k.title(), "email": f"{k}@t.io",
                    "role_id": str(roles[people[k]]["_id"]), "_role": roles[people[k]]}
        return _u

    app.dependency_overrides[get_db] = lambda: db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as ac:
        async def call(method, path, who, **kw):
            app.dependency_overrides[get_current_user] = as_user(who)
            return await ac.request(method, path, **kw)

        yield {"db": db, "s": s, "t1": str(T1["_id"]), "t2": str(T2["_id"]), "clock": clock, "call": call}
    app.dependency_overrides.clear()
    await client.drop_database(name)
    client.close()


B = "/api/v1/ad-reports"


async def make(w, who="lead", **kw):
    body = {"name": "Delta Admissions – Oct", "team_id": w["t1"], "assignees": [w["s"]["asha"]],
            "start_date": START, **kw}
    return await w["call"]("POST", B, who, json=body)


async def rid_of(w, **kw):
    r = await make(w, **kw)
    assert r.status_code == 201, r.text
    return r.json()["data"]["id"]


async def put(w, rid, day, who="asha", **vals):
    body = {"leads": 10, "spend": "1000.00", **vals}
    return await w["call"]("PUT", f"{B}/{rid}/entries/{day}", who, json=body)


async def bells(w, kind=None):
    q = {"type": {"$in": [ar.NOTIF_DUE, ar.NOTIF_OVERDUE]}}
    if kind:
        q["type"] = kind
    rows = await w["db"]["notifications"].find(q).to_list(100)
    return sorted(str(r["user_id"]) for r in rows), rows


# ── Creating ─────────────────────────────────────────────────────────────────

async def test_who_can_create(world):
    w = world
    assert (await make(w, "lead")).status_code == 201
    assert (await make(w, "sa")).status_code == 201
    assert (await make(w, "asha")).status_code == 403, "an employee can't create one"
    assert (await make(w, "lead2")).status_code == 403, "another team's leader can't either"


async def test_create_validation(world):
    w, s = world, world["s"]
    for kw, code in [
        ({"assignees": []}, 422),
        ({"assignees": [s["asha"], s["mira"], s["lead"]]}, 422),
        ({"assignees": ["nope"]}, 422),
        ({"end_date": "2026-10-01"}, 422),
        ({"start_date": "10/10/2026"}, 422),
        ({"reminder_due": "25:00"}, 422),
        ({"reminder_due": "17:00", "reminder_escalate": "12:00"}, 422),
        ({"name": "   "}, 422),
        ({"team_id": "x"}, 422),
    ]:
        r = await make(w, **kw)
        assert r.status_code == code, (kw, r.text)
    r = await make(w, assignees=[s["asha"], s["asha"], s["mira"]], extra_metrics=["clicks", "clicks"])
    d = r.json()["data"]
    assert [a["id"] for a in d["assignees"]] == [s["asha"], s["mira"]]
    assert d["metrics"] == ["leads", "spend", "clicks"]


# ── Entering numbers ─────────────────────────────────────────────────────────

async def test_entering_and_correcting_a_day(world):
    w = world
    rid = await rid_of(w)
    r = await put(w, rid, "2026-10-13", leads=14, spend="2,732.52")
    assert r.status_code == 201
    assert r.json()["data"]["entry"]["values"] == {"leads": 14, "spend": 273252}
    assert r.json()["data"]["missing"] == ["2026-10-10", "2026-10-11", "2026-10-12"]

    same = await put(w, rid, "2026-10-13", leads=14, spend="2732.52")
    assert same.status_code == 200 and same.json()["data"]["entry"]["edits"] == [], "no-op save isn't an edit"
    fix = await put(w, rid, "2026-10-13", leads=15, spend="2732.52")
    edits = fix.json()["data"]["entry"]["edits"]
    assert len(edits) == 1 and edits[0]["old"]["leads"] == 14 and edits[0]["new"]["leads"] == 15
    assert await w["db"]["ad_report_entries"].count_documents({"report_id": rid}) == 1


async def test_entry_rules(world):
    w = world
    rid = await rid_of(w, end_date="2026-10-20")
    assert (await put(w, rid, "2026-10-09")).status_code == 422, "before the start"
    assert (await put(w, rid, "2026-10-15")).status_code == 422, "future"
    assert (await put(w, rid, "2026-10-13", spend="1.234")).status_code == 422
    assert (await put(w, rid, "2026-10-13", leads=-1)).status_code == 422
    assert (await put(w, rid, "2026-10-13", leads=None)).status_code == 422
    assert (await put(w, rid, "13-10-2026")).status_code == 422
    off = await put(w, rid, "2026-10-12", leads=None, spend=None, campaign_off=True)
    assert off.status_code == 201 and off.json()["data"]["entry"]["values"] == {"leads": 0, "spend": 0}
    assert (await put(w, rid, "2026-10-14")).status_code == 201, "today may be entered early"


async def test_seven_day_correction_window(world):
    w = world
    rid = await rid_of(w, start_date="2026-09-20")
    assert (await put(w, rid, "2026-09-25")).status_code == 201, "a missed old day can still be filled"
    deny = await put(w, rid, "2026-09-25", leads=11)
    assert deny.status_code == 403 and "team leader" in deny.json()["message"]
    assert (await put(w, rid, "2026-09-25", who="lead", leads=11)).status_code == 200
    assert (await put(w, rid, "2026-10-08")).status_code == 201
    assert (await put(w, rid, "2026-10-08", leads=12)).status_code == 200, "inside 7 days"


async def test_strangers_get_not_found(world):
    w = world
    rid = await rid_of(w)
    for who in ("lead2", "out", "mira"):
        for method, path, kw in [("GET", f"{B}/{rid}", {}), ("GET", f"{B}/{rid}/series", {}),
                                 ("GET", f"{B}/{rid}/entries", {}),
                                 ("PUT", f"{B}/{rid}/entries/2026-10-13", {"json": {"leads": 1, "spend": 1}}),
                                 ("PATCH", f"{B}/{rid}", {"json": {"action": "pause"}}),
                                 ("POST", f"{B}/{rid}/remind", {})]:
            r = await w["call"](method, path, who, **kw)
            assert r.status_code == 404 and r.json()["message"] == "Ad report not found.", (who, method, path)
    assert (await w["call"]("GET", f"{B}/{rid}", "sa")).status_code == 200
    assert (await w["call"]("GET", f"{B}/{rid}", "asha")).json()["data"]["can_manage"] is False
    lst = await w["call"]("GET", B, "lead2")
    assert lst.json()["data"] == []


async def test_only_leaders_manage(world):
    w = world
    rid = await rid_of(w)
    assert (await w["call"]("PATCH", f"{B}/{rid}", "asha", json={"action": "pause"})).status_code == 403
    assert (await w["call"]("POST", f"{B}/{rid}/remind", "asha")).status_code == 403
    assert (await w["call"]("PATCH", f"{B}/{rid}", "lead", json={"name": "Renamed"})).json()["data"]["name"] == "Renamed"


# ── Maths ────────────────────────────────────────────────────────────────────

async def test_series_totals_gaps_and_weeks(world):
    w = world
    rid = await rid_of(w, start_date="2026-10-01")
    await put(w, rid, "2026-10-05", leads=2, spend="400")       # Mon
    await put(w, rid, "2026-10-06", leads=8, spend="1200")      # Tue
    await put(w, rid, "2026-10-12", leads=1, spend="300")       # next Mon
    r = await w["call"]("GET", f"{B}/{rid}/series?from=2026-10-05&to=2026-10-13", "lead")
    d = r.json()["data"]
    assert d["totals"]["leads"] == 11 and d["totals"]["spend"] == 190000
    assert round(d["totals"]["cpl"]) == round(190000 / 11)
    days = {p["key"]: p for p in d["points"]}
    assert days["2026-10-07"]["values"] is None and days["2026-10-07"]["missing"] == ["2026-10-07"], \
        "a missed day is a gap, not zero"
    assert days["2026-10-05"]["values"]["cpl"] == 20000

    wk = (await w["call"]("GET", f"{B}/{rid}/series?from=2026-10-05&to=2026-10-18&granularity=week", "lead")).json()["data"]
    assert [p["key"] for p in wk["points"]] == ["2026-10-05", "2026-10-12"]
    assert wk["points"][0]["values"]["leads"] == 10 and wk["points"][0]["values"]["cpl"] == 16000
    assert wk["points"][0]["reported_days"] == 2

    prev = (await w["call"]("GET", f"{B}/{rid}/series?from=2026-10-12&to=2026-10-13", "lead")).json()["data"]
    assert prev["previous"] is None, "nothing entered 10–11 Oct"
    bad = await w["call"]("GET", f"{B}/{rid}/series?granularity=year", "lead")
    assert bad.status_code == 422


# ── Reminders ────────────────────────────────────────────────────────────────

async def test_reminder_ladder(world):
    w, s, db = world, world["s"], world["db"]
    await rid_of(w)
    assert await ar.run_reminders(db, at(WED, 11, 59), frozenset()) == 0, "nothing before 12:00"
    assert await ar.run_reminders(db, at(WED, 12, 1), frozenset()) == 1
    who, rows = await bells(w, ar.NOTIF_DUE)
    assert who == [s["asha"]], "stage 1 goes to the assigned person only"
    assert "10 Oct, 11 Oct, 12 Oct, 13 Oct" in rows[0]["message"], "one reminder lists every missing day"
    assert rows[0]["metadata"]["link"].endswith("&entry=1")
    assert await ar.run_reminders(db, at(WED, 15), frozenset()) == 0, "never twice"
    assert await ar.run_reminders(db, at(WED, 17, 2), frozenset()) == 1
    who, rows = await bells(w, ar.NOTIF_OVERDUE)
    assert who == sorted([s["asha"], s["lead"]]), "stage 2 adds the team leader"
    assert "(Asha)" in rows[0]["message"]
    assert await ar.run_reminders(db, at(WED, 20), frozenset()) == 0


async def test_no_reminder_when_done_paused_or_on_days_off(world):
    w, db = world, world["db"]
    rid = await rid_of(w)
    sunday = date(2026, 10, 18)
    assert await ar.run_reminders(db, at(sunday, 18), frozenset()) == 0, "Sunday"
    assert await ar.run_reminders(db, at(WED, 18), frozenset({WED})) == 0, "holiday"
    await w["call"]("PATCH", f"{B}/{rid}", "lead", json={"action": "pause"})
    assert await ar.run_reminders(db, at(WED, 18), frozenset()) == 0, "paused"
    await w["call"]("PATCH", f"{B}/{rid}", "lead", json={"action": "resume"})
    for d in ("2026-10-10", "2026-10-11", "2026-10-12", "2026-10-13"):
        await put(w, rid, d)
    assert await ar.run_reminders(db, at(WED, 18), frozenset()) == 0, "nothing missing"
    assert (await bells(w))[0] == []


async def test_late_start_sends_only_the_leader_stage(world):
    w, s, db = world, world["s"], world["db"]
    await rid_of(w)
    assert await ar.run_reminders(db, at(WED, 18), frozenset()) == 1
    assert (await bells(w, ar.NOTIF_DUE))[0] == [], "stage 1 isn't sent on top of stage 2"
    assert (await bells(w, ar.NOTIF_OVERDUE))[0] == sorted([s["asha"], s["lead"]])
    assert await db["ad_report_reminders"].count_documents({}) == 2, "stage 1 is marked done"


async def test_two_workers_never_double_remind(world):
    w, db = world, world["db"]
    for i in range(3):
        await rid_of(w, name=f"R{i}")
    sent = await asyncio.gather(*[ar.run_reminders(db, at(WED, 12, 5), frozenset()) for _ in range(4)])
    assert sum(sent) == 3, sent
    assert len((await bells(w, ar.NOTIF_DUE))[1]) == 3


async def test_pause_skips_the_paused_days(world):
    w, db = world, world["db"]
    rid = await rid_of(w)
    w["clock"].today = date(2026, 10, 12)
    await w["call"]("PATCH", f"{B}/{rid}", "lead", json={"action": "pause"})       # from 12 Oct
    w["clock"].today = WED
    await w["call"]("PATCH", f"{B}/{rid}", "lead", json={"action": "resume"})      # to 13 Oct
    r = await db["ad_reports"].find_one({"_id": ObjectId(rid)})
    assert await ar.missing_days(db, r, WED) == ["2026-10-10", "2026-10-11"]
    assert r["pauses"] == [{"from": "2026-10-12", "to": "2026-10-13"}]


async def test_ends_itself_when_the_last_day_is_in(world):
    w = world
    rid = await rid_of(w, end_date="2026-10-11")
    await put(w, rid, "2026-10-10")
    r = await put(w, rid, "2026-10-11")
    assert r.json()["data"]["report_status"] == "ended"
    late = await put(w, rid, "2026-10-11", leads=3)
    assert late.status_code == 409, "an ended report is read-only for the assignee"
    assert (await put(w, rid, "2026-10-11", who="lead", leads=3)).status_code == 200


async def test_remind_now_is_rate_limited(world):
    w, s = world, world["s"]
    rid = await rid_of(w)
    r = await w["call"]("POST", f"{B}/{rid}/remind", "lead")
    assert r.status_code == 200 and r.json()["data"]["notified"] == 1
    assert (await w["call"]("POST", f"{B}/{rid}/remind", "lead")).status_code == 429
    await asyncio.sleep(0.2)
    assert (await bells(w, ar.NOTIF_DUE))[0] == [s["asha"]]


async def test_today_summary(world):
    w, s = world, world["s"]
    a = await rid_of(w, name="A")
    b = await rid_of(w, name="B", assignees=[s["mira"]])
    for d in ("2026-10-10", "2026-10-11", "2026-10-12", "2026-10-13"):
        await put(w, b, d, who="mira")
    mine = (await w["call"]("GET", f"{B}/today", "asha")).json()["data"]
    assert mine["visible"] and not mine["can_create"] and mine["my_due_count"] == 1
    assert mine["my_due"][0]["id"] == a and mine["team"] is None
    lead = (await w["call"]("GET", f"{B}/today", "lead")).json()["data"]
    assert lead["team"]["active"] == 2 and lead["team"]["updated"] == 1
    assert lead["team"]["missing"][0]["owners"] == ["Asha"]
    out = (await w["call"]("GET", f"{B}/today", "out")).json()["data"]
    assert out["visible"] is False, "people with no reports don't get the sidebar item"


async def test_change_vs_previous_only_when_fully_covered(world):
    w = world
    rid = await rid_of(w, start_date="2026-10-01")
    for d in ("2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"):
        await put(w, rid, d)
    ok = (await w["call"]("GET", f"{B}/{rid}/series?from=2026-10-03&to=2026-10-04", "lead")).json()["data"]
    assert ok["previous"]["leads"] == 20, "1–2 Oct is inside the report's life"
    partial = (await w["call"]("GET", f"{B}/{rid}/series?from=2026-10-02&to=2026-10-04", "lead")).json()["data"]
    assert partial["previous"] is None, "29 Sep – 1 Oct starts before the report did"


def test_notification_email_escapes_user_text():
    # Report names, task titles and people's names reach this template.
    from app.services.notification_service import _notif_email_html
    h = _notif_email_html('Add numbers: <a href="https://evil.example">Verify</a>', "Q&A <img src=x onerror=alert(1)>")
    assert "<a href" not in h and "<img" not in h
    assert "&lt;a href=" in h and "Q&amp;A" in h
