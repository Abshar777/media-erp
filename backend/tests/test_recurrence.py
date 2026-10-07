"""
Repeating tasks + multiple assignees.

Pure date-engine tests, plus integration tests that drive the real endpoints
and the real scheduler against a throwaway MongoDB database (created and
dropped here; the developer's database is never touched). A controllable
clock lets the tests walk days, weeks and months forward. Skips without Mongo.
"""
import asyncio
import secrets
from datetime import date, timedelta

import pytest
from bson import ObjectId
from httpx import ASGITransport, AsyncClient
from motor.motor_asyncio import AsyncIOMotorClient

from app.config import settings
from app.database import get_db
from app.main import app
from app.middleware.auth import get_current_user
from app.services import recurrence as rec
from app.services.recurrence import add_months, first_index_on_or_after, occurrence_date


# ════════════════════════════════════════════════════════════════════════════
# Date engine — pure functions
# ════════════════════════════════════════════════════════════════════════════

def test_daily_and_weekly_steps():
    fri = date(2026, 10, 9)
    assert [occurrence_date("daily", fri, i) for i in range(3)] == [
        date(2026, 10, 9), date(2026, 10, 10), date(2026, 10, 11)]
    weekly = [occurrence_date("weekly", fri, i) for i in range(3)]
    assert weekly == [date(2026, 10, 9), date(2026, 10, 16), date(2026, 10, 23)]
    assert all(d.weekday() == 4 for d in weekly), "weekly must stay on the anchor weekday"


def test_monthly_same_day():
    first = date(2026, 10, 1)
    assert [occurrence_date("monthly", first, i) for i in range(4)] == [
        date(2026, 10, 1), date(2026, 11, 1), date(2026, 12, 1), date(2027, 1, 1)]


def test_monthly_31st_clamps_and_never_drifts():
    # Leap year 2028: Jan 31 → Feb 29 → Mar 31 → Apr 30 → May 31.
    a = date(2028, 1, 31)
    assert [occurrence_date("monthly", a, i) for i in range(5)] == [
        date(2028, 1, 31), date(2028, 2, 29), date(2028, 3, 31), date(2028, 4, 30), date(2028, 5, 31)]
    # Non-leap: Feb 28, and back to the 31st afterwards (no 31→28→28 decay).
    b = date(2027, 1, 31)
    assert occurrence_date("monthly", b, 1) == date(2027, 2, 28)
    assert occurrence_date("monthly", b, 2) == date(2027, 3, 31)


def test_monthly_crosses_year_boundary():
    assert add_months(date(2026, 11, 15), 3, 15) == date(2027, 2, 15)
    assert add_months(date(2026, 12, 31), 2, 31) == date(2027, 2, 28)


def test_first_index_on_or_after():
    a = date(2026, 10, 9)  # Friday
    assert first_index_on_or_after("daily", a, 2, date(2026, 10, 20)) == 11
    assert first_index_on_or_after("daily", a, 15, date(2026, 10, 20)) == 15   # never moves back
    # Weekly: Wed 21 Oct -> next Friday is index 2 (23 Oct); Friday itself is exact.
    assert first_index_on_or_after("weekly", a, 0, date(2026, 10, 21)) == 2
    assert first_index_on_or_after("weekly", a, 0, date(2026, 10, 23)) == 2
    assert first_index_on_or_after("monthly", date(2026, 1, 31), 0, date(2026, 3, 5)) == 2  # Mar 31


def test_validate_repeat_limits():
    assert rec.validate_repeat("daily", 365, 0) == ""
    assert "at most 365" in rec.validate_repeat("daily", 366, 0)
    assert "at most 104" in rec.validate_repeat("weekly", 105, 0)
    assert "at most 36" in rec.validate_repeat("monthly", 37, 0)
    assert rec.validate_repeat("daily", None, 0) == ""            # until stopped
    assert rec.validate_repeat("daily", 0, 0) != ""
    assert rec.validate_repeat("daily", 3, 61) != ""
    assert rec.validate_repeat("hourly", 3, 0) != ""


