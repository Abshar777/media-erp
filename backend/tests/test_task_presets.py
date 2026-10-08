"""
Saved tasks (task-name suggestions). Integration tests on a throwaway MongoDB
database (created and dropped here). Skips without Mongo.
"""
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
from app.services import task_preset_service as tp

B = "/api/v1/task-presets"


@pytest.fixture
async def world(monkeypatch):
    client = AsyncIOMotorClient(settings.mongodb_url, serverSelectionTimeoutMS=3000)
    try:
        await client.admin.command("ping")
    except Exception:
        client.close()
        pytest.skip("MongoDB not reachable — integration tests skipped")
    name = f"mediaerp_test_presets_{secrets.token_hex(4)}"
    db = client[name]
    import app.database as dbmod
    monkeypatch.setattr(dbmod, "_client", client)
    monkeypatch.setitem(settings.__dict__, "mongodb_db_name", name)

    roles = {r: {"_id": ObjectId(), "role_name": r} for r in ("Team Leader", "Employee", "Super Admin")}
    people = {"lead": "Team Leader", "lead2": "Team Leader", "asha": "Employee", "out": "Employee", "sa": "Super Admin"}
    U = {k: ObjectId() for k in people}
    s = {k: str(v) for k, v in U.items()}
    T1 = {"_id": ObjectId(), "name": "Video", "members": [{"user_id": s["lead"], "role": "leader"},
                                                          {"user_id": s["asha"], "role": "member"}]}
    T2 = {"_id": ObjectId(), "name": "Content", "members": [{"user_id": s["lead2"], "role": "leader"},
                                                            {"user_id": s["out"], "role": "member"}]}
    await db["teams"].insert_many([T1, T2])
    await tp.ensure_indexes(db)

    def as_user(k):
        async def _u():
            return {"_id": U[k], "name": k.title(), "_role": roles[people[k]]}
        return _u

    app.dependency_overrides[get_db] = lambda: db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as ac:
        async def call(method, path, who, **kw):
            app.dependency_overrides[get_current_user] = as_user(who)
            return await ac.request(method, path, **kw)
        yield {"db": db, "s": s, "t1": str(T1["_id"]), "t2": str(T2["_id"]), "call": call}
    app.dependency_overrides.clear()
    await client.drop_database(name)
    client.close()


async def task(w, title, team, by, days_ago=1):
    await w["db"]["project_tasks"].insert_one({
        "title": title, "team_id": team, "created_by": by,
        "created_at": datetime.now(timezone.utc) - timedelta(days=days_ago)})


async def add(w, who, team, title, **kw):
    return await w["call"]("POST", B, who, json={"team_id": team, "title": title, **kw})


async def test_who_can_save(world):
    w = world
    assert (await add(w, "lead", w["t1"], "Daily reel edit")).status_code == 201
    assert (await add(w, "asha", w["t1"], "Mine")).status_code == 403, "members use, leaders save"
    assert (await add(w, "lead2", w["t1"], "Not my team")).status_code == 403
    assert (await add(w, "lead", None, "Company")).status_code == 403, "company list is admins only"
    assert (await add(w, "sa", None, "Weekly report")).status_code == 201
    assert (await add(w, "sa", w["t1"], "Admin for a team")).status_code == 201


async def test_only_the_name_is_required_and_duplicates_are_refused(world):
    w = world
    r = await add(w, "lead", w["t1"], "  Monthly   SEO report ")
    assert r.status_code == 201 and r.json()["data"]["title"] == "Monthly SEO report"
    assert r.json()["data"]["priority"] is None and r.json()["data"]["description"] == ""
    dup = await add(w, "lead", w["t1"], "monthly seo REPORT")
    assert dup.status_code == 409, "same name, any case/spacing"
    assert (await add(w, "lead2", w["t2"], "Monthly SEO report")).status_code == 201, "other teams may reuse it"
    assert (await add(w, "lead", w["t1"], "   ")).status_code == 422
    assert (await add(w, "lead", w["t1"], "x" * 121)).status_code == 422
    assert (await add(w, "lead", w["t1"], "Fine", description="d" * 2001)).status_code == 422
    assert (await add(w, "lead", w["t1"], "Fine", priority="urgent")).status_code == 422
    full = await add(w, "lead", w["t1"], "Reel", description="Cut to 30s", priority="high")
    assert full.json()["data"]["priority"] == "high"


