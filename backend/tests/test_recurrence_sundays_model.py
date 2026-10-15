"""
Daily skip-Sundays — the QA pass (2026-10-15).

1. Model-based: random sequences of creating daily series (Sundays skipped or
   kept, with a count or until stopped), time passing (incl. downtime gaps),
   pause / resume, switching Sundays on / off, stopping and editing — with two
   scheduler workers sometimes running at once. After every step the database is
   compared with an independent model that walks the CALENDAR one day at a time
   (no shared arithmetic with the server's week offsets).
2. Random migrations: old-style daily series (random first day, progress and
   status) moved onto skipping Sundays, then run for weeks.
3. API contract: bad values for skip_sundays are refused, not coerced.
"""
import asyncio
import random
from datetime import date, datetime, timedelta, timezone

import pytest
from bson import ObjectId

from app.services import recurrence as rec
from tests.test_recurrence import body, copies, world  # noqa: F401

SUNDAY = 6


def eligible(d: date, skip: bool) -> bool:
    return not (skip and d.weekday() == SUNDAY)


def next_eligible(d: date, skip: bool, strictly_after=True) -> date:
    d = d + timedelta(days=1) if strictly_after else d
    while not eligible(d, skip):
        d += timedelta(days=1)
    return d


class Model:
    """Plain calendar walk of the agreed rules."""

    def __init__(self, today: date, skip: bool, total):
        self.skip, self.total, self.done = skip, total, 0
        self.status = "active"
        self.next = next_eligible(today, skip, strictly_after=False)
        self.dates: list[str] = []

    def run(self, today: date, cap=rec.CATCHUP_CAP):
        n = 0
        while self.status == "active" and self.next and self.next <= today and n < cap:
            self.dates.append(self.next.isoformat())
            self.done += 1
            n += 1
            if self.total is not None and self.done >= self.total:
                self.status, self.next = "completed", None
            else:
                self.next = next_eligible(self.next, self.skip)

    def resume(self, today: date):
        self.status = "active"
        self.next = max(self.next, next_eligible(today, self.skip, strictly_after=False))
        self.run(today)

    def toggle(self, skip: bool, today: date):
        if skip == self.skip:
            return
        self.skip = skip
        if self.status in ("active", "paused") and self.next:
            if skip and self.next.weekday() == SUNDAY:
                self.next += timedelta(days=1)
            sunday = self.next - timedelta(days=1)
            if not skip and self.next.weekday() == 0 and sunday >= today and sunday.isoformat() not in self.dates:
                self.next = sunday          # the Sunday that was only skipped comes back
            if self.status == "active":
                self.run(today)


async def call(w, method, path, **kw):
    return await w["call"](method, path, "lead", **kw)


