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

    roles = {r: {"_id": ObjectId(), "role_name": r, "is_system_role": True} for r in ("Team Leader", "Employee", "Admin", "Coordinator")}
    await db["roles"].insert_many(list(roles.values()))
    people = {"lead": "Team Leader", "emp": "Employee", "emp2": "Employee", "admin": "Admin", "coord": "Coordinator"}
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


# ── Managing the list (admin roles) ──────────────────────────────────────────

M = "/api/v1/task-projects"


async def test_only_admin_roles_manage_the_list(w):
    call = w["call"]
    pid = (await projects(w))[0]["id"]
    for who in ("lead", "emp"):
        assert (await call("GET", M, who, params={"manage": 1})).status_code == 403
        assert (await call("POST", M, who, json={"name": "X", "platform": "meta"})).status_code == 403
        assert (await call("PATCH", f"{M}/{pid}", who, json={"name": "X"})).status_code == 403
        assert (await call("DELETE", f"{M}/{pid}", who)).status_code == 403
        assert (await call("PUT", f"{M}/order", who, json={"ids": []})).status_code == 403
    for who in ("admin", "coord"):
        assert (await call("GET", M, who, params={"manage": 1})).status_code == 200
    assert len(await projects(w)) == 12, "nothing changed"


async def test_add_with_validation_and_no_duplicates(w):
    call = w["call"]
    r = await call("POST", M, "admin", json={"name": "  DELTA   TIKTOK  ", "platform": "other"})
    assert r.status_code == 201, r.text
    d = r.json()["data"]
    assert d["name"] == "DELTA TIKTOK" and d["platform"] == "other" and d["group"] == 3 and d["tasks"] == 0
    names = [p["name"] for p in await projects(w)]
    assert names[-1] == "DELTA TIKTOK", "added at the end of the last group"
    assert (await call("POST", M, "admin", json={"name": "delta tiktok"})).status_code == 409, "case-insensitive duplicate"
    for bad in ({"name": ""}, {"name": "   "}, {"name": "x" * 121}, {"name": "A", "platform": "myspace"},
                {"name": "A", "group": 0}, {"name": "A", "group": True}, {"name": "A", "group": 99}):
        assert (await call("POST", M, "admin", json=bad)).status_code == 422, bad
    r = await call("POST", M, "admin", json={"name": "Fresh group", "group": 4})
    assert r.status_code == 201 and r.json()["data"]["group"] == 4


async def test_rename_follows_on_tasks_and_platform_group_change(w):
    call = w["call"]
    p = (await projects(w))[0]
    tid = (await call("POST", "/api/v1/projects", "lead", json=body(w, project_id=p["id"]))).json()["data"]["id"]
    r = await call("PATCH", f"{M}/{p['id']}", "admin", json={"name": "DELTA DIGITAL DUBAI (META ADS)"})
    assert r.status_code == 200 and r.json()["data"]["tasks"] == 1
    task = (await call("GET", f"/api/v1/projects/{tid}", "lead")).json()["data"]
    assert task["project_name"] == "DELTA DIGITAL DUBAI (META ADS)", "the task shows the corrected name"
    taken = (await projects(w))[1]["name"]
    assert (await call("PATCH", f"{M}/{p['id']}", "admin", json={"name": taken.lower()})).status_code == 409
    r = await call("PATCH", f"{M}/{p['id']}", "admin", json={"platform": "google", "group": 2})
    assert r.json()["data"]["platform"] == "google" and r.json()["data"]["group"] == 2
    assert (await call("PATCH", f"{M}/nope", "admin", json={"name": "Q"})).status_code == 404
    assert (await call("PATCH", f"{M}/{ObjectId()}", "admin", json={"name": "Q"})).status_code == 404


