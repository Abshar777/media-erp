"""
Ad Reports — ads skip Sundays (2026-10-16).

An ad that skips Sundays (the default; older ads without the field too) never
owes a Sunday: not "missing", not reminded, not a red gap on the chart. Sunday
numbers can still be typed and count in every total. Switching it off owes
Sundays only from that day on. On Monday a missing Saturday is "due", not late.

Calendar (2026): Sat 10, Sun 11, Mon 12, Tue 13, Wed 14 Oct (the default
"today"), Sat 17, Sun 18, Mon 19.
"""
import random
from datetime import date, timedelta

import pytest

from app.services import ad_report_service as ar
from tests.test_ad_reports import B, WED, at, bells, make_account, put, world  # noqa: F401

SAT, SUN, MON, TUE = date(2026, 10, 10), date(2026, 10, 11), date(2026, 10, 12), date(2026, 10, 13)
SAT2, SUN2, MON2 = date(2026, 10, 17), date(2026, 10, 18), date(2026, 10, 19)


async def make(w, who="lead", **kw):
    body = {"name": "Delta Admissions – Oct", "team_id": w["t1"], "assignees": [w["s"]["asha"]],
            "start_date": SAT.isoformat(), **kw}
    return await w["call"]("POST", B, who, json=body)


async def new_ad(w, **kw):
    r = await make(w, **kw)
    assert r.status_code == 201, r.text
    return r.json()["data"]["id"]


async def get(w, rid, who="lead"):
    return (await w["call"]("GET", f"{B}/{rid}", who)).json()["data"]


async def patch(w, rid, who="lead", **body):
    return await w["call"]("PATCH", f"{B}/{rid}", who, json=body)


def days(lo: date, hi: date):
    return [lo + timedelta(days=i) for i in range((hi - lo).days + 1)]


# ── Pure rules ───────────────────────────────────────────────────────────────

def test_who_skips():
    assert ar.skips_sundays({"start_date": "2026-10-10"}), "older ads (no field) skip"
    assert ar.skips_sundays({"skip_sundays": True})
    assert not ar.skips_sundays({"skip_sundays": False})
    assert not ar.skips_sundays({"kind": "account"}), "an account has no days of its own"


@pytest.mark.parametrize("start", days(date(2026, 10, 5), date(2026, 10, 11)))
def test_never_owes_a_sunday_and_misses_no_other_day(start):
    r = {"start_date": start.isoformat(), "end_date": None, "pauses": []}
    until = start + timedelta(days=120)
    got = ar.expected_days(r, until)
    assert all(d.weekday() != 6 for d in got)
    assert got == [d for d in days(start, until) if d.weekday() != 6], "every Monday–Saturday is still owed"
    keep = ar.expected_days({**r, "skip_sundays": False}, until)
    assert keep == days(start, until), "switched off: every day, as before"


def test_sundays_owed_only_from_the_switch_day():
    r = {"start_date": "2026-10-01", "end_date": None, "pauses": [], "skip_sundays": False,
         "sundays_owed_from": "2026-10-15"}
    owed = {d.isoformat() for d in ar.expected_days(r, date(2026, 10, 26))}
    assert "2026-10-04" not in owed and "2026-10-11" not in owed, "Sundays before the switch stay free"
    assert "2026-10-18" in owed and "2026-10-25" in owed
    assert "2026-10-10" in owed and "2026-10-12" in owed


def test_pauses_and_end_date_still_apply():
    r = {"start_date": "2026-10-10", "end_date": "2026-10-13", "pauses": [{"from": "2026-10-12", "to": "2026-10-12"}]}
    assert [d.day for d in ar.expected_days(r, date(2026, 10, 30))] == [10, 13]


def test_monday_chip_saturday_is_due_not_late():
    r = {"start_date": "2026-10-01", "status": "active", "reminder_escalate": "17:00"}
    assert ar.day_status(r, [SAT2.isoformat()], at(MON2, 10)) == "due", "Saturday's numbers are Monday's job"
    assert ar.day_status(r, [SAT2.isoformat()], at(MON2, 17)) == "missing", "late after the leaders' time"
    assert ar.day_status(r, [SAT2.isoformat()], at(date(2026, 10, 20), 10)) == "missing", "Tuesday: late"
    assert ar.day_status(r, ["2026-10-16", SAT2.isoformat()], at(MON2, 10)) == "missing", "Friday too: late"
    assert ar.day_status(r, [date(2026, 10, 16).isoformat()], at(SAT2, 10)) == "due", "weekdays as before"
    off = {**r, "skip_sundays": False}
    assert ar.day_status(off, [SAT2.isoformat()], at(MON2, 10)) == "missing", "Sundays owed: unchanged"
    assert ar.day_status(off, [SUN2.isoformat()], at(MON2, 10)) == "due", "Sundays owed: unchanged"