@pytest.mark.parametrize("seed", range(25))
async def test_random_sequences_match_a_calendar_walk(world, seed):
    rnd = random.Random(seed)
    w = world
    w["clock"].today = date(2026, 10, 9) + timedelta(days=rnd.randint(0, 6))      # start on any weekday
    series: dict[str, Model] = {}

    for step in range(45):
        today = w["clock"].today
        op = rnd.choices(["create", "time", "pause", "resume", "toggle", "stop", "edit"], [3, 6, 1, 1, 2, 1, 1])[0]
        live = [k for k, m in series.items() if m.status in ("active", "paused")]
        sid = rnd.choice(live) if live else None
        m = series.get(sid)
        if op == "create" or not series:
            skip = rnd.random() < 0.6
            total = rnd.choice([None, 1, 3, 7, 12])
            rep = {"frequency": "daily", "count": total, "due_offset_days": 0}
            if rnd.random() < 0.85 or not skip:          # sometimes omit it: the default must be "skip"
                rep["skip_sundays"] = skip
            r = await call(w, "POST", "/api/v1/projects/batch", json=body(w, assignees=[w["s"]["asha"]], repeat=rep))
            assert r.status_code == 201, (seed, step, r.text)
            new = Model(today, skip, total)
            new.run(today)                                   # today's copy now, if today is a day
            series[r.json()["data"]["series"]["id"]] = new
        elif op == "time":
            gap = rnd.choice([1, 1, 1, 2, 3, 7])           # >1 = the server was down for a while
            w["clock"].today = today + timedelta(days=gap)
            workers = rnd.choice([1, 1, 2])
            await asyncio.gather(*[rec.run_due(w["db"]) for _ in range(workers)])
            for x in series.values():
                x.run(w["clock"].today)
        elif m is None:
            continue
        elif op == "pause":
            r = await call(w, "PATCH", f"/api/v1/projects/recurring/{sid}", json={"action": "pause"})
            if m.status == "active":
                assert r.status_code == 200
                m.status = "paused"
            else:
                assert r.status_code == 409
        elif op == "resume":
            r = await call(w, "PATCH", f"/api/v1/projects/recurring/{sid}", json={"action": "resume"})
            if m.status == "paused":
                assert r.status_code == 200
                m.resume(today)
            else:
                assert r.status_code == 409
        elif op == "toggle":
            skip = rnd.random() < 0.5
            r = await call(w, "PATCH", f"/api/v1/projects/recurring/{sid}", json={"skip_sundays": skip})
            assert r.status_code == 200, (seed, step, r.text)
            m.toggle(skip, today)
        elif op == "stop":
            r = await call(w, "PATCH", f"/api/v1/projects/recurring/{sid}", json={"action": "stop"})
            assert r.status_code == 200
            m.status, m.next = "stopped", None
        elif op == "edit":
            r = await call(w, "PATCH", f"/api/v1/projects/recurring/{sid}", json={"title": f"Edited {step}"})
            assert r.status_code == 200

        # ── compare the world with the model ──
        for k, x in series.items():
            s = await w["db"]["recurring_tasks"].find_one({"_id": ObjectId(k)})
            got = sorted(c["recurrence"]["date"] for c in await copies(w, k))
            ctx = (seed, step, op, k[-4:], x.skip, x.total)
            assert got == x.dates, ctx + (got, x.dates)
            assert len(got) == len(set(got)), ctx + ("a day twice",)
            assert s["status"] == x.status, ctx + (s["status"], x.status)
            assert s["occurrences_done"] == x.done, ctx
            assert s["next_date"] == (x.next.isoformat() if x.next else None), ctx + (s["next_date"], x.next)
            assert bool(s.get("skip_sundays")) is x.skip, ctx
            if x.skip:
                assert s["anchor_date"] and date.fromisoformat(s["anchor_date"]).weekday() != SUNDAY, ctx + ("Sunday anchor",)


