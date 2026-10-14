"""
Auto-approve — a team leader's own switch (app/services/auto_approve_service.py).

Covers: settings (default off, per leader, validation, who may), immediate and
delayed approval, "only new submissions", turning off, two leaders working
separately, Hold, manual action during the delay, resubmission, verifiers first
(and the hook on sign-off / rejection), named-approver tasks, a leader removed
from the team, two workers never approving twice, and Performance leaving
auto-approvals out of the leader's "time to approve".

Integration tests on a throwaway MongoDB database; the service clock is
controlled so delays can be walked through. Skips without Mongo.
"""
import asyncio
import secrets
from datetime import datetime, timedelta, timezone

import pytest
from bson import ObjectId
from httpx import ASGITransport, AsyncClient
from motor.motor_asyncio import AsyncIOMotorClient

from app.config import settings
from app.database import get_db
from app.main import app
from app.middleware.auth import get_current_user
from app.services import auto_approve_service as auto


class Clock:
    def __init__(self, t):
        self.t = t

    def __call__(self):
        return self.t

    def add(self, **kw):
        self.t = self.t + timedelta(**kw)


@pytest.fixture
async def world(monkeypatch):
    client = AsyncIOMotorClient(settings.mongodb_url, serverSelectionTimeoutMS=3000)
    try:
        await client.admin.command("ping")
    except Exception:
        client.close()
        pytest.skip("MongoDB not reachable — integration tests skipped")
    name = f"mediaerp_test_auto_{secrets.token_hex(4)}"
    db = client[name]
    import app.database as dbmod
    monkeypatch.setattr(dbmod, "_client", client)
    monkeypatch.setitem(settings.__dict__, "mongodb_db_name", name)

    clock = Clock(datetime.now(timezone.utc).replace(microsecond=0))
    monkeypatch.setattr(auto, "_now", clock)

    roles = {r: {"_id": ObjectId(), "role_name": r} for r in ("Team Leader", "Employee", "Super Admin")}
    await db["roles"].insert_many(list(roles.values()))
    people = {"lead": "Team Leader", "lead2": "Team Leader", "other": "Team Leader",
              "asha": "Employee", "mira": "Employee", "sa": "Super Admin"}
    U = {k: ObjectId() for k in people}
    await db["users"].insert_many([{"_id": U[k], "name": k.title(), "email": f"{k}@t.io", "status": "active",
                                    "role_id": str(roles[r]["_id"])} for k, r in people.items()])
    s = {k: str(v) for k, v in U.items()}
    T1 = {"_id": ObjectId(), "name": "T1", "members": [
        {"user_id": s["lead"], "role": "leader"}, {"user_id": s["lead2"], "role": "leader"},
        {"user_id": s["asha"], "role": "member"}, {"user_id": s["mira"], "role": "member"}]}
    T2 = {"_id": ObjectId(), "name": "T2", "members": [{"user_id": s["other"], "role": "leader"}]}
    await db["teams"].insert_many([T1, T2])

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

        yield {"db": db, "client": client, "name": name, "s": s, "t1": str(T1["_id"]), "clock": clock, "call": call}
    app.dependency_overrides.clear()
    await client.drop_database(name)
    client.close()


async def turn_on(w, who="lead", delay=0, on=True):
    r = await w["call"]("PUT", "/api/v1/auto-approve", who, json={"enabled": on, "delay_minutes": delay})
    assert r.status_code == 200, r.text
    return r.json()["data"]


async def submit_new(w, who="asha", title="Reel edit", **extra):
    """Leader creates a task for `who`; `who` starts and submits it. Returns the task id."""
    r = await w["call"]("POST", "/api/v1/projects", "lead", json={
        "title": title, "team_id": w["t1"], "assigned_to": w["s"][who], "due_date": "2026-12-31", **extra})
    assert r.status_code == 201, r.text
    tid = r.json()["data"]["id"]
    assert (await w["call"]("PUT", f"/api/v1/projects/{tid}", who, json={"status": "started"})).status_code == 200
    r = await w["call"]("PUT", f"/api/v1/projects/{tid}", who, json={"status": "pending_review", "caption": "Done"})
    assert r.status_code == 200, r.text
    return tid


async def doc(w, tid):
    return await w["db"]["project_tasks"].find_one({"_id": ObjectId(tid)})


def approvals(d):
    return [h for h in d.get("history") or [] if h.get("action") == "approved"]


# ── Settings ────────────────────────────────────────────────────────────────