# ════════════════════════════════════════════════════════════════════════════
# Integration — throwaway database
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
    name = f"mediaerp_test_recur_{secrets.token_hex(4)}"
    db = client[name]

    # Side effects (chat DMs) use the module-level get_db(); point it here too.
    import app.database as dbmod
    monkeypatch.setattr(dbmod, "_client", client)
    monkeypatch.setitem(settings.__dict__, "mongodb_db_name", name)

    clock = Clock(date(2026, 10, 9))                 # a Friday
    monkeypatch.setattr(rec, "today_ist", clock)

    roles = {r: {"_id": ObjectId(), "role_name": r} for r in ("Team Leader", "Employee", "Super Admin")}
    await db["roles"].insert_many(list(roles.values()))
    people = {"lead": "Team Leader", "lead2": "Team Leader", "asha": "Employee",
              "mira": "Employee", "ravi": "Employee", "emp": "Employee", "sa": "Super Admin"}
    U = {k: ObjectId() for k in people}
    await db["users"].insert_many([{"_id": U[k], "name": k.title(), "email": f"{k}@t.io",
                                    "is_active": True, "role_id": str(roles[r]["_id"])}
                                   for k, r in people.items()])
    s = {k: str(v) for k, v in U.items()}
    T1 = {"_id": ObjectId(), "name": "T1", "members": [
        {"user_id": s["lead"], "role": "leader"}, {"user_id": s["asha"], "role": "member"},
        {"user_id": s["mira"], "role": "member"}, {"user_id": s["ravi"], "role": "member"},
        {"user_id": s["emp"], "role": "member"}]}
    T2 = {"_id": ObjectId(), "name": "T2", "members": [{"user_id": s["lead2"], "role": "leader"}]}
    await db["teams"].insert_many([T1, T2])
    await rec.ensure_indexes(db)

    def as_user(k):
        async def _u():
            return {"_id": U[k], "name": k.title(), "email": f"{k}@t.io",
                    "role_id": str(roles[people[k]]["_id"]), "_role": roles[people[k]]}
        return _u

    app.dependency_overrides[get_db] = lambda: db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://t") as ac:
        async def call(method, path, who, **kw):
            app.dependency_overrides[get_current_user] = as_user(who)
            return await ac.request(method, path, **kw)

        yield {"db": db, "client": client, "s": s, "t1": str(T1["_id"]), "t2": str(T2["_id"]),
               "clock": clock, "call": call, "roles": roles, "U": U, "name": name}
    app.dependency_overrides.clear()
    await client.drop_database(name)
    client.close()


def body(w, **kw):
    return {"title": "Daily report", "team_id": w["t1"], "priority": "medium",
            "due_date": "2026-10-09", **kw}


async def copies(w, series_id=None):
    q = {"recurrence.id": series_id} if series_id else {"recurrence": {"$exists": True}}
    return await w["db"]["project_tasks"].find(q).sort([("recurrence.date", 1), ("assigned_to", 1)]).to_list(1000)


# ── Multiple assignees, once ─────────────────────────────────────────────────

async def test_batch_once_gives_each_person_their_own_task(world):
    w, s = world, world["s"]
    r = await w["call"]("POST", "/api/v1/projects/batch", "lead",
                        json=body(w, assignees=[s["asha"], s["mira"], s["ravi"]]))
    assert r.status_code == 201, r.text
    data = r.json()["data"]
    assert len(data["tasks"]) == 3 and data["series"] is None and data["errors"] == []
    docs = await w["db"]["project_tasks"].find({}).to_list(10)
    assert sorted(d["assigned_to"] for d in docs) == sorted([s["asha"], s["mira"], s["ravi"]])
    assert len({d["batch_id"] for d in docs}) == 1, "copies share one batch_id"
    assert all(d["status"] == "pending" and d["title"] == "Daily report" for d in docs)
    assert all("recurrence" not in d for d in docs)
    assert sorted(d["assigned_to_name"] for d in docs) == ["Asha", "Mira", "Ravi"]   # from the DB, not the client


async def test_batch_same_rules_as_single_create(world):
    """An employee raising work gets themselves added as verifier — on every copy."""
    w, s = world, world["s"]
    r = await w["call"]("POST", "/api/v1/projects/batch", "emp",
                        json=body(w, assignees=[s["asha"], s["mira"]]))
    assert r.status_code == 201, r.text
    docs = await w["db"]["project_tasks"].find({}).to_list(10)
    assert all(d["verify_users"] == [s["emp"]] for d in docs)
    notes = await w["db"]["notifications"].find({"type": "task_assigned"}).to_list(10)
    assert sorted(str(n["user_id"]) for n in notes) == sorted([s["asha"], s["mira"]])