# ── New and existing ads ─────────────────────────────────────────────────────

async def test_new_ads_skip_sundays_by_default(world):
    w = world
    rid = await new_ad(w)
    one = await get(w, rid)
    assert one["skip_sundays"] is True
    assert one["missing"] == ["2026-10-10", "2026-10-12", "2026-10-13"], "Sunday 11 isn't owed"
    keep = await new_ad(w, name="Sunday ad", skip_sundays=False)
    assert (await get(w, keep))["missing"] == ["2026-10-10", "2026-10-11", "2026-10-12", "2026-10-13"]


async def test_existing_ads_skip_too(world):
    w = world
    rid = await new_ad(w, skip_sundays=False)
    from bson import ObjectId
    await w["db"][ar.REPORTS].update_one({"_id": ObjectId(rid)}, {"$unset": {"skip_sundays": ""}})   # made before this
    one = await get(w, rid)
    assert one["skip_sundays"] is True and "2026-10-11" not in one["missing"]


async def test_bad_values_are_refused(world):
    w = world
    for bad in ["yes", 1, None]:
        r = await make(w, skip_sundays=bad)
        assert r.status_code == 422, (bad, r.status_code)
    rid = await new_ad(w)
    for bad in ["no", 0]:
        assert (await patch(w, rid, skip_sundays=bad)).status_code == 422


# ── Sunday numbers stay optional and count ───────────────────────────────────

async def test_sunday_numbers_can_still_be_typed_and_count(world):
    w = world
    rid = await new_ad(w)
    for d, leads in ((SAT, 4), (SUN, 3), (MON, 5)):
        r = await put(w, rid, d.isoformat(), leads=leads, spend="100")
        assert r.status_code in (200, 201), r.text
    d = (await w["call"]("GET", f"{B}/{rid}/series?from=2026-10-10&to=2026-10-13", "lead")).json()["data"]
    assert d["totals"]["leads"] == 12, "Sunday's leads are in the total"
    pts = {p["key"]: p for p in d["points"]}
    assert pts["2026-10-11"]["values"]["leads"] == 3 and pts["2026-10-11"]["rest"] == []
    assert pts["2026-10-13"]["missing"] == ["2026-10-13"]


async def test_chart_marks_a_skipped_sunday_as_rest_not_missing(world):
    w = world
    rid = await new_ad(w)
    keep = await new_ad(w, name="Sunday ad", skip_sundays=False)
    s1 = (await w["call"]("GET", f"{B}/{rid}/series?from=2026-10-10&to=2026-10-13", "lead")).json()["data"]
    p = {x["key"]: x for x in s1["points"]}["2026-10-11"]
    assert p["missing"] == [] and p["rest"] == ["2026-10-11"] and p["values"] is None
    s2 = (await w["call"]("GET", f"{B}/{keep}/series?from=2026-10-10&to=2026-10-13", "lead")).json()["data"]
    p = {x["key"]: x for x in s2["points"]}["2026-10-11"]
    assert p["missing"] == ["2026-10-11"] and p["rest"] == []
    wk = (await w["call"]("GET", f"{B}/{rid}/series?from=2026-10-05&to=2026-10-18&granularity=week", "lead")).json()["data"]
    assert wk["points"][0]["rest"] == ["2026-10-11"] and "2026-10-11" not in wk["points"][0]["missing"]
    before = (await w["call"]("GET", f"{B}/{rid}/series?from=2026-10-01&to=2026-10-09", "lead")).json()["data"]
    assert all(x["rest"] == [] for x in before["points"]), "no Sunday marks before the ad started"


# ── Reminders ────────────────────────────────────────────────────────────────

async def test_reminders_never_ask_for_a_sunday(world):
    w, db = world, world["db"]
    await new_ad(w)
    assert await ar.run_reminders(db, at(WED, 12, 1), frozenset()) == 1
    _, rows = await bells(w, ar.NOTIF_DUE)
    assert "10 Oct, 12 Oct, 13 Oct" in rows[0]["message"] and "11 Oct" not in rows[0]["message"]


