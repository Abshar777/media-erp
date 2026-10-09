"""
Task projects — the optional "Project" (ad account) on a task.

Seeding, the list endpoint, and the project travelling through every way a task
is created (single, several people, repeating) and edited. Throwaway MongoDB
database, created and dropped here; skips when Mongo is down.
"""
import asyncio
import secrets

import pytest
from bson import ObjectId
from httpx import ASGITransport, AsyncClient
from motor.motor_asyncio import AsyncIOMotorClient

from app.config import settings
from app.database import get_db
from app.main import app
from app.middleware.auth import get_current_user
from app.services import task_project_service as tps
from app.utils.timezone import today_ist

P = "/api/v1/projects"


@pytest.fixture
async def w(monkeypatch):
    client = AsyncIOMotorClient(settings.mongodb_url, serverSelectionTimeoutMS=3000)
    try:
        await client.admin.command("ping")
    except Exception:
        client.close()
        pytest.skip("MongoDB not reachable — integration tests skipped")
    name = f"mediaerp_test_tproj_{secrets.token_hex(4)}"
    db = client[name]
    import app.database as dbmod
    monkeypatch.setattr(dbmod, "_client", client)
    monkeypatch.setitem(settings.__dict__, "mongodb_db_name", name)

    roles = {r: {"_id": ObjectId(), "role_name": r, "is_system_role": True} for r in ("Team Leader", "Employee")}
    await db["roles"].insert_many(list(roles.values()))
    people = {"lead": "Team Leader", "emp": "Employee", "emp2": "Employee"}
    U = {k: ObjectId() for k in people}
    s = {k: str(v) for k, v in U.items()}
    await db["users"].insert_many([{"_id": U[k], "name": k.title(), "email": f"{k}@t.io", "is_active": True,
                                    "role_id": str(roles[r]["_id"])} for k, r in people.items()])
    team = {"_id": ObjectId(), "name": "Marketing", "members": [
        {"user_id": s["lead"], "role": "leader"}, {"user_id": s["emp"], "role": "member"},
        {"user_id": s["emp2"], "role": "member"}]}
    await db["teams"].insert_one(team)
    await tps.ensure_seed(db)

    def as_user(k):
        async def _u():
            r = roles[people[k]]
            return {"_id": U[k], "name": k.title(), "email": f"{k}@t.io", "role_id": str(r["_id"]), "_role": r}
        return _u

    app.dependency_overrides[get_db] = lambda: db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as ac:
        async def call(method, path, who, **kw):
            app.dependency_overrides[get_current_user] = as_user(who)
            return await ac.request(method, path, **kw)
        yield {"db": db, "s": s, "team": str(team["_id"]), "call": call}
    app.dependency_overrides.clear()
    await asyncio.sleep(0.2)               # let fire-and-forget notifications finish
    await client.drop_database(name)
    client.close()


async def projects(w, who="emp"):
    r = await w["call"]("GET", "/api/v1/task-projects", who)
    assert r.status_code == 200, r.text
    return r.json()["data"]


def body(w, **kw):
    return {"title": "Edit the reel", "team_id": w["team"], "assigned_to": w["s"]["emp"],
            "due_date": today_ist().isoformat(), **kw}


async def test_seed_is_complete_ordered_and_idempotent(w):
    db = w["db"]
    got = await projects(w)
    assert [p["name"] for p in got] == [name for _, name, _, _ in tps.SEED], "all 12, in the given order"
    assert [p["group"] for p in got] == [1] * 6 + [2] * 4 + [3] * 2
    assert {p["platform"] for p in got} == {"meta", "google", "snapchat"}
    assert await tps.ensure_seed(db) == 0, "a second run adds nothing"
    # A rename or archive in the database survives a restart's seed.
    first = got[0]["id"]
    await db[tps.COLLECTION].update_one({"_id": ObjectId(first)}, {"$set": {"name": "Renamed"}})
    await db[tps.COLLECTION].update_one({"_id": ObjectId(got[1]["id"])}, {"$set": {"active": False}})
    assert await tps.ensure_seed(db) == 0
    now = await projects(w)
    assert now[0]["name"] == "Renamed" and len(now) == 11