async def test_batch_dedupes_and_validates(world):
    w, s = world, world["s"]
    r = await w["call"]("POST", "/api/v1/projects/batch", "lead",
                        json=body(w, assignees=[s["asha"], s["asha"], s["mira"]]))
    assert r.status_code == 201 and len(r.json()["data"]["tasks"]) == 2
    for bad in ([], [str(ObjectId())], ["nope"]):
        r = await w["call"]("POST", "/api/v1/projects/batch", "lead", json=body(w, assignees=bad))
        assert r.status_code == 422, bad
    r = await w["call"]("POST", "/api/v1/projects/batch", "lead",
                        json=body(w, assignees=[str(ObjectId()) for _ in range(26)]))
    assert r.status_code == 422


async def test_batch_refuses_whole_batch_on_template_error(world):
    w, s = world, world["s"]
    before = await w["db"]["project_tasks"].count_documents({})
    r = await w["call"]("POST", "/api/v1/projects/batch", "lead",
                        json=body(w, title="  ", assignees=[s["asha"], s["mira"]]))
    assert r.status_code == 422 and "Task name" in r.json()["message"]
    r = await w["call"]("POST", "/api/v1/projects/batch", "emp",
                        json=body(w, team_id=None, assignees=[s["emp"], s["asha"]]))
    assert r.status_code == 422 and "team" in r.json()["message"].lower()
    assert await w["db"]["project_tasks"].count_documents({}) == before, "nothing half-created"


async def test_single_create_unchanged_no_new_fields(world):
    w, s = world, world["s"]
    r = await w["call"]("POST", "/api/v1/projects", "lead", json=body(w, assigned_to=s["asha"]))
    assert r.status_code == 201
    d = await w["db"]["project_tasks"].find_one({})
    assert "recurrence" not in d and "batch_id" not in d


# ── Repeating ────────────────────────────────────────────────────────────────

async def start(w, who="lead", **repeat):
    r = await w["call"]("POST", "/api/v1/projects/batch", who,
                        json=body(w, assignees=repeat.pop("assignees", [w["s"]["asha"], w["s"]["mira"]]),
                                  repeat={"frequency": "daily", "count": 3, "due_offset_days": 0, **repeat}))
    return r


async def test_only_leaders_can_start_repeating(world):
    w = world
    r = await start(w, who="emp")
    assert r.status_code == 403
    assert await w["db"]["recurring_tasks"].count_documents({}) == 0
    r = await start(w, who="lead2")            # a leader — but of another team
    assert r.status_code == 403
    r = await start(w, who="sa")               # admin roles may
    assert r.status_code == 201


async def test_daily_series_full_lifecycle(world):
    w, s = world, world["s"]
    r = await start(w, frequency="daily", count=3, due_offset_days=1)
    assert r.status_code == 201, r.text
    sid = r.json()["data"]["series"]["id"]
    first = await copies(w, sid)
    assert len(first) == 2, "first copy for each person is created immediately"
    assert {c["recurrence"]["date"] for c in first} == {"2026-10-09"}
    assert all(c["due_date"] == "2026-10-10" for c in first), "due = date + offset"
    assert all(c["recurrence"]["index"] == 1 and c["recurrence"]["total"] == 3 for c in first)

    w["clock"].today = date(2026, 10, 10)
    assert await rec.run_due(w["db"]) == 2
    w["clock"].today = date(2026, 10, 11)
    assert await rec.run_due(w["db"]) == 2
    w["clock"].today = date(2026, 10, 12)
    assert await rec.run_due(w["db"]) == 0, "count reached — nothing more"

    all_copies = await copies(w, sid)
    assert [c["recurrence"]["date"] for c in all_copies] == [
        "2026-10-09", "2026-10-09", "2026-10-10", "2026-10-10", "2026-10-11", "2026-10-11"]
    assert [c["recurrence"]["index"] for c in all_copies] == [1, 1, 2, 2, 3, 3]
    series = await w["db"]["recurring_tasks"].find_one({"_id": ObjectId(sid)})
    assert series["status"] == "completed" and series["next_date"] is None
    assert series["occurrences_done"] == 3