async def test_monday_asks_only_for_saturday_and_nothing_when_its_in(world):
    w, db = world, world["db"]
    rid = await new_ad(w, start_date="2026-10-12")
    w["clock"].today = MON2
    for d in days(MON, date(2026, 10, 16)):
        await put(w, rid, d.isoformat())
    assert (await get(w, rid))["missing"] == ["2026-10-17"]
    assert await ar.run_reminders(db, at(MON2, 12, 1), frozenset()) == 1
    _, rows = await bells(w, ar.NOTIF_DUE)
    assert rows[0]["message"].endswith("17 Oct.")
    await put(w, rid, "2026-10-17")
    assert (await get(w, rid))["missing"] == [] and (await get(w, rid))["day_status"] == "updated"
    assert await ar.run_reminders(db, at(MON2, 17, 1), frozenset()) == 0, "Sunday is never chased"


async def test_leader_remind_now_ignores_sundays(world):
    w = world
    rid = await new_ad(w, start_date="2026-10-12")
    w["clock"].today = MON2
    for d in days(MON, date(2026, 10, 17)):
        await put(w, rid, d.isoformat())
    r = await w["call"]("POST", f"{B}/{rid}/remind", "lead")
    assert r.status_code == 409, "only Sunday is empty — nothing to chase"


# ── Switching ────────────────────────────────────────────────────────────────

async def test_switch_off_owes_sundays_from_that_day_only(world):
    w = world
    rid = await new_ad(w)
    w["clock"].today = date(2026, 10, 15)                                # Thursday
    r = await patch(w, rid, skip_sundays=False)
    assert r.status_code == 200 and r.json()["data"]["skip_sundays"] is False
    w["clock"].today = MON2
    miss = (await get(w, rid))["missing"]
    assert "2026-10-11" not in miss, "no backlog of old Sundays"
    assert "2026-10-18" in miss, "Sundays owed from the switch on"
    assert (await patch(w, rid, skip_sundays=True)).status_code == 200
    assert "2026-10-18" not in (await get(w, rid))["missing"], "back on: Sundays free again"


async def test_switch_off_on_a_sunday_owes_that_sunday(world):
    w = world
    rid = await new_ad(w)
    w["clock"].today = SUN2
    await patch(w, rid, skip_sundays=False)
    w["clock"].today = MON2
    assert "2026-10-18" in (await get(w, rid))["missing"]


async def test_switch_off_on_monday_never_owes_yesterday(world):
    w = world
    rid = await new_ad(w)
    w["clock"].today = MON2
    await patch(w, rid, skip_sundays=False)
    assert "2026-10-18" not in (await get(w, rid))["missing"]
    w["clock"].today = date(2026, 10, 26)
    assert "2026-10-25" in (await get(w, rid))["missing"]


async def test_sending_off_again_keeps_owed_sundays(world):
    # Found by a planted bug (2026-10-16): "off" sent to an ad that is already
    # off must not move the start of owed Sundays and quietly drop old ones.
    w = world
    rid = await new_ad(w, skip_sundays=False)
    w["clock"].today = MON2
    r = await patch(w, rid, skip_sundays=False, name="Renamed")
    assert r.status_code == 200
    assert {"2026-10-11", "2026-10-18"} <= set(r.json()["data"]["missing"]), "still owed"
    from bson import ObjectId
    assert "sundays_owed_from" not in await w["db"][ar.REPORTS].find_one({"_id": ObjectId(rid)})


async def test_switch_rules(world):
    w, s = world, world["s"]
    rid = await new_ad(w)
    assert (await patch(w, rid, "asha", skip_sundays=False)).status_code == 403, "the assignee doesn't run it"
    assert (await patch(w, rid, "out", skip_sundays=False)).status_code == 404
    assert (await patch(w, rid, "lead2", skip_sundays=False)).status_code == 404
    assert (await patch(w, rid, skip_sundays=True)).status_code == 200, "no change is fine"
    acc = (await make_account(w)).json()["data"]["id"]
    assert (await patch(w, acc, skip_sundays=False)).status_code == 422, "accounts have no days"
    assert (await patch(w, rid, action="end")).status_code == 200
    assert (await patch(w, rid, skip_sundays=False)).status_code == 409, "ended"
    own = await new_ad(w, who="asha", name="Mine", assignees=[s["asha"]])        # self-made: she runs it
    assert (await patch(w, own, "asha", skip_sundays=False)).status_code == 200


