"""
Daily repeating tasks skip Sundays (2026-10-15).

New daily series skip Sundays by default (Mon–Sat; a leader can switch it off
for a team that works Sundays). Daily series that already existed are moved onto
it from their NEXT copy by a one-off, idempotent migration — copies already
created (Sundays included) never change.

Pure date engine, then integration on a throwaway database (fixture from
test_recurrence; its clock starts on Friday 9 Oct 2026, so Sunday is the 11th).
"""
import asyncio
from datetime import date, datetime, timedelta, timezone

import pytest
from bson import ObjectId

from app.services import recurrence as rec
from app.services.recurrence import MON_TO_SAT, first_date, first_index_on_or_after, occurrence_date, week_offsets
from tests.test_recurrence import body, copies, world  # noqa: F401

FRI = date(2026, 10, 9)
SUN = date(2026, 10, 11)
MON = date(2026, 10, 12)


def dates_of(cs):
    return sorted({c["recurrence"]["date"] for c in cs})


# ── Date engine ──────────────────────────────────────────────────────────────

@pytest.mark.parametrize("anchor", [FRI + timedelta(days=k) for k in range(7) if (FRI + timedelta(days=k)).weekday() != 6])
def test_mon_to_sat_never_lands_on_sunday_and_misses_no_working_day(anchor):
    off = week_offsets(anchor, MON_TO_SAT)
    got = [occurrence_date("daily", anchor, i, None, off) for i in range(400)]
    assert all(d.weekday() != 6 for d in got)
    assert got == sorted(set(got)), "strictly increasing, no repeats"
    # Exactly the working days from the anchor on — none skipped.
    want, d = [], anchor
    while len(want) < 400:
        if d.weekday() != 6:
            want.append(d)
        d += timedelta(days=1)
    assert got == want


def test_first_day_moves_off_a_sunday_only_when_skipping():
    assert first_date("daily", SUN, skip_sundays=True) == MON
    assert first_date("daily", SUN) == SUN
    assert first_date("daily", FRI, skip_sundays=True) == FRI
    assert first_date("weekly", SUN, weekday=6, skip_sundays=True) == SUN, "weekly ignores it"


def test_resume_index_lands_on_the_next_working_day():
    off = week_offsets(FRI, MON_TO_SAT)
    i = first_index_on_or_after("daily", FRI, 0, SUN, None, off)
    assert occurrence_date("daily", FRI, i, None, off) == MON
    i = first_index_on_or_after("daily", FRI, 5, SUN, None, off)
    assert i == 5, "never moves back"
    assert first_index_on_or_after("daily", FRI, 0, SUN) == 2, "plain daily unchanged"


def test_validation():
    v = rec.validate_repeat
    assert v("daily", 5, 0, skip_sundays=True) == ""
    assert v("daily", 5, 0, skip_sundays=False) == ""
    assert v("weekly", 5, 0, skip_sundays=True) != ""
    assert v("monthly", 5, 0, skip_sundays=False) == ""


# ── New series ───────────────────────────────────────────────────────────────

async def post(w, who="lead", **repeat):
    return await w["call"]("POST", "/api/v1/projects/batch", who,
                           json=body(w, assignees=repeat.pop("assignees", [w["s"]["asha"]]),
                                     repeat={"frequency": "daily", "count": 5, "due_offset_days": 0, **repeat}))


async def walk(w, until: date):
    while w["clock"].today < until:
        w["clock"].today += timedelta(days=1)
        await rec.run_due(w["db"])


async def test_new_daily_series_skips_sundays_by_default(world):
    w = world
    r = await post(w)                                        # no skip_sundays sent → the default
    assert r.status_code == 201, r.text
    ser = r.json()["data"]["series"]
    assert ser["skip_sundays"] is True and ser["started_on"] == "2026-10-09"
    await walk(w, date(2026, 10, 20))
    cs = await copies(w, ser["id"])
    assert dates_of(cs) == ["2026-10-09", "2026-10-10", "2026-10-12", "2026-10-13", "2026-10-14"]
    assert [c["recurrence"]["index"] for c in sorted(cs, key=lambda c: c["recurrence"]["date"])] == [1, 2, 3, 4, 5]
    assert all(c["recurrence"].get("skip_sundays") is True for c in cs)
    s = await w["db"]["recurring_tasks"].find_one({"_id": ObjectId(ser["id"])})
    assert s["status"] == "completed" and s["occurrences_done"] == 5