async def test_running_twice_same_day_is_a_noop(world):
    w = world
    await start(w, count=5)
    w["clock"].today = date(2026, 10, 10)
    assert await rec.run_due(w["db"]) == 2
    assert await rec.run_due(w["db"]) == 0
    assert await rec.run_due(w["db"]) == 0
    assert len(await copies(w)) == 4


async def test_two_workers_at_once_never_duplicate(world):
    """Two schedulers on SEPARATE connections, like two production workers."""
    w = world
    r = await start(w, count=10, assignees=[w["s"]["asha"], w["s"]["mira"], w["s"]["ravi"]])
    sid = ObjectId(r.json()["data"]["series"]["id"])
    other = AsyncIOMotorClient(settings.mongodb_url)
    db2 = other[w["name"]]
    try:
        for day in range(10, 16):
            w["clock"].today = date(2026, 10, day)
            await asyncio.gather(rec.run_due(w["db"]), rec.run_due(db2),
                                 rec.advance_series(w["db"], sid), rec.advance_series(db2, sid))
    finally:
        other.close()
    docs = await copies(w, str(sid))
    keys = [(d["recurrence"]["date"], d["assigned_to"]) for d in docs]
    assert len(keys) == len(set(keys)), "a duplicate copy was created"
    assert len(docs) == 3 * 7, "exactly one copy per person per day (9th–15th)"
    series = await w["db"]["recurring_tasks"].find_one({"_id": sid})
    assert series["occurrences_done"] == 7
    notes = await w["db"]["notifications"].count_documents({"type": "task_assigned"})
    assert notes == 3 * 7, "no duplicate notifications either"


async def test_pause_and_resume_during_a_run_never_fills_in_paused_days(world, monkeypatch):
    """
    THE compare-and-set case, made deterministic. A worker reads the series,
    then — while it is creating that day's copies — a leader pauses and resumes.
    Resume jumps past the paused days on purpose. The worker's write is now
    stale; without the compare-and-set on next_index it would rewind the series
    to before the paused days, and the next run would create copies for days
    the leader paused (nothing de-duplicates those — they never existed).
    """
    w, s = world, world["s"]
    r = await start(w, count=10, assignees=[s["asha"]])
    sid = ObjectId(r.json()["data"]["series"]["id"])
    real_spawn = rec._spawn_occurrence
    fired = {"done": False}

    async def spawn_then_pause_and_resume(db, series, copy_no, occ, actor):
        out = await real_spawn(db, series, copy_no, occ, actor)
        if not fired["done"]:
            fired["done"] = True
            await db["recurring_tasks"].update_one({"_id": sid}, {"$set": {"status": "paused"}})
            w["clock"].today = date(2026, 10, 14)          # leader comes back four days later
            await rec.resume_series(db, await db["recurring_tasks"].find_one({"_id": sid}))
        return out

    monkeypatch.setattr(rec, "_spawn_occurrence", spawn_then_pause_and_resume)
    w["clock"].today = date(2026, 10, 10)
    await rec.advance_series(w["db"], sid)                 # the run that gets interrupted
    await rec.run_due(w["db"])                             # a later tick on the 14th
    dates = [c["recurrence"]["date"] for c in await copies(w, str(sid))]
    assert dates == ["2026-10-09", "2026-10-10", "2026-10-14"], \
        f"paused days were filled in: {dates}"