# ── Accounts, auto-end, the Today banner ─────────────────────────────────────

async def test_account_day_is_complete_without_a_skipped_sunday(world):
    w, s = world, world["s"]
    acc = (await make_account(w)).json()["data"]["id"]
    a = await new_ad(w, name="Lead form", account_id=acc)
    b = await new_ad(w, name="Sunday ad", account_id=acc, assignees=[s["mira"]], skip_sundays=False)
    d = (await w["call"]("GET", f"{B}/{acc}/series?from=2026-10-10&to=2026-10-11", "lead")).json()["data"]
    assert {p["key"]: p for p in d["points"]}["2026-10-11"]["missing"] == ["2026-10-11"], "the Sunday ad owes it"
    await put(w, b, "2026-10-11", who="mira")
    d = (await w["call"]("GET", f"{B}/{acc}/series?from=2026-10-10&to=2026-10-11", "lead")).json()["data"]
    sun = {p["key"]: p for p in d["points"]}["2026-10-11"]
    assert sun["missing"] == [], "the Mon–Sat ad doesn't hold the day up"
    for rid, who in ((a, "asha"), (b, "mira")):
        for x in ("2026-10-10", "2026-10-12", "2026-10-13"):
            await put(w, rid, x, who=who)
    assert (await get(w, acc))["day_status"] == "updated"


async def test_ends_itself_without_waiting_for_a_sunday(world):
    w = world
    rid = await new_ad(w, end_date="2026-10-11")
    r = await put(w, rid, "2026-10-10")
    assert r.json()["data"]["report_status"] == "ended", "the last owed day was Saturday"


async def test_today_banner_counts_a_saturday_ad_as_up_to_date_on_monday(world):
    w = world
    rid = await new_ad(w, start_date="2026-10-12")
    w["clock"].today = MON2
    for d in days(MON, SAT2):
        await put(w, rid, d.isoformat())
    lead = (await w["call"]("GET", f"{B}/today", "lead")).json()["data"]
    assert lead["team"]["updated"] == lead["team"]["active"] == 1 and lead["team"]["missing"] == []
    mine = (await w["call"]("GET", f"{B}/today", "asha")).json()["data"]
    assert mine["my_due_count"] == 0


# ── Random: entries, switching and days passing vs a plain model ────────────

@pytest.mark.parametrize("seed", range(12))
async def test_random_days_match_a_model(world, seed):
    rnd = random.Random(seed)
    w, db = world, world["db"]
    start = date(2026, 10, 5) + timedelta(days=rnd.randint(0, 6))
    skip = rnd.random() < 0.7
    rid = await new_ad(w, start_date=start.isoformat(), skip_sundays=skip)
    w["clock"].today = start + timedelta(days=1)
    owed_from = None                 # model: Sundays owed only when off, from the day it was switched off
    entered: set[str] = set()
    for _ in range(30):
        today = w["clock"].today
        op = rnd.choices(["day", "enter", "toggle"], [4, 4, 1])[0]
        if op == "day":
            w["clock"].today = today + timedelta(days=1)
        elif op == "enter":
            d = today - timedelta(days=rnd.randint(1, 6))
            if d >= start:
                assert (await put(w, rid, d.isoformat(), who="lead")).status_code in (200, 201)
                entered.add(d.isoformat())
        else:
            new = not skip
            assert (await patch(w, rid, skip_sundays=new)).status_code == 200
            skip, owed_from = new, (None if new else today)
        today = w["clock"].today

        def owes(d):
            if d.weekday() != 6:
                return True
            return not skip and (owed_from is None or d >= owed_from)
        want = [d.isoformat() for d in days(start, today - timedelta(days=1)) if owes(d) and d.isoformat() not in entered]
        got = (await get(w, rid))["missing"]
        assert got == want, (seed, today, skip, owed_from, got, want)
        if today.weekday() != 6 and want:
            await db[ar.REMINDERS].delete_many({})
            await db["notifications"].delete_many({})
            assert await ar.run_reminders(db, at(today, 12, 1), frozenset()) == 1
            assert (await bells(w, ar.NOTIF_DUE))[1][0]["metadata"]["missing"] == want