async def test_settings_default_off_and_per_leader(world):
    w = world
    r = await w["call"]("GET", "/api/v1/auto-approve", "lead")
    d = r.json()["data"]
    assert d["enabled"] is False and d["delay_minutes"] == 0 and d["can_use"] is True
    assert [t["name"] for t in d["teams"]] == ["T1"]
    on = await turn_on(w, "lead", 30)
    assert on["enabled"] and on["delay_minutes"] == 30 and on["enabled_since"]
    # Only this leader: the other leader of the same team is still off.
    assert (await w["call"]("GET", "/api/v1/auto-approve", "lead2")).json()["data"]["enabled"] is False
    # Changing the delay keeps "since"; turning off clears it.
    again = await turn_on(w, "lead", 45)
    assert again["enabled_since"] == on["enabled_since"] and again["delay_minutes"] == 45
    off = await turn_on(w, "lead", 45, on=False)
    assert off["enabled"] is False and off["enabled_since"] is None


async def test_settings_who_and_validation(world):
    w = world
    r = await w["call"]("PUT", "/api/v1/auto-approve", "asha", json={"enabled": True, "delay_minutes": 0})
    assert r.status_code == 403, "an employee who leads nothing"
    assert (await w["call"]("GET", "/api/v1/auto-approve", "asha")).json()["data"]["can_use"] is False
    for bad in ({"enabled": True, "delay_minutes": -1}, {"enabled": True, "delay_minutes": 24 * 60 + 1},
                {"enabled": "yes", "delay_minutes": 0}, {"enabled": True, "delay_minutes": 1.5},
                {"enabled": True, "delay_minutes": "30"}, {"enabled": True, "delay_minutes": True}):
        r = await w["call"]("PUT", "/api/v1/auto-approve", "lead", json=bad)
        assert r.status_code == 422, (bad, r.status_code)
    assert (await w["call"]("PUT", "/api/v1/auto-approve", "lead",
                            json={"enabled": True, "delay_minutes": 24 * 60})).status_code == 200


# ── Approving ───────────────────────────────────────────────────────────────

async def test_off_by_default_nothing_happens(world):
    w = world
    tid = await submit_new(w)
    d = await doc(w, tid)
    assert d["status"] == "pending_review" and not d.get("auto_approvals")
    w["clock"].add(hours=5)
    assert await auto.run_due(w["db"]) == 0
    assert (await doc(w, tid))["status"] == "pending_review"


async def test_no_delay_approves_on_submission(world):
    w = world
    await turn_on(w, "lead", 0)
    tid = await submit_new(w)
    d = await doc(w, tid)
    assert d["status"] == "approved"
    a = approvals(d)
    assert len(a) == 1 and a[0]["actor_id"] == w["s"]["lead"] and a[0]["auto"] is True and a[0]["note"] == "Auto-approved"
    assert not d.get("auto_approvals"), "schedule cleared once approved"
    n = await w["db"]["notifications"].find_one({"user_id": {"$in": [w["s"]["asha"], ObjectId(w["s"]["asha"])]}, "type": "task_approved"})
    assert n, "the employee is told, as with a manual approval"


async def test_delay_waits_then_approves(world):
    w = world
    await turn_on(w, "lead", 30)
    t0 = w["clock"]()
    tid = await submit_new(w)
    d = await doc(w, tid)
    assert d["status"] == "pending_review"
    assert len(d["auto_approvals"]) == 1 and d["auto_approvals"][0]["delay_minutes"] == 30
    at = d["auto_approvals"][0]["at"].replace(tzinfo=timezone.utc)
    assert at == t0 + timedelta(minutes=30)
    w["clock"].add(minutes=29)
    assert await auto.run_due(w["db"]) == 0 and (await doc(w, tid))["status"] == "pending_review"
    w["clock"].add(minutes=1)
    assert await auto.run_due(w["db"]) == 1
    assert (await doc(w, tid))["status"] == "approved"


async def test_only_new_submissions_are_covered(world):
    w = world
    tid = await submit_new(w)                      # submitted while the switch was off
    w["clock"].add(minutes=5)
    await turn_on(w, "lead", 0)
    w["clock"].add(hours=1)
    assert await auto.run_due(w["db"]) == 0
    assert (await doc(w, tid))["status"] == "pending_review", "the backlog is never approved by surprise"