async def test_delete_archives_old_tasks_keep_it_and_restore_brings_it_back(w):
    call, db = w["call"], w["db"]
    p = (await projects(w))[5]
    tid = (await call("POST", "/api/v1/projects", "lead", json=body(w, project_id=p["id"]))).json()["data"]["id"]
    r = await call("DELETE", f"{M}/{p['id']}", "admin")
    assert r.status_code == 200 and r.json()["data"]["active"] is False
    assert p["id"] not in [x["id"] for x in await projects(w)], "gone from the picker"
    task = (await call("GET", f"/api/v1/projects/{tid}", "lead")).json()["data"]
    assert task["project_name"] == p["name"], "existing tasks keep their project"
    assert (await call("POST", "/api/v1/projects", "lead", json=body(w, project_id=p["id"]))).status_code == 422,         "a deleted project can't be chosen for new work"
    mgr = (await call("GET", M, "admin", params={"manage": 1})).json()["data"]
    row = next(x for x in mgr if x["id"] == p["id"])
    assert row["active"] is False and row["tasks"] == 1
    assert await tps.ensure_seed(db) == 0
    assert p["id"] not in [x["id"] for x in await projects(w)], "a restart's seed doesn't bring it back"
    r = await call("PATCH", f"{M}/{p['id']}", "admin", json={"active": True})
    assert r.status_code == 200 and p["id"] in [x["id"] for x in await projects(w)]


async def test_restore_refuses_a_name_clash(w):
    call = w["call"]
    p = (await projects(w))[0]
    await call("DELETE", f"{M}/{p['id']}", "admin")
    assert (await call("POST", M, "admin", json={"name": p["name"]})).status_code == 201, "the name is free once deleted"
    assert (await call("PATCH", f"{M}/{p['id']}", "admin", json={"active": True})).status_code == 409


async def test_reorder(w):
    call = w["call"]
    ids = [p["id"] for p in await projects(w)]
    new = [ids[1], ids[0]] + ids[2:]
    r = await call("PUT", f"{M}/order", "admin", json={"ids": new})
    assert r.status_code == 200
    assert [p["id"] for p in await projects(w)] == new
    for bad in (ids[:-1], ids + [ids[0]], ids[:-1] + [str(ObjectId())]):
        assert (await call("PUT", f"{M}/order", "admin", json={"ids": bad})).status_code == 409, "stale / partial list"


async def test_simultaneous_adds_and_renames_never_make_duplicates(w):
    """Found in QA: 8 admins adding one name at the same instant made 6 copies (check-then-insert)."""
    call, db = w["call"], w["db"]
    rs = await asyncio.gather(*[call("POST", M, ("admin", "coord")[i % 2], json={"name": "Same Name"}) for i in range(8)])
    assert sorted(r.status_code for r in rs).count(201) == 1, [r.status_code for r in rs]
    assert await db[tps.COLLECTION].count_documents({"name_key": "same name", "active": True}) == 1
    a = (await call("POST", M, "admin", json={"name": "Left"})).json()["data"]["id"]
    b = (await call("POST", M, "admin", json={"name": "Right"})).json()["data"]["id"]
    rs = await asyncio.gather(*[call("PATCH", f"{M}/{(a, b)[i % 2]}", "admin", json={"name": "Both"}) for i in range(6)])
    assert await db[tps.COLLECTION].count_documents({"name_key": "both", "active": True}) == 1, [r.status_code for r in rs]
    # Archived names don't block: delete one, add it again, then restoring the old one is refused.
    await call("DELETE", f"{M}/{a}", "admin")
    await call("PATCH", f"{M}/{b}", "admin", json={"name": "Again"})
    old = (await db[tps.COLLECTION].find_one({"_id": ObjectId(a)}))["name"]
    assert (await call("POST", M, "admin", json={"name": old})).status_code == 201
    assert (await call("PATCH", f"{M}/{a}", "admin", json={"active": True})).status_code == 409


async def test_seed_backfills_name_keys_for_older_rows(w):
    db = w["db"]
    await db[tps.COLLECTION].drop_index("unique_active_name")      # as a database from before this change
    await db[tps.COLLECTION].update_many({}, {"$unset": {"name_key": ""}})
    await tps.ensure_seed(db)
    assert "unique_active_name" in await db[tps.COLLECTION].index_information()
    assert await db[tps.COLLECTION].count_documents({"name_key": {"$exists": False}}) == 0