async def test_leader_can_keep_sundays(world):
    w = world
    r = await post(w, skip_sundays=False)
    sid = r.json()["data"]["series"]["id"]
    assert r.json()["data"]["series"]["skip_sundays"] is False
    await walk(w, date(2026, 10, 20))
    assert "2026-10-11" in dates_of(await copies(w, sid))


async def test_set_up_on_a_sunday_starts_monday(world):
    w = world
    w["clock"].today = SUN
    r = await post(w)
    assert r.status_code == 201 and r.json()["data"]["tasks"] == []
    assert "Mon 12 Oct" in r.json()["message"]
    sid = r.json()["data"]["series"]["id"]
    assert await copies(w, sid) == [], "nothing on Sunday"
    await walk(w, MON)
    assert dates_of(await copies(w, sid)) == ["2026-10-12"]


async def test_until_stopped_three_weeks_has_no_sundays(world):
    w = world
    sid = (await post(w, count=None)).json()["data"]["series"]["id"]
    await walk(w, date(2026, 10, 29))            # Fri 9 → Thu 29 = 21 days, 3 Sundays
    ds = dates_of(await copies(w, sid))
    assert len(ds) == 18 and all(date.fromisoformat(d).weekday() != 6 for d in ds)


async def test_downtime_over_a_weekend_catches_up_without_sunday(world):
    w = world
    sid = (await post(w, count=None)).json()["data"]["series"]["id"]
    w["clock"].today = date(2026, 10, 13)          # server down Sat–Mon, back Tuesday
    await rec.run_due(w["db"])
    assert dates_of(await copies(w, sid)) == ["2026-10-09", "2026-10-10", "2026-10-12", "2026-10-13"]


async def test_pause_saturday_resume_sunday_continues_monday(world):
    w = world
    sid = (await post(w, count=None)).json()["data"]["series"]["id"]
    w["clock"].today = date(2026, 10, 10)
    await rec.run_due(w["db"])
    assert (await w["call"]("PATCH", f"/api/v1/projects/recurring/{sid}", "lead", json={"action": "pause"})).status_code == 200
    w["clock"].today = SUN
    assert (await w["call"]("PATCH", f"/api/v1/projects/recurring/{sid}", "lead", json={"action": "resume"})).status_code == 200
    s = await w["db"]["recurring_tasks"].find_one({"_id": ObjectId(sid)})
    assert s["next_date"] == "2026-10-12"
    await walk(w, MON)
    assert dates_of(await copies(w, sid)) == ["2026-10-09", "2026-10-10", "2026-10-12"]


async def test_due_offset_counts_from_each_copys_own_day(world):
    w = world
    sid = (await post(w, due_offset_days=1)).json()["data"]["series"]["id"]
    await walk(w, MON)
    due = {c["recurrence"]["date"]: c["due_date"] for c in await copies(w, sid)}
    assert due == {"2026-10-09": "2026-10-10", "2026-10-10": "2026-10-11", "2026-10-12": "2026-10-13"}


async def test_weekly_and_monthly_are_untouched(world):
    w = world
    r = await post(w, frequency="weekly", weekdays=[0, 6], skip_sundays=True)
    assert r.status_code == 422, "skip_sundays is for daily"
    r = await post(w, frequency="weekly", weekdays=[0, 6])
    assert r.status_code == 201 and r.json()["data"]["series"]["skip_sundays"] is False
    sid = r.json()["data"]["series"]["id"]
    await walk(w, MON)
    assert dates_of(await copies(w, sid)) == ["2026-10-11", "2026-10-12"], "a chosen Sunday still happens"


# ── Existing series (migration) ──────────────────────────────────────────────