async def test_two_workers_catching_up_at_once_keep_the_count_exact(world):
    """
    Several missed days due at once, eight workers racing on four connections.
    Copies must stay one-per-person-per-day and the count exact. (This holds
    even without the compare-and-set, because each write is derived from the
    state that worker read — a stale rewind just re-walks days whose copies
    already exist. The test guards the end-to-end result.)
    """
    w = world
    r = await start(w, count=12, assignees=[w["s"]["asha"], w["s"]["mira"]])
    sid = ObjectId(r.json()["data"]["series"]["id"])
    w["clock"].today = date(2026, 10, 16)                      # 10th–16th all due at once
    clients = [AsyncIOMotorClient(settings.mongodb_url) for _ in range(3)]
    try:
        dbs = [w["db"]] + [c[w["name"]] for c in clients]
        for _ in range(3):                                     # several rounds of 8 racing workers
            await asyncio.gather(*[rec.advance_series(d, sid) for d in dbs],
                                 *[rec.run_due(d) for d in dbs])
    finally:
        for c in clients:
            c.close()
    docs = await copies(w, str(sid))
    dates = sorted({d["recurrence"]["date"] for d in docs})
    assert dates == [f"2026-10-{d:02d}" for d in range(9, 17)], dates
    assert len(docs) == 2 * 8, "one copy per person per day"
    series = await w["db"]["recurring_tasks"].find_one({"_id": sid})
    assert series["occurrences_done"] == 8, f"count inflated to {series['occurrences_done']}"
    assert series["next_index"] == 8 and series["next_date"] == "2026-10-17"
    assert series["status"] == "active", "must not end early"
    assert sorted({d["recurrence"]["index"] for d in docs}) == list(range(1, 9))


async def test_weekly_repeats_on_the_same_weekday(world):
    w = world
    r = await start(w, frequency="weekly", count=3, assignees=[w["s"]["asha"]])
    sid = r.json()["data"]["series"]["id"]
    for d in range(10, 31):                                   # every day for three weeks
        w["clock"].today = date(2026, 10, d)
        await rec.run_due(w["db"])
    dates = [c["recurrence"]["date"] for c in await copies(w, sid)]
    assert dates == ["2026-10-09", "2026-10-16", "2026-10-23"]
    assert all(date.fromisoformat(x).weekday() == 4 for x in dates)


async def test_monthly_31st_through_a_leap_february(world):
    w = world
    w["clock"].today = date(2028, 1, 31)
    r = await start(w, frequency="monthly", count=4, assignees=[w["s"]["asha"]])
    sid = r.json()["data"]["series"]["id"]
    for d in (date(2028, 2, 29), date(2028, 3, 31), date(2028, 4, 30)):
        w["clock"].today = d
        await rec.run_due(w["db"])
    assert [c["recurrence"]["date"] for c in await copies(w, sid)] == [
        "2028-01-31", "2028-02-29", "2028-03-31", "2028-04-30"]


async def test_until_stopped_keeps_going(world):
    w = world
    r = await start(w, count=None, assignees=[w["s"]["asha"]])
    sid = ObjectId(r.json()["data"]["series"]["id"])
    for d in range(10, 25):
        w["clock"].today = date(2026, 10, d)
        await rec.run_due(w["db"])
    s = await w["db"]["recurring_tasks"].find_one({"_id": sid})
    assert s["status"] == "active" and s["occurrences_done"] == 16 and s["next_date"] == "2026-10-25"


async def test_downtime_catch_up_creates_missed_copies_with_correct_dates(world):
    w = world
    r = await start(w, count=10, assignees=[w["s"]["asha"]])
    sid = r.json()["data"]["series"]["id"]
    w["clock"].today = date(2026, 10, 13)                     # server was down 10th–12th
    assert await rec.run_due(w["db"]) == 4
    assert [c["recurrence"]["date"] for c in await copies(w, sid)] == [
        "2026-10-09", "2026-10-10", "2026-10-11", "2026-10-12", "2026-10-13"]


async def test_pause_resume_skips_paused_days_and_keeps_the_count(world):
    w, s = world, world["s"]
    r = await start(w, count=5, assignees=[s["asha"]])
    sid = r.json()["data"]["series"]["id"]
    p = await w["call"]("PATCH", f"/api/v1/projects/recurring/{sid}", "lead", json={"action": "pause"})
    assert p.status_code == 200 and p.json()["data"]["status"] == "paused"
    for d in range(10, 15):
        w["clock"].today = date(2026, 10, d)
        assert await rec.run_due(w["db"]) == 0, "paused: nothing created"
    w["clock"].today = date(2026, 10, 15)
    p = await w["call"]("PATCH", f"/api/v1/projects/recurring/{sid}", "lead", json={"action": "resume"})
    assert p.status_code == 200 and p.json()["data"]["status"] == "active"
    dates = [c["recurrence"]["date"] for c in await copies(w, sid)]
    assert dates == ["2026-10-09", "2026-10-15"], "paused days skipped, today's copy made on resume"
    assert [c["recurrence"]["index"] for c in await copies(w, sid)] == [1, 2], "skipped days don't count"


