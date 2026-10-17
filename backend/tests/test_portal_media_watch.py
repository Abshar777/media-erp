"""
GET /api/v1/service/media-watch — the Root portal's Pending → Media ERP tab.

Media Schedule tasks not done, project tasks somebody is on and hasn't handed in,
and the Leader Desk queue with the leaders it waits on. Throwaway MongoDB
database, created and dropped here; skips when Mongo is down.
"""
import secrets
from datetime import datetime, timedelta, timezone

import pytest
from bson import ObjectId
from httpx import ASGITransport, AsyncClient
from motor.motor_asyncio import AsyncIOMotorClient

from app.config import settings
from app.main import app
from app.utils.timezone import today_ist

URL = "/api/v1/service/media-watch"
SECRET = "test-portal-secret"


@pytest.fixture
async def w(monkeypatch):
    client = AsyncIOMotorClient(settings.mongodb_url, serverSelectionTimeoutMS=3000)
    try:
        await client.admin.command("ping")
    except Exception:
        client.close()
        pytest.skip("MongoDB not reachable — integration tests skipped")
    name = f"mediaerp_test_watch_{secrets.token_hex(4)}"
    db = client[name]
    import app.database as dbmod
    monkeypatch.setattr(dbmod, "_client", client)
    monkeypatch.setitem(settings.__dict__, "mongodb_db_name", name)
    monkeypatch.setitem(settings.__dict__, "root_erp_secret", SECRET)

    roles = {r: {"_id": ObjectId(), "role_name": r, "is_system_role": True} for r in ("Admin", "Team Leader", "Employee")}
    await db["roles"].insert_many(list(roles.values()))
    people = {"adm": "Admin", "lead": "Team Leader", "emp": "Employee", "emp2": "Employee"}
    U = {k: ObjectId() for k in people}
    s = {k: str(v) for k, v in U.items()}
    await db["users"].insert_many([{"_id": U[k], "name": k.title(), "email": f"{k.upper()}@t.io", "is_active": True,
                                    "role_id": str(roles[r]["_id"])} for k, r in people.items()])
    team = {"_id": ObjectId(), "name": "Video", "members": [{"user_id": s["lead"], "role": "leader"}, {"user_id": s["emp"], "role": "member"}]}
    await db["teams"].insert_one(team)
    T = str(team["_id"])

    today = today_ist()
    day = lambda n: (today + timedelta(days=n)).isoformat()   # noqa: E731
    at = lambda n: datetime.combine(today + timedelta(days=n), datetime.min.time(), tzinfo=timezone.utc) + timedelta(hours=6)  # noqa: E731

    await db["media_tasks"].insert_many([
        {"title": "Reel late", "team_id": T, "assigned_to": s["emp"], "status": "active", "start_date": at(-5), "due_date": at(-2)},
        {"title": "Reel today", "team_id": T, "assigned_to": s["emp2"], "status": "active", "start_date": at(-1), "due_date": at(0)},
        {"title": "Reel later", "team_id": T, "assigned_to": s["emp"], "status": "scheduled", "start_date": at(3), "due_date": at(5)},
        {"title": "Reel done", "team_id": T, "assigned_to": s["emp"], "status": "completed", "start_date": at(-9), "due_date": at(-8)},
        {"title": "Reel dropped", "team_id": T, "assigned_to": s["emp"], "status": "cancelled", "start_date": at(-9), "due_date": at(-8)},
    ])

    def task(**kw):
        return {"_id": ObjectId(), "title": "t", "assigned_to": "", "updated_at": datetime.now(timezone.utc), **kw}

    await db["project_tasks"].insert_many([
        task(title="Edit A", team_id=T, assigned_to=s["emp"], status="started", due_date=day(-1)),     # overdue
        task(title="Edit B", team_id=T, assigned_to=s["emp2"], status="pending", due_date=day(2)),
        task(title="Edit C", team_id=T, assigned_to=s["emp"], status="reedit", due_date=day(1)),        # also on the desk
        task(title="Edit D", team_id=T, assigned_to=s["emp"], status="break"),                          # no due date
        task(title="Review me", team_id=T, assigned_to=s["emp2"], status="pending_review"),             # desk: review
        task(title="Nobody yet", team_id=T, status="pending"),                                           # desk: incoming
        task(title="Loose", status="pending_review", assigned_to=s["emp"]),                              # no team: the admins
        task(title="Gone team", team_id=str(ObjectId()), status="pending_review"),                       # nobody's desk
        task(title="Done", team_id=T, assigned_to=s["emp"], status="approved"),
    ])
    yield {"db": db, "s": s, "today": today.isoformat()}
    await client.drop_database(name)
    client.close()


async def _get(secret=SECRET):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        return await c.get(URL, headers={"x-portal-secret": secret} if secret else {})


async def test_refuses_without_the_secret(w):
    assert (await _get(None)).status_code == 401
    assert (await _get("nope")).status_code == 401


async def test_media_schedule(w):
    d = (await _get()).json()["data"]
    assert d["today"] == w["today"]
    assert d["counts"]["media"] == 2 and d["counts"]["media_overdue"] == 1 and d["counts"]["media_upcoming"] == 1
    titles = {m["title"]: m for m in d["items"]["media"]}
    assert set(titles) == {"Reel late", "Reel today", "Reel later"}          # completed and cancelled left out
    late = titles["Reel late"]
    assert late["overdue"] is True and late["person"] == "Emp" and late["email"] == "emp@t.io" and late["team"] == "Video"
    assert titles["Reel today"]["overdue"] is False                        # due today is not late
    assert titles["Reel later"]["status"] == "scheduled" and titles["Reel later"]["overdue"] is False


async def test_tasks(w):
    d = (await _get()).json()["data"]
    rows = {t["title"]: t for t in d["items"]["tasks"]}
    assert set(rows) == {"Edit A", "Edit B", "Edit C", "Edit D"}           # in review, unassigned and approved left out
    assert d["counts"]["tasks"] == 4 and d["counts"]["tasks_overdue"] == 1
    assert rows["Edit A"]["overdue"] is True and rows["Edit A"]["status"] == "started"
    assert rows["Edit D"]["due"] == "" and rows["Edit D"]["overdue"] is False
    assert rows["Edit B"]["person"] == "Emp2"


async def test_leader_desk(w):
    d = (await _get()).json()["data"]
    desk = {x["title"]: x for x in d["items"]["leaderDesk"]}
    assert set(desk) == {"Edit C", "Review me", "Nobody yet", "Loose"}      # a deleted team's is on nobody's desk
    assert d["counts"]["leader_desk"] == 4
    assert (d["counts"]["leader_desk_review"], d["counts"]["leader_desk_incoming"], d["counts"]["leader_desk_reedit"]) == (2, 1, 1)
    assert desk["Review me"]["stage"] == "review" and [l["name"] for l in desk["Review me"]["leaders"]] == ["Lead"]
    assert desk["Nobody yet"]["stage"] == "incoming" and desk["Nobody yet"]["assignee"] == ""
    assert desk["Loose"]["team"] == "No team" and [l["name"] for l in desk["Loose"]["leaders"]] == ["Adm"]