async def test_turning_off_before_it_fires(world):
    w = world
    await turn_on(w, "lead", 30)
    tid = await submit_new(w)
    await turn_on(w, "lead", 30, on=False)
    w["clock"].add(minutes=31)
    assert await auto.run_due(w["db"]) == 0
    d = await doc(w, tid)
    assert d["status"] == "pending_review" and not d.get("auto_approvals"), "the stale entry is dropped"
    # Turning it back on later does not revive it (only new submissions).
    await turn_on(w, "lead", 0)
    w["clock"].add(minutes=1)
    assert await auto.run_due(w["db"]) == 0


async def test_two_leaders_work_separately(world):
    w = world
    await turn_on(w, "lead", 30)
    await turn_on(w, "lead2", 120)
    tid = await submit_new(w)
    assert [e["delay_minutes"] for e in (await doc(w, tid))["auto_approvals"]] == [30, 120]
    w["clock"].add(minutes=30)
    assert await auto.run_due(w["db"]) == 1
    assert approvals(await doc(w, tid))[0]["actor_id"] == w["s"]["lead"], "the first due leader approves"

    # If the first leader switches off, the second one's timer still runs.
    tid2 = await submit_new(w, title="Second")
    await turn_on(w, "lead", 30, on=False)
    w["clock"].add(minutes=30)
    assert await auto.run_due(w["db"]) == 0
    w["clock"].add(minutes=90)
    assert await auto.run_due(w["db"]) == 1
    assert approvals(await doc(w, tid2))[0]["actor_id"] == w["s"]["lead2"]


async def test_hold_and_resume(world):
    w = world
    await turn_on(w, "lead", 10)
    tid = await submit_new(w)
    assert (await w["call"]("POST", f"/api/v1/auto-approve/hold/{tid}", "asha", json={"hold": True})).status_code == 403
    assert (await w["call"]("POST", f"/api/v1/auto-approve/hold/{tid}", "other", json={"hold": True})).status_code == 403
    r = await w["call"]("POST", f"/api/v1/auto-approve/hold/{tid}", "lead2", json={"hold": True})
    assert r.status_code == 200, "any leader of the team may hold it"
    w["clock"].add(minutes=60)
    assert await auto.run_due(w["db"]) == 0 and (await doc(w, tid))["status"] == "pending_review"
    assert (await w["call"]("POST", f"/api/v1/auto-approve/hold/{tid}", "lead", json={"hold": False})).status_code == 200
    assert await auto.run_due(w["db"]) == 1 and (await doc(w, tid))["status"] == "approved"
    r = await w["call"]("POST", f"/api/v1/auto-approve/hold/{tid}", "lead", json={"hold": True})
    assert r.status_code == 409, "only while it waits for approval"


async def test_manual_reedit_ends_it_and_resubmission_restarts_the_timer(world):
    w = world
    await turn_on(w, "lead", 30)
    tid = await submit_new(w)
    w["clock"].add(minutes=10)
    r = await w["call"]("PUT", f"/api/v1/projects/{tid}", "lead", json={"status": "reedit", "reedit_reason": "Fix the intro"})
    assert r.status_code == 200, r.text
    assert not (await doc(w, tid)).get("auto_approvals")
    assert (await w["call"]("PUT", f"/api/v1/projects/{tid}", "asha", json={"status": "started"})).status_code == 200
    resubmitted_at = w["clock"]()
    assert (await w["call"]("PUT", f"/api/v1/projects/{tid}", "asha",
                            json={"status": "pending_review", "caption": "Fixed"})).status_code == 200
    at = (await doc(w, tid))["auto_approvals"][0]["at"].replace(tzinfo=timezone.utc)
    assert at == resubmitted_at + timedelta(minutes=30), "a fresh 30 minutes from the resubmission"


async def test_manual_approval_during_the_delay(world):
    w = world
    await turn_on(w, "lead", 30)
    tid = await submit_new(w)
    assert (await w["call"]("PUT", f"/api/v1/projects/{tid}", "lead2", json={"status": "approved"})).status_code == 200
    w["clock"].add(minutes=31)
    assert await auto.run_due(w["db"]) == 0
    a = approvals(await doc(w, tid))
    assert len(a) == 1 and not a[0].get("auto"), "approved once, by hand"


async def test_verifiers_first_then_approved_on_sign_off(world):
    w = world
    await turn_on(w, "lead", 0)
    tid = await submit_new(w, verify_users=[w["s"]["mira"]])
    d = await doc(w, tid)
    assert d["status"] == "pending_review" and d["auto_approvals"], "waits for the verifier"
    w["clock"].add(minutes=5)
    assert await auto.run_due(w["db"]) == 0
    r = await w["call"]("POST", f"/api/v1/verify/{tid}", "mira", json={"passed": True})
    assert r.status_code == 200, r.text
    assert (await doc(w, tid))["status"] == "approved", "approved as soon as the last verifier signs off"