async def test_stop_ends_the_series(world):
    w = world
    r = await start(w, count=None, assignees=[w["s"]["asha"]])
    sid = r.json()["data"]["series"]["id"]
    p = await w["call"]("PATCH", f"/api/v1/projects/recurring/{sid}", "lead", json={"action": "stop"})
    assert p.json()["data"]["status"] == "stopped"
    w["clock"].today = date(2026, 10, 10)
    assert await rec.run_due(w["db"]) == 0
    p = await w["call"]("PATCH", f"/api/v1/projects/recurring/{sid}", "lead", json={"title": "New"})
    assert p.status_code == 409, "an ended series can't be edited"


async def test_edit_changes_future_copies_only(world):
    w, s = world, world["s"]
    r = await start(w, count=3, assignees=[s["asha"]])
    sid = r.json()["data"]["series"]["id"]
    p = await w["call"]("PATCH", f"/api/v1/projects/recurring/{sid}", "lead",
                        json={"title": "Renamed report", "assignees": [s["asha"], s["ravi"]]})
    assert p.status_code == 200
    w["clock"].today = date(2026, 10, 10)
    await rec.run_due(w["db"])
    c = await copies(w, sid)
    assert [x["title"] for x in c if x["recurrence"]["date"] == "2026-10-09"] == ["Daily report"]
    assert sorted(x["title"] for x in c if x["recurrence"]["date"] == "2026-10-10") == ["Renamed report"] * 2


async def test_creator_losing_rights_pauses_the_series(world):
    w, s = world, world["s"]
    r = await start(w, count=5, assignees=[s["asha"]])
    sid = ObjectId(r.json()["data"]["series"]["id"])
    await w["db"]["users"].update_one({"_id": w["U"]["lead"]},
                                      {"$set": {"role_id": str(w["roles"]["Employee"]["_id"])}})
    await w["db"]["teams"].update_one({"_id": ObjectId(w["t1"])},
                                      {"$set": {"members.0.role": "member"}})
    w["clock"].today = date(2026, 10, 10)
    assert await rec.run_due(w["db"]) == 0
    series = await w["db"]["recurring_tasks"].find_one({"_id": sid})
    assert series["status"] == "paused" and "no longer assign" in series["paused_reason"]


async def test_deactivated_assignee_is_skipped_others_continue(world):
    w, s = world, world["s"]
    r = await start(w, count=5, assignees=[s["asha"], s["mira"]])
    sid = ObjectId(r.json()["data"]["series"]["id"])
    await w["db"]["users"].update_one({"_id": w["U"]["mira"]}, {"$set": {"is_active": False}})
    w["clock"].today = date(2026, 10, 10)
    assert await rec.run_due(w["db"]) == 1
    series = await w["db"]["recurring_tasks"].find_one({"_id": sid})
    assert series["status"] == "active" and series["last_errors"][0]["user_id"] == s["mira"]
    await w["db"]["users"].update_one({"_id": w["U"]["asha"]}, {"$set": {"is_active": False}})
    w["clock"].today = date(2026, 10, 11)
    assert await rec.run_due(w["db"]) == 0
    series = await w["db"]["recurring_tasks"].find_one({"_id": sid})
    assert series["status"] == "paused", "nobody left to assign — pause instead of failing daily"


async def test_list_and_manage_permissions(world):
    w, s = world, world["s"]
    r = await start(w, count=3)
    sid = r.json()["data"]["series"]["id"]
    mine = await w["call"]("GET", "/api/v1/projects/recurring", "lead")
    assert [x["id"] for x in mine.json()["data"]] == [sid]
    assert [a["name"] for a in mine.json()["data"][0]["assignees"]] == ["Asha", "Mira"]
    other = await w["call"]("GET", "/api/v1/projects/recurring", "lead2")
    assert other.json()["data"] == [], "another team's leader doesn't see it"
    admin = await w["call"]("GET", "/api/v1/projects/recurring", "sa")
    assert [x["id"] for x in admin.json()["data"]] == [sid]
    deny = await w["call"]("PATCH", f"/api/v1/projects/recurring/{sid}", "lead2", json={"action": "pause"})
    assert deny.status_code == 403
    deny = await w["call"]("PATCH", f"/api/v1/projects/recurring/{sid}", "asha", json={"action": "stop"})
    assert deny.status_code == 403
    one = await w["call"]("GET", f"/api/v1/projects/recurring/{sid}", "asha")
    assert one.status_code == 200 and one.json()["data"]["can_manage"] is False