async def test_a_task_with_and_without_a_project(w):
    call, db = w["call"], w["db"]
    meta = (await projects(w))[0]
    r = await call("POST", P, "lead", json=body(w, project_id=meta["id"]))
    assert r.status_code == 201, r.text
    t = r.json()["data"]
    assert t["project_id"] == meta["id"] and t["project_name"] == meta["name"]

    r = await call("POST", P, "lead", json=body(w))
    assert r.status_code == 201
    plain = await db["project_tasks"].find_one({"_id": ObjectId(r.json()["data"]["id"])})
    assert "project_id" not in plain and "project_name" not in plain, "no project = the old document shape"
    for blank in ("", None):
        assert (await call("POST", P, "lead", json=body(w, project_id=blank))).status_code == 201


async def test_a_bad_project_is_refused_and_the_name_never_comes_from_the_request(w):
    call = w["call"]
    for bad in ("nope", str(ObjectId())):
        r = await call("POST", P, "lead", json=body(w, project_id=bad))
        assert r.status_code == 422, (bad, r.text)
    pid = (await projects(w))[3]["id"]
    await w["db"][tps.COLLECTION].update_one({"_id": ObjectId(pid)}, {"$set": {"active": False}})
    assert (await call("POST", P, "lead", json=body(w, project_id=pid))).status_code == 422, "archived"
    good = (await projects(w))[0]
    r = await call("POST", P, "lead", json={**body(w, project_id=good["id"]), "project_name": "Spoofed"})
    assert r.json()["data"]["project_name"] == good["name"]


async def test_an_employee_can_pick_a_project_for_their_own_task(w):
    p = (await projects(w, "emp"))[4]
    r = await w["call"]("POST", P, "emp", json=body(w, assigned_to=w["s"]["emp"], project_id=p["id"]))
    assert r.status_code == 201 and r.json()["data"]["project_name"] == p["name"]


async def test_several_people_and_repeating_copies_carry_the_project(w):
    call, s, db = w["call"], w["s"], w["db"]
    p = (await projects(w))[2]
    r = await call("POST", f"{P}/batch", "lead", json={**body(w, project_id=p["id"]), "assignees": [s["emp"], s["emp2"]]})
    assert r.status_code == 201, r.text
    tasks = r.json()["data"]["tasks"]
    assert len(tasks) == 2 and all(t["project_id"] == p["id"] and t["project_name"] == p["name"] for t in tasks)

    r = await call("POST", f"{P}/batch", "lead", json={**body(w, project_id=p["id"], due_date=None),
                                                      "assignees": [s["emp"]], "repeat": {"frequency": "daily", "count": 3}})
    assert r.status_code == 201, r.text
    copies = r.json()["data"]["tasks"]
    assert copies and all(t["project_name"] == p["name"] for t in copies)
    series = await db["recurring_tasks"].find_one({})
    assert series["project_id"] == p["id"], "future copies get it too"

    bad = await call("POST", f"{P}/batch", "lead", json={**body(w, project_id="nope"), "assignees": [s["emp"], s["emp2"]]})
    assert bad.status_code == 422 and await db["project_tasks"].count_documents({"title": "Edit the reel"}) == 3


async def test_edit_sets_changes_and_clears_the_project(w):
    call = w["call"]
    a, b = (await projects(w))[:2]
    tid = (await call("POST", P, "lead", json=body(w))).json()["data"]["id"]
    r = await call("PUT", f"{P}/{tid}", "lead", json={"project_id": a["id"]})
    assert r.status_code == 200 and r.json()["data"]["project_name"] == a["name"]
    r = await call("PUT", f"{P}/{tid}", "lead", json={"project_id": b["id"], "title": "Renamed task"})
    d = r.json()["data"]
    assert d["project_name"] == b["name"] and d["title"] == "Renamed task"
    r = await call("PUT", f"{P}/{tid}", "lead", json={"title": "Only the title"})
    assert r.json()["data"]["project_id"] == b["id"], "an edit that doesn't mention it leaves it alone"
    r = await call("PUT", f"{P}/{tid}", "lead", json={"project_id": ""})
    assert r.status_code == 200 and not r.json()["data"]["project_id"] and not r.json()["data"]["project_name"]
    assert (await call("PUT", f"{P}/{tid}", "lead", json={"project_id": "nope"})).status_code == 422


async def test_the_list_needs_a_signed_in_user(w):
    app.dependency_overrides.pop(get_current_user, None)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as ac:
        assert (await ac.get("/api/v1/task-projects")).status_code in (401, 403)