async def test_suggestions_never_leak_another_teams_titles(world):
    w, s = world, world["s"]
    await add(w, "lead", w["t1"], "Daily reel edit")
    await add(w, "lead2", w["t2"], "Content calendar")
    await add(w, "sa", None, "Weekly report")
    await task(w, "Thumbnail batch", w["t1"], s["lead"])
    await task(w, "Thumbnail batch", w["t1"], s["lead"])
    await task(w, "Secret content plan", w["t2"], s["lead2"])
    await task(w, "Old video task", w["t1"], s["lead"], days_ago=120)

    r = (await w["call"]("GET", f"{B}/suggest?team_id={w['t1']}", "asha")).json()["data"]
    assert [x["title"] for x in r["saved"]] == ["Daily reel edit"]
    assert [x["title"] for x in r["company"]] == ["Weekly report"]
    recent = {x["title"]: x["uses"] for x in r["recent"]}
    assert recent == {"Thumbnail batch": 2}, "own team only, last 90 days"
    assert r["can_save"] is False

    other = (await w["call"]("GET", f"{B}/suggest?team_id={w['t2']}", "asha")).json()["data"]
    assert other["saved"] == [] and other["recent"] == [], "a team you're not in shows nothing of its own"
    assert [x["title"] for x in other["company"]] == ["Weekly report"]

    await task(w, "My personal errand", None, s["asha"])
    other = (await w["call"]("GET", f"{B}/suggest?team_id={w['t2']}", "asha")).json()["data"]
    assert [x["title"] for x in other["recent"]] == ["My personal errand"], "your own tasks always count"


async def test_no_team_picked_offers_all_your_teams_labelled(world):
    w = world
    await add(w, "lead", w["t1"], "Daily reel edit")
    await add(w, "lead2", w["t2"], "Content calendar")
    r = (await w["call"]("GET", f"{B}/suggest", "asha")).json()["data"]
    assert [(x["title"], x["team_name"]) for x in r["saved"]] == [("Daily reel edit", "Video")]
    lead = (await w["call"]("GET", f"{B}/suggest?team_id={w['t1']}", "lead")).json()["data"]
    assert lead["can_save"] is True


async def test_saved_names_are_not_repeated_as_recent_and_count_uses(world):
    w, s = world, world["s"]
    await add(w, "lead", w["t1"], "Daily reel edit")
    for _ in range(3):
        await task(w, "daily REEL edit", w["t1"], s["asha"])
    r = (await w["call"]("GET", f"{B}/suggest?team_id={w['t1']}", "asha")).json()["data"]
    assert r["recent"] == [], "already saved — shown once"
    assert r["saved"][0]["uses"] == 3
    lst = (await w["call"]("GET", f"{B}?team_id={w['t1']}", "lead")).json()["data"]
    assert lst[0]["uses"] == 3


async def test_edit_and_delete_rules(world):
    w = world
    a = (await add(w, "lead", w["t1"], "A")).json()["data"]["id"]
    await add(w, "lead", w["t1"], "B")
    assert (await w["call"]("PATCH", f"{B}/{a}", "asha", json={"title": "x"})).status_code == 403
    assert (await w["call"]("PATCH", f"{B}/{a}", "lead2", json={"title": "x"})).status_code == 403
    assert (await w["call"]("PATCH", f"{B}/{a}", "lead", json={"title": "b"})).status_code == 409, "rename onto B"
    ok = await w["call"]("PATCH", f"{B}/{a}", "lead", json={"title": "Apple", "priority": "low", "description": "x"})
    assert ok.status_code == 200 and ok.json()["data"]["title"] == "Apple"
    cleared = await w["call"]("PATCH", f"{B}/{a}", "lead", json={"clear_priority": True})
    assert cleared.json()["data"]["priority"] is None
    assert (await w["call"]("DELETE", f"{B}/{a}", "asha")).status_code == 403
    assert (await w["call"]("DELETE", f"{B}/{a}", "lead")).status_code == 200
    assert (await w["call"]("DELETE", f"{B}/{a}", "lead")).status_code == 404
    assert (await w["call"]("GET", f"{B}?team_id={w['t1']}", "asha")).status_code == 403
    assert (await w["call"]("GET", f"{B}?team_id=nope", "lead")).status_code == 404


async def test_list_limit(world, monkeypatch):
    w = world
    monkeypatch.setattr(tp, "MAX_PER_TEAM", 3)
    for i in range(3):
        assert (await add(w, "lead", w["t1"], f"T{i}")).status_code == 201
    assert (await add(w, "lead", w["t1"], "T3")).status_code == 422