async def test_repeat_validation(world):
    w = world
    assert (await start(w, count=366)).status_code == 422
    assert (await start(w, frequency="monthly", count=37)).status_code == 422
    assert (await start(w, due_offset_days=61)).status_code == 422
    assert (await start(w, frequency="hourly")).status_code == 422
    assert await w["db"]["recurring_tasks"].count_documents({}) == 0


async def test_failed_first_copy_leaves_no_series(world):
    w, s = world, world["s"]
    r = await w["call"]("POST", "/api/v1/projects/batch", "lead",
                        json=body(w, assignees=[s["asha"]], approver_id=s["lead2"],
                                  repeat={"frequency": "daily", "count": 3}))
    assert r.status_code == 422 and "approver" in r.json()["message"].lower()
    assert await w["db"]["recurring_tasks"].count_documents({}) == 0
    assert await w["db"]["project_tasks"].count_documents({}) == 0


async def test_reading_one_series_is_limited_to_the_people_it_involves(world):
    w, s = world, world["s"]
    r = await w["call"]("POST", "/api/v1/projects/batch", "lead",
                        json=body(w, assignees=[s["asha"], s["mira"]], approver_id=s["ravi"],
                                  repeat={"frequency": "daily", "count": 3}))
    sid = r.json()["data"]["series"]["id"]
    get = lambda who: w["call"]("GET", f"/api/v1/projects/recurring/{sid}", who)
    for who in ("lead", "sa", "asha", "ravi"):        # creator, admin, assignee, approver of a copy
        assert (await get(who)).status_code == 200, who
    for who in ("lead2", "emp"):                      # another team's leader; a teammate it doesn't involve
        deny = await get(who)
        assert deny.status_code == 404, who
        assert deny.json()["message"] == "Repeating task not found."
    # Taken off future copies, Asha still holds today's — she can still read the series.
    await w["call"]("PATCH", f"/api/v1/projects/recurring/{sid}", "lead", json={"assignees": [s["mira"]]})
    assert (await get("asha")).status_code == 200


# ── Chosen weekday / day of the month ────────────────────────────────────────

def test_first_date_for_a_chosen_day():
    fri = date(2026, 10, 9)                                   # a Friday
    assert rec.first_date("weekly", fri, weekday=4) == fri, "today is that day"
    assert rec.first_date("weekly", fri, weekday=0) == date(2026, 10, 12), "next Monday"
    assert rec.first_date("weekly", fri, weekday=3) == date(2026, 10, 15), "Thursday has passed this week"
    assert rec.first_date("monthly", fri, month_day=9) == fri
    assert rec.first_date("monthly", fri, month_day=20) == date(2026, 10, 20)
    assert rec.first_date("monthly", fri, month_day=1) == date(2026, 11, 1), "the 1st has passed"
    assert rec.first_date("monthly", date(2027, 2, 10), month_day=31) == date(2027, 2, 28), "clamped to Feb"
    assert rec.first_date("daily", fri, weekday=2) == fri, "daily ignores a chosen day"


def test_month_day_survives_a_clamped_anchor():
    # Chosen 31st, started in February: the anchor is 28 Feb, later months must go back to the 31st.
    feb28 = date(2027, 2, 28)
    got = [rec.occurrence_date("monthly", feb28, i, 31) for i in range(4)]
    assert got == [date(2027, 2, 28), date(2027, 3, 31), date(2027, 4, 30), date(2027, 5, 31)]