async def test_verifier_rejection_ends_the_schedule(world):
    w = world
    await turn_on(w, "lead", 30)
    tid = await submit_new(w, verify_users=[w["s"]["mira"]])
    r = await w["call"]("POST", f"/api/v1/verify/{tid}", "mira", json={"passed": False, "reason": "Wrong logo"})
    assert r.status_code == 200, r.text
    d = await doc(w, tid)
    assert d["status"] == "reedit" and not d.get("auto_approvals")


async def test_named_approver_tasks_are_covered_too(world):
    w = world
    await turn_on(w, "lead", 0)
    tid = await submit_new(w, approver_id=w["s"]["mira"], approver_name="Mira")
    assert (await doc(w, tid))["status"] == "approved"


async def test_leader_removed_from_team_before_it_fires(world):
    w = world
    await turn_on(w, "lead", 30)
    tid = await submit_new(w)
    await w["db"]["teams"].update_one({"_id": ObjectId(w["t1"]), "members.user_id": w["s"]["lead"]},
                                      {"$set": {"members.$.role": "member"}})
    w["clock"].add(minutes=31)
    assert await auto.run_due(w["db"]) == 0
    assert (await doc(w, tid))["status"] == "pending_review"


async def test_two_workers_never_approve_twice(world):
    w = world
    await turn_on(w, "lead", 15)
    ids = [await submit_new(w, title=f"T{i}") for i in range(4)]
    w["clock"].add(minutes=16)
    db2 = w["client"][w["name"]]
    results = await asyncio.gather(auto.run_due(w["db"]), auto.run_due(db2),
                                   auto.try_auto_approve(w["db"], ids[0]), auto.try_auto_approve(db2, ids[0]))
    assert results[0] + results[1] + results[2] + results[3] == 4
    for tid in ids:
        d = await doc(w, tid)
        assert d["status"] == "approved" and len(approvals(d)) == 1, tid


async def test_performance_leaves_auto_approvals_out_of_time_to_approve(world):
    w = world
    await turn_on(w, "lead", 0)
    auto_tid = await submit_new(w, title="Auto one")
    await turn_on(w, "lead", 0, on=False)
    manual_tid = await submit_new(w, title="Manual one")
    assert (await w["call"]("PUT", f"/api/v1/projects/{manual_tid}", "lead", json={"status": "approved"})).status_code == 200
    r = await w["call"]("GET", "/api/v1/performance/tasks", "sa", params={"user_id": w["s"]["lead"], "role": "approver"})
    assert r.status_code == 200, r.text
    rows = r.json()["data"]
    rows = rows if isinstance(rows, list) else (rows.get("tasks") or rows.get("items") or rows.get("rows") or [])
    titles = {x["title"] for x in rows}
    assert "Manual one" in titles and "Auto one" not in titles
    # The employee's own on-time / completed numbers still count it.
    r = await w["call"]("GET", "/api/v1/performance/tasks", "sa", params={"user_id": w["s"]["asha"], "role": "member"})
    rows = r.json()["data"]
    rows = rows if isinstance(rows, list) else (rows.get("tasks") or rows.get("items") or rows.get("rows") or [])
    assert {"Auto one", "Manual one"} <= {x["title"] for x in rows}
    assert (await doc(w, auto_tid))["status"] == "approved"


async def test_task_payload_shows_the_schedule(world):
    w = world
    await turn_on(w, "lead", 30)
    tid = await submit_new(w)
    r = await w["call"]("GET", f"/api/v1/projects/{tid}", "lead")
    t = r.json()["data"]
    e = t["auto_approvals"][0]
    assert e["leader_name"] == "Lead" and e["delay_minutes"] == 30 and e["at"].endswith("+00:00")
    assert "auto_approve_claim" not in t


async def test_held_task_is_not_approved_by_the_verifier_sign_off(world):
    w = world
    await turn_on(w, "lead", 0)
    tid = await submit_new(w, verify_users=[w["s"]["mira"]])
    assert (await w["call"]("POST", f"/api/v1/auto-approve/hold/{tid}", "lead", json={"hold": True})).status_code == 200
    w["clock"].add(minutes=5)
    assert (await w["call"]("POST", f"/api/v1/verify/{tid}", "mira", json={"passed": True})).status_code == 200
    assert (await doc(w, tid))["status"] == "pending_review", "Hold wins over the sign-off hook"
    assert await auto.try_auto_approve(w["db"], tid) is False


