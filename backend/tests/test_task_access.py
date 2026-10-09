"""
Who may view, edit and delete a single task.

Found in QA (2026-10-09): any signed-in user could rename, re-status or DELETE
any task by its id — only viewing was checked. Now:
  view / edit — admin roles, the assignee, the creator, members of its team
  delete      — admin roles, the creator, leaders of its team
Throwaway MongoDB database; skips when Mongo is down.
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
from app.utils.timezone import today_ist

P = "/api/v1/projects"
ROLE = {"admin": "Admin", "lead": "Team Leader", "creator": "Employee", "assignee": "Employee",
        "mate": "Employee", "otherlead": "Team Leader", "outsider": "Employee"}


@pytest.fixture
async def w(monkeypatch):
    client = AsyncIOMotorClient(settings.mongodb_url, serverSelectionTimeoutMS=3000)
    try:
        await client.admin.command("ping")
    except Exception:
        client.close()
        pytest.skip("MongoDB not reachable — integration tests skipped")
    name = f"mediaerp_test_taccess_{secrets.token_hex(4)}"
    db = client[name]
    import app.database as dbmod
    monkeypatch.setattr(dbmod, "_client", client)
    monkeypatch.setitem(settings.__dict__, "mongodb_db_name", name)
    roles = {r: {"_id": ObjectId(), "role_name": r, "is_system_role": True} for r in set(ROLE.values())}
    await db["roles"].insert_many(list(roles.values()))
    U = {k: ObjectId() for k in ROLE}
    s = {k: str(v) for k, v in U.items()}
    await db["users"].insert_many([{"_id": U[k], "name": k.title(), "email": f"{k}@t.io", "is_active": True,
                                    "role_id": str(roles[r]["_id"])} for k, r in ROLE.items()])
    mkt = {"_id": ObjectId(), "name": "Marketing", "members": [
        {"user_id": s["lead"], "role": "leader"}, {"user_id": s["creator"], "role": "member"},
        {"user_id": s["assignee"], "role": "member"}, {"user_id": s["mate"], "role": "member"}]}
    other = {"_id": ObjectId(), "name": "Design", "members": [{"user_id": s["otherlead"], "role": "leader"}]}
    await db["teams"].insert_many([mkt, other])

    def as_user(k):
        async def _u():
            r = roles[ROLE[k]]
            return {"_id": U[k], "name": k.title(), "email": f"{k}@t.io", "role_id": str(r["_id"]), "_role": r}
        return _u

    app.dependency_overrides[get_db] = lambda: db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as ac:
        async def call(method, path, who, **kw):
            app.dependency_overrides[get_current_user] = as_user(who)
            return await ac.request(method, path, **kw)

        async def new_task():
            # Raised by a member for a teammate (so creator ≠ assignee ≠ leader).
            await db["teams"].update_one({"_id": mkt["_id"], "members.user_id": s["creator"]},
                                         {"$set": {"members.$.role": "leader"}})
            r = await call("POST", P, "creator", json={"title": "Reel", "team_id": str(mkt["_id"]),
                                                       "assigned_to": s["assignee"], "due_date": today_ist().isoformat()})
            await db["teams"].update_one({"_id": mkt["_id"], "members.user_id": s["creator"]},
                                         {"$set": {"members.$.role": "member"}})
            assert r.status_code == 201, r.text
            return r.json()["data"]["id"]

        yield {"db": db, "s": s, "call": call, "new_task": new_task}
    app.dependency_overrides.clear()
    await asyncio.sleep(0.2)
    await client.drop_database(name)
    client.close()


async def test_view_and_edit_are_for_the_people_around_the_task(w):
    tid = await w["new_task"]()
    expect = {"admin": True, "lead": True, "creator": True, "assignee": True, "mate": True,
              "otherlead": False, "outsider": False}
    got_view = {k: (await w["call"]("GET", f"{P}/{tid}", k)).status_code == 200 for k in ROLE}
    got_edit = {k: (await w["call"]("PUT", f"{P}/{tid}", k, json={"description": f"by {k}"})).status_code == 200 for k in ROLE}
    assert got_view == expect
    assert got_edit == expect, "editing follows exactly the viewing rule"
    doc = await w["db"]["project_tasks"].find_one({"_id": ObjectId(tid)})
    assert doc["description"] == "by mate", "the strangers' edits never landed"


async def test_strangers_cant_rename_restatus_or_retag_a_task(w):
    tid = await w["new_task"]()
    for who in ("outsider", "otherlead"):
        for body in ({"title": "hijacked"}, {"status": "started"}, {"project_id": ""}, {"assigned_to": w["s"][who]}):
            r = await w["call"]("PUT", f"{P}/{tid}", who, json=body)
            assert r.status_code == 403, (who, body, r.text)
    doc = await w["db"]["project_tasks"].find_one({"_id": ObjectId(tid)})
    assert doc["title"] == "Reel" and doc["status"] == "pending" and doc["assigned_to"] == w["s"]["assignee"]


async def test_delete_is_for_the_creator_the_team_leader_and_admins(w):
    for who, allowed in [("outsider", False), ("otherlead", False), ("mate", False), ("assignee", False),
                         ("creator", True), ("lead", True), ("admin", True)]:
        tid = await w["new_task"]()
        r = await w["call"]("DELETE", f"{P}/{tid}", who)
        assert (r.status_code == 204) == allowed, (who, r.status_code, r.text)
        still = await w["db"]["project_tasks"].count_documents({"_id": ObjectId(tid)})
        assert still == (0 if allowed else 1), who


async def test_delete_answers_404_for_missing_or_bad_ids(w):
    assert (await w["call"]("DELETE", f"{P}/{ObjectId()}", "admin")).status_code == 404
    assert (await w["call"]("DELETE", f"{P}/not-an-id", "admin")).status_code == 404