async def test_weekly_on_a_chosen_day_starts_then(world):
    w = world                                                 # clock: Friday 9 Oct
    r = await start(w, frequency="weekly", count=3, weekday=0, assignees=[w["s"]["asha"]])
    assert r.status_code == 201
    body_ = r.json()
    assert body_["data"]["tasks"] == [] and "Mon 12 Oct" in body_["message"], "nothing today; says when"
    sid = body_["data"]["series"]["id"]
    assert body_["data"]["series"]["next_date"] == "2026-10-12"
    for d in range(10, 31):
        w["clock"].today = date(2026, 10, d)
        await rec.run_due(w["db"])
    dates = [c["recurrence"]["date"] for c in await copies(w, sid)]
    assert dates == ["2026-10-12", "2026-10-19", "2026-10-26"]
    assert all(date.fromisoformat(x).weekday() == 0 for x in dates)


async def test_monthly_on_a_chosen_date(world):
    w = world
    r = await start(w, frequency="monthly", count=4, month_day=31, assignees=[w["s"]["asha"]])
    sid = r.json()["data"]["series"]["id"]
    assert r.json()["data"]["series"]["month_day"] == 31
    d = date(2026, 10, 10)
    while d <= date(2027, 2, 1):
        w["clock"].today = d
        await rec.run_due(w["db"])
        d += timedelta(days=1)
    dates = [c["recurrence"]["date"] for c in await copies(w, sid)]
    assert dates == ["2026-10-31", "2026-11-30", "2026-12-31", "2027-01-31"]


async def test_chosen_day_today_creates_the_first_copy_now(world):
    w = world
    r = await start(w, frequency="weekly", count=2, weekday=4, assignees=[w["s"]["asha"]])   # Friday = today
    assert r.status_code == 201 and len(r.json()["data"]["tasks"]) == 1


async def test_chosen_day_validation(world):
    w = world
    assert (await start(w, frequency="weekly", weekday=7)).status_code == 422
    assert (await start(w, frequency="weekly", weekday=-1)).status_code == 422
    assert (await start(w, frequency="daily", weekday=1)).status_code == 422, "weekday is weekly only"
    assert (await start(w, frequency="monthly", month_day=32)).status_code == 422
    assert (await start(w, frequency="monthly", month_day=0)).status_code == 422
    assert (await start(w, frequency="weekly", month_day=5)).status_code == 422, "month_day is monthly only"
    assert (await start(w, frequency="weekly", weekday=True)).status_code == 422, "JSON true isn't Tuesday"
    assert (await start(w, frequency="weekly", weekday="3")).status_code == 422, "numbers only"
    assert await w["db"]["recurring_tasks"].count_documents({}) == 0


async def test_future_start_still_refuses_a_bad_approver(world):
    w, s = world, world["s"]
    r = await w["call"]("POST", "/api/v1/projects/batch", "lead",
                        json=body(w, assignees=[s["asha"]], approver_id=s["lead2"],
                                  repeat={"frequency": "weekly", "count": 3, "weekday": 0}))
    assert r.status_code == 422 and "approver" in r.json()["message"].lower()
    assert await w["db"]["recurring_tasks"].count_documents({}) == 0


async def test_resume_keeps_the_chosen_month_day(world):
    w = world
    r = await start(w, frequency="monthly", count=None, month_day=31, assignees=[w["s"]["asha"]])
    sid = r.json()["data"]["series"]["id"]
    await w["call"]("PATCH", f"/api/v1/projects/recurring/{sid}", "lead", json={"action": "pause"})
    w["clock"].today = date(2026, 11, 15)
    res = await w["call"]("PATCH", f"/api/v1/projects/recurring/{sid}", "lead", json={"action": "resume"})
    assert res.json()["data"]["next_date"] == "2026-11-30"


async def test_monthly_31st_started_in_february_returns_to_the_31st(world):
    w = world
    w["clock"].today = date(2027, 2, 10)
    r = await start(w, frequency="monthly", count=3, month_day=31, assignees=[w["s"]["asha"]],
                    )
    sid = r.json()["data"]["series"]["id"]
    d = date(2027, 2, 10)
    while d <= date(2027, 5, 1):
        w["clock"].today = d
        await rec.run_due(w["db"])
        d += timedelta(days=1)
    dates = [c["recurrence"]["date"] for c in await copies(w, sid)]
    assert dates == ["2027-02-28", "2027-03-31", "2027-04-30"], dates