async def old_series(w, **kw):
    """A daily series as it was stored before skip_sundays existed."""
    now = datetime.now(timezone.utc)
    doc = {"title": "Old daily", "description": "", "priority": "medium", "team_id": w["t1"],
           "approver_id": "", "approver_name": "", "verify_users": [], "verify_teams": [], "attachments": [],
           "assignees": [w["s"]["asha"]], "frequency": "daily", "anchor_date": "2026-10-07", "month_day": None,
           "weekday": None, "next_index": 2, "next_date": "2026-10-09", "occurrences_total": 6,
           "occurrences_done": 2, "due_offset_days": 0, "status": "active", "paused_reason": "", "last_errors": [],
           "created_by": w["s"]["lead"], "created_by_name": "Lead", "created_at": now, "updated_at": now, **kw}
    doc["_id"] = (await w["db"]["recurring_tasks"].insert_one(doc)).inserted_id
    return doc


async def test_existing_series_skips_sundays_from_its_next_copy(world):
    w = world
    old = await old_series(w)
    # Its earlier copies (Wed, Thu) exist and must not change.
    for i, d in enumerate(["2026-10-07", "2026-10-08"], start=1):
        await w["db"]["project_tasks"].insert_one({"title": "Old daily", "assigned_to": w["s"]["asha"],
                                                   "recurrence": {"id": str(old["_id"]), "date": d, "index": i}})
    assert await rec.migrate_daily_skip_sundays(w["db"]) == 1
    s = await w["db"]["recurring_tasks"].find_one({"_id": old["_id"]})
    assert s["skip_sundays"] is True and s["anchor_date"] == "2026-10-09" and s["next_index"] == 0
    assert s["started_on"] == "2026-10-07" and s["occurrences_done"] == 2, "count kept"
    await rec.run_due(w["db"])
    await walk(w, date(2026, 10, 20))
    cs = await copies(w, str(old["_id"]))
    assert dates_of(cs) == ["2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-12", "2026-10-13"]
    assert sorted(c["recurrence"]["index"] for c in cs) == [1, 2, 3, 4, 5, 6], "numbering continues"
    s = await w["db"]["recurring_tasks"].find_one({"_id": old["_id"]})
    assert s["status"] == "completed"


async def test_existing_series_due_on_a_sunday_moves_to_monday(world):
    w = world
    w["clock"].today = SUN
    old = await old_series(w, anchor_date="2026-10-05", next_index=6, next_date="2026-10-11")
    await rec.migrate_daily_skip_sundays(w["db"])
    s = await w["db"]["recurring_tasks"].find_one({"_id": old["_id"]})
    assert s["next_date"] == "2026-10-12" and s["anchor_date"] == "2026-10-12"
    await rec.run_due(w["db"])
    assert await copies(w, str(old["_id"])) == [], "no Sunday copy"


async def test_paused_existing_series_resumes_without_sundays(world):
    w = world
    old = await old_series(w, status="paused", next_date="2026-10-05", next_index=0, anchor_date="2026-10-05",
                           occurrences_done=0, occurrences_total=None)
    await rec.migrate_daily_skip_sundays(w["db"])
    w["clock"].today = SUN
    assert (await w["call"]("PATCH", f"/api/v1/projects/recurring/{old['_id']}", "lead", json={"action": "resume"})).status_code == 200
    s = await w["db"]["recurring_tasks"].find_one({"_id": old["_id"]})
    assert s["next_date"] == "2026-10-12" and s["status"] == "active"


async def test_ended_series_are_only_marked(world):
    w = world
    done = await old_series(w, status="completed", next_date=None)
    stopped = await old_series(w, status="stopped", next_date=None)
    assert await rec.migrate_daily_skip_sundays(w["db"]) == 0
    for d in (done, stopped):
        s = await w["db"]["recurring_tasks"].find_one({"_id": d["_id"]})
        assert s["skip_sundays"] is False and s["anchor_date"] == "2026-10-07" and s["next_index"] == 2


async def test_migration_is_idempotent_and_safe_from_two_workers(world):
    w = world
    olds = [await old_series(w) for _ in range(5)]
    results = await asyncio.gather(*[rec.migrate_daily_skip_sundays(w["db"]) for _ in range(4)])
    assert sum(results) == 5, "each series migrated exactly once"
    assert await rec.migrate_daily_skip_sundays(w["db"]) == 0
    for o in olds:
        s = await w["db"]["recurring_tasks"].find_one({"_id": o["_id"]})
        assert (s["anchor_date"], s["next_index"], s["next_date"]) == ("2026-10-09", 0, "2026-10-09")