async def test_team_report_counts_only_manual_approvals_for_the_leader(world):
    w = world
    await turn_on(w, "lead", 0)
    await submit_new(w, title="Auto A")
    await submit_new(w, title="Auto B")
    await turn_on(w, "lead", 0, on=False)
    manual = await submit_new(w, title="Manual")
    assert (await w["call"]("PUT", f"/api/v1/projects/{manual}", "lead", json={"status": "approved"})).status_code == 200
    r = await w["call"]("GET", "/api/v1/performance", "sa")
    assert r.status_code == 200, r.text
    team = next(t for t in r.json()["data"]["teams"] if t.get("team_id") == w["t1"] or t.get("id") == w["t1"]
                or t.get("name") == "T1" or t.get("team_name") == "T1")
    lead_row = next(a for a in team["approvers"] if a.get("user_id") == w["s"]["lead"])
    assert lead_row["approvals"] == 1, lead_row
    member = next(m for m in team["members"] if m.get("user_id") == w["s"]["asha"])
    assert member["completed"] == 3, "the employee's work still counts"


async def test_detail_history_says_it_was_automatic(world):
    w = world
    await turn_on(w, "lead", 0)
    tid = await submit_new(w)
    h = (await w["call"]("GET", f"/api/v1/projects/{tid}", "lead")).json()["data"]["history"]
    a = [x for x in h if x["action"] == "approved"]
    assert len(a) == 1 and a[0].get("auto") is True and a[0]["note"] == "Auto-approved"
    # Ordinary history rows don't grow an `auto` key.
    assert all("auto" not in x for x in h if x["action"] != "approved")


async def test_background_loop_runs_in_the_server_loop(world, monkeypatch):
    """run_forever approves due work on its own (the live path), then can be cancelled."""
    w = world
    monkeypatch.setattr(auto, "POLL_SECONDS", 0.05)
    await turn_on(w, "lead", 5)
    tid = await submit_new(w)
    w["clock"].add(minutes=6)
    task = asyncio.create_task(auto.run_forever(w["db"]))
    for _ in range(60):
        if (await doc(w, tid))["status"] == "approved":
            break
        await asyncio.sleep(0.05)
    task.cancel()
    assert (await doc(w, tid))["status"] == "approved"


async def test_submit_reply_carries_the_timer(world):
    """The employee's screen shows "approved around H:MM" straight from the submit reply."""
    w = world
    await turn_on(w, "lead", 30)
    r = await w["call"]("POST", "/api/v1/projects", "lead", json={
        "title": "Reply", "team_id": w["t1"], "assigned_to": w["s"]["asha"], "due_date": "2026-12-31"})
    tid = r.json()["data"]["id"]
    await w["call"]("PUT", f"/api/v1/projects/{tid}", "asha", json={"status": "started"})
    t = (await w["call"]("PUT", f"/api/v1/projects/{tid}", "asha", json={"status": "pending_review", "caption": "Done"})).json()["data"]
    assert t["status"] == "pending_review"
    assert [e["delay_minutes"] for e in t["auto_approvals"]] == [30] and t["auto_approvals"][0]["at"].endswith("+00:00")
    assert "auto_approve_claim" not in t


async def test_turning_off_removes_only_my_timers_at_once(world):
    """No card keeps saying "Auto-approves in 24 min" after the leader switched off."""
    w = world
    await turn_on(w, "lead", 30)
    await turn_on(w, "lead2", 120)
    tid = await submit_new(w)
    only_mine = await submit_new(w, title="Second")
    await turn_on(w, "lead2", 120, on=False)
    await turn_on(w, "lead", 30, on=False)
    await turn_on(w, "lead2", 120)            # lead2 back on — its old timers stay gone
    for t in (tid, only_mine):
        d = await doc(w, t)
        assert d["status"] == "pending_review"
        assert "auto_approvals" not in d and "auto_approve_submitted_at" not in d
    r = await w["call"]("GET", f"/api/v1/projects/{tid}", "lead")
    assert not r.json()["data"].get("auto_approvals")


async def test_turning_off_keeps_the_other_leaders_timer(world):
    w = world
    await turn_on(w, "lead", 30)
    await turn_on(w, "lead2", 120)
    tid = await submit_new(w)
    await turn_on(w, "lead", 30, on=False)
    assert [e["delay_minutes"] for e in (await doc(w, tid))["auto_approvals"]] == [120]
    w["clock"].add(minutes=120)
    assert await auto.run_due(w["db"]) == 1
    assert approvals(await doc(w, tid))[0]["actor_id"] == w["s"]["lead2"]