@pytest.mark.parametrize("seed", range(15))
async def test_random_old_series_migrate_and_run(world, seed):
    rnd = random.Random(1000 + seed)
    w = world
    today = date(2026, 10, 9) + timedelta(days=rnd.randint(0, 6))
    w["clock"].today = today
    now = datetime.now(timezone.utc)
    olds = []
    for i in range(6):
        anchor = today - timedelta(days=rnd.randint(0, 20))
        idx = rnd.randint(0, 25)
        status = rnd.choice(["active", "active", "active", "paused", "completed", "stopped"])
        total = rnd.choice([None, idx + rnd.randint(1, 10)])
        nxt = anchor + timedelta(days=idx)
        doc = {"title": f"Old {i}", "description": "", "priority": "medium", "team_id": w["t1"], "approver_id": "",
               "approver_name": "", "verify_users": [], "verify_teams": [], "attachments": [],
               "assignees": [w["s"]["asha"]], "frequency": "daily", "anchor_date": anchor.isoformat(),
               "month_day": None, "weekday": None, "next_index": idx,
               "next_date": None if status in ("completed", "stopped") else nxt.isoformat(),
               "occurrences_total": total, "occurrences_done": idx, "due_offset_days": 0, "status": status,
               "paused_reason": "", "last_errors": [], "created_by": w["s"]["lead"], "created_by_name": "Lead",
               "created_at": now, "updated_at": now}
        doc["_id"] = (await w["db"]["recurring_tasks"].insert_one(doc)).inserted_id
        olds.append(doc)

    await asyncio.gather(rec.migrate_daily_skip_sundays(w["db"]), rec.migrate_daily_skip_sundays(w["db"]))
    assert await rec.migrate_daily_skip_sundays(w["db"]) == 0, "idempotent"

    models = {}
    for d in olds:
        s = await w["db"]["recurring_tasks"].find_one({"_id": d["_id"]})
        if d["status"] in ("completed", "stopped"):
            assert s["skip_sundays"] is False and s["anchor_date"] == d["anchor_date"], "ended: only marked"
            continue
        assert s["skip_sundays"] is True and s["occurrences_done"] == d["occurrences_done"]
        assert s["started_on"] == d["anchor_date"]
        m = Model.__new__(Model)
        m.skip, m.total, m.done, m.status, m.dates = True, d["occurrences_total"], d["occurrences_done"], d["status"], []
        m.next = next_eligible(date.fromisoformat(d["next_date"]), True, strictly_after=False)
        assert s["next_date"] == m.next.isoformat(), (seed, d["next_date"], s["next_date"])
        models[str(d["_id"])] = m

    for day in range(30):
        w["clock"].today = today + timedelta(days=day)
        await rec.run_due(w["db"])
        for k, m in models.items():
            if m.status == "paused" and day == 10:
                assert (await w["call"]("PATCH", f"/api/v1/projects/recurring/{k}", "lead",
                                        json={"action": "resume"})).status_code == 200
                m.resume(w["clock"].today)
            else:
                m.run(w["clock"].today)
    for k, m in models.items():
        got = sorted(c["recurrence"]["date"] for c in await copies(w, k))
        assert got == m.dates, (seed, k, got, m.dates)
        assert all(date.fromisoformat(x).weekday() != SUNDAY for x in got)
        idx = sorted(c["recurrence"]["index"] for c in await copies(w, k))
        start = next(d for d in olds if str(d["_id"]) == k)["occurrences_done"]
        assert idx == list(range(start + 1, start + 1 + len(got))), "numbering continues where it was"


@pytest.mark.parametrize("bad", ["yes", "true", 1, 0, [], {}])
async def test_bad_values_are_refused_not_coerced(world, bad):
    w = world
    r = await call(w, "POST", "/api/v1/projects/batch", json=body(
        w, assignees=[w["s"]["asha"]], repeat={"frequency": "daily", "count": 3, "skip_sundays": bad}))
    assert r.status_code == 422, (bad, r.status_code)
    assert await w["db"]["recurring_tasks"].count_documents({}) == 0
    sid = (await call(w, "POST", "/api/v1/projects/batch", json=body(
        w, assignees=[w["s"]["asha"]], repeat={"frequency": "daily", "count": 3}))).json()["data"]["series"]["id"]
    r = await call(w, "PATCH", f"/api/v1/projects/recurring/{sid}", json={"skip_sundays": bad})
    assert r.status_code == 422, (bad, r.status_code)


async def test_null_means_the_default(world):
    w = world
    r = await call(w, "POST", "/api/v1/projects/batch", json=body(
        w, assignees=[w["s"]["asha"]], repeat={"frequency": "daily", "count": 3, "skip_sundays": None}))
    assert r.status_code == 201 and r.json()["data"]["series"]["skip_sundays"] is True
    sid = r.json()["data"]["series"]["id"]
    r = await call(w, "PATCH", f"/api/v1/projects/recurring/{sid}", json={"skip_sundays": None, "title": "Still"})
    assert r.status_code == 200 and r.json()["data"]["skip_sundays"] is True, "null = no change"