async def test_migration_racing_the_scheduler_never_duplicates(world):
    w = world
    olds = [await old_series(w) for _ in range(3)]
    await asyncio.gather(rec.migrate_daily_skip_sundays(w["db"]), rec.run_due(w["db"]), rec.run_due(w["db"]))
    await rec.run_due(w["db"])
    await walk(w, date(2026, 10, 20))
    for o in olds:
        cs = await copies(w, str(o["_id"]))
        ds = [c["recurrence"]["date"] for c in cs]
        assert len(ds) == len(set(ds)), "no day twice"
        assert all(date.fromisoformat(d).weekday() != 6 for d in ds)
        assert len(ds) == 4, "the 4 remaining copies of 6"


async def test_new_series_are_left_alone_by_the_migration(world):
    w = world
    sid = (await post(w, skip_sundays=False)).json()["data"]["series"]["id"]
    assert await rec.migrate_daily_skip_sundays(w["db"]) == 0
    s = await w["db"]["recurring_tasks"].find_one({"_id": ObjectId(sid)})
    assert s["skip_sundays"] is False, "a leader's choice is never overridden"


# ── Switching it on / off later ──────────────────────────────────────────────

async def patch(w, sid, who="lead", **body_):
    return await w["call"]("PATCH", f"/api/v1/projects/recurring/{sid}", who, json=body_)


async def test_switch_off_on_a_sunday_creates_todays_copy(world):
    w = world
    sid = (await post(w, count=None)).json()["data"]["series"]["id"]
    await walk(w, SUN)
    assert "2026-10-11" not in dates_of(await copies(w, sid))
    r = await patch(w, sid, skip_sundays=False)
    assert r.status_code == 200 and r.json()["data"]["skip_sundays"] is False
    assert "2026-10-11" in dates_of(await copies(w, sid)), "today is a day again"


async def test_switch_off_on_off_the_same_sunday_counts_it_once(world):
    # Found by the model test (2026-10-15): Sunday's copy made, switched to skip,
    # then back on the same Sunday — re-aiming at today counted the day twice
    # (the duplicate copy is "already done"), so a 7-copy series ended after 6.
    w = world
    sid = (await post(w, count=7, skip_sundays=False)).json()["data"]["series"]["id"]
    await walk(w, SUN)
    assert "2026-10-11" in dates_of(await copies(w, sid))
    assert (await patch(w, sid, skip_sundays=True)).status_code == 200
    assert (await patch(w, sid, skip_sundays=False)).status_code == 200
    s = await w["db"]["recurring_tasks"].find_one({"_id": ObjectId(sid)})
    assert s["next_date"] == "2026-10-12" and s["occurrences_done"] == 3
    await walk(w, date(2026, 10, 20))
    got = await copies(w, sid)
    assert dates_of(got) == ["2026-10-09", "2026-10-10", "2026-10-11", "2026-10-12", "2026-10-13",
                             "2026-10-14", "2026-10-15"], "all 7 real copies"
    assert sorted(c["recurrence"]["index"] for c in got) == list(range(1, 8))


async def test_switch_off_before_a_skipped_sunday_brings_it_back(world):
    # Found in the browser (2026-10-15): switched off on Saturday (next copy
    # Monday, only because Sunday was skipped) — the coming Sunday was lost.
    w = world
    sid = (await post(w, count=None)).json()["data"]["series"]["id"]
    await walk(w, date(2026, 10, 10))                                   # Sat: next is Mon 12
    s = await w["db"]["recurring_tasks"].find_one({"_id": ObjectId(sid)})
    assert s["next_date"] == "2026-10-12"
    r = await patch(w, sid, skip_sundays=False)
    assert r.json()["data"]["next_date"] == "2026-10-11", "Sunday is back"
    await walk(w, date(2026, 10, 12))
    assert dates_of(await copies(w, sid)) == ["2026-10-09", "2026-10-10", "2026-10-11", "2026-10-12"]


async def test_switch_off_while_paused_brings_the_sunday_back_too(world):
    w = world
    sid = (await post(w, count=None)).json()["data"]["series"]["id"]
    await walk(w, date(2026, 10, 10))
    assert (await patch(w, sid, action="pause")).status_code == 200
    r = await patch(w, sid, skip_sundays=False)
    assert r.json()["data"]["next_date"] == "2026-10-11" and r.json()["data"]["status"] == "paused"
    await walk(w, date(2026, 10, 12))                                   # paused: nothing
    assert dates_of(await copies(w, sid)) == ["2026-10-09", "2026-10-10"]
    assert (await patch(w, sid, action="resume")).status_code == 200      # Mon: today's copy, never the past Sunday
    assert dates_of(await copies(w, sid)) == ["2026-10-09", "2026-10-10", "2026-10-12"]


async def test_switch_off_with_a_natural_monday_start_brings_no_past_sunday(world):
    w = world
    w["clock"].today = SUN
    sid = (await post(w, count=None)).json()["data"]["series"]["id"]   # set up Sunday -> starts Monday
    w["clock"].today = date(2026, 10, 12)
    await rec.run_due(w["db"])
    w["clock"].today = date(2026, 10, 17)
    await rec.run_due(w["db"])                                          # Mon–Sat made, next Mon 19
    r = await patch(w, sid, skip_sundays=False)
    assert r.json()["data"]["next_date"] == "2026-10-18"
    assert "2026-10-11" not in dates_of(await copies(w, sid)), "the past Sunday never comes back"


async def test_switch_off_on_monday_before_the_run_never_makes_yesterdays_sunday(world):
    # Monday morning, the scheduler hasn't run yet (next is today): switching
    # Sundays back on must not reach back to yesterday — no copies for the past.
    w = world
    sid = (await post(w, count=None)).json()["data"]["series"]["id"]
    await walk(w, date(2026, 10, 10))
    w["clock"].today = date(2026, 10, 12)                               # no run_due yet
    r = await patch(w, sid, skip_sundays=False)
    assert r.status_code == 200
    assert dates_of(await copies(w, sid)) == ["2026-10-09", "2026-10-10", "2026-10-12"]


async def test_switch_on_skips_the_next_sunday(world):
    w = world
    sid = (await post(w, count=None, skip_sundays=False)).json()["data"]["series"]["id"]
    assert (await patch(w, sid, skip_sundays=True)).status_code == 200
    await walk(w, date(2026, 10, 19))
    ds = dates_of(await copies(w, sid))
    assert "2026-10-11" not in ds and "2026-10-18" not in ds and "2026-10-12" in ds


async def test_switch_rules(world):
    w = world
    weekly = (await post(w, frequency="weekly", weekdays=[1, 3])).json()["data"]["series"]["id"]
    assert (await patch(w, weekly, skip_sundays=True)).status_code == 422
    daily = (await post(w, count=1)).json()["data"]["series"]["id"]       # completes today
    assert (await patch(w, daily, skip_sundays=False)).status_code == 409, "ended"
    other = (await post(w)).json()["data"]["series"]["id"]
    assert (await patch(w, other, who="asha", skip_sundays=False)).status_code == 403
    assert (await patch(w, other, skip_sundays=True)).status_code == 200, "no change is fine"
    assert (await patch(w, other, title="Renamed", skip_sundays=True)).json()["data"]["title"] == "Renamed"


def test_resume_lands_right_weeks_later_for_every_target_day():
    """Resuming from any day up to two months on lands on that day — or Monday for a Sunday."""
    off = week_offsets(FRI, MON_TO_SAT)
    for k in range(0, 60):
        target = FRI + timedelta(days=k)
        i = first_index_on_or_after("daily", FRI, 0, target, None, off)
        got = occurrence_date("daily", FRI, i, None, off)
        want = target + timedelta(days=1) if target.weekday() == 6 else target
        assert got == want, (target, got, want)
        if i:
            assert occurrence_date("daily", FRI, i - 1, None, off) < target, "the smallest such index"
