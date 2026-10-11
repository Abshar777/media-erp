"""
GET /api/v1/service/pending — the Root portal's "Pending" page.

Every sidebar badge counted company-wide and attributed to the people it waits
on. Throwaway MongoDB database, created and dropped here; skips when Mongo is
down.
"""
import secrets
from datetime import timedelta

import pytest
from bson import ObjectId
from httpx import ASGITransport, AsyncClient
from motor.motor_asyncio import AsyncIOMotorClient

from app.config import settings
from app.database import get_db
from app.main import app
from app.utils.timezone import today_ist

URL = "/api/v1/service/pending"
SECRET = "test-portal-secret"


@pytest.fixture
async def w(monkeypatch):
    client = AsyncIOMotorClient(settings.mongodb_url, serverSelectionTimeoutMS=3000)
    try:
        await client.admin.command("ping")
    except Exception:
        client.close()
        pytest.skip("MongoDB not reachable — integration tests skipped")
    name = f"mediaerp_test_pending_{secrets.token_hex(4)}"
    db = client[name]
    import app.database as dbmod
    monkeypatch.setattr(dbmod, "_client", client)
    monkeypatch.setitem(settings.__dict__, "mongodb_db_name", name)
    monkeypatch.setitem(settings.__dict__, "root_erp_secret", SECRET)

    roles = {r: {"_id": ObjectId(), "role_name": r, "is_system_role": True}
             for r in ("Super Admin", "Admin", "Team Leader", "Employee")}
    await db["roles"].insert_many(list(roles.values()))
    people = {"sa": "Super Admin", "adm": "Admin", "adm2": "Admin", "lead": "Team Leader",
              "lead2": "Team Leader", "lead3": "Team Leader", "emp": "Employee", "emp2": "Employee"}
    inactive = {"adm2", "lead3"}
    U = {k: ObjectId() for k in people}
    s = {k: str(v) for k, v in U.items()}
    await db["users"].insert_many([{
        "_id": U[k], "name": k.title(),
        "email": "Emp@T.io" if k == "emp" else f"{k}@t.io",
        "is_active": k not in inactive, "role_id": str(roles[r]["_id"]),
    } for k, r in people.items()])

    ghost = str(ObjectId())            # an id with no account behind it
    team_a = {"_id": ObjectId(), "name": "A", "members": [
        {"user_id": s["lead"], "role": "leader"}, {"user_id": s["lead2"], "role": "leader"},
        {"user_id": s["emp"], "role": "member"}, {"user_id": s["emp2"], "role": "member"}]}
    team_b = {"_id": ObjectId(), "name": "B (no leader)", "members": [{"user_id": s["emp"], "role": "member"}]}
    team_c = {"_id": ObjectId(), "name": "C", "members": [{"user_id": s["lead3"], "role": "leader"}]}
    await db["teams"].insert_many([team_a, team_b, team_c])
    A, B, C = str(team_a["_id"]), str(team_b["_id"]), str(team_c["_id"])
    gone_team = str(ObjectId())

    def task(**kw):
        return {"_id": ObjectId(), "title": "t", "assigned_to": "", **kw}

    await db["project_tasks"].insert_many([
        task(team_id=A, status="pending_review",
             verifications=[{"user_id": s["emp"], "status": "pending"}, {"user_id": s["emp2"], "status": "passed"}]),
        task(team_id=A, status="pending"),                              # unassigned: Assign Work
        task(team_id=A, status="pending", assigned_to=s["emp"]),         # handed out: not on the desk
        task(team_id=A, status="reedit"),
        task(team_id=A, status="pending_review", verifications=[{"user_id": ghost, "status": "pending"}]),
        task(status="pending_review",                                    # no team field at all
             verifications=[{"user_id": s["emp2"], "status": "pending"}, {"user_id": s["emp2"], "status": "passed"}]),
        task(team_id=B, status="pending_review"),                        # leaderless team
        task(team_id=gone_team, status="pending_review"),                # deleted team: nobody's desk
        task(team_id=A, status="in_progress", verifications=[{"user_id": s["emp"], "status": "pending"}]),
        task(team_id=A, status="done"),
        task(team_id=C, status="reedit"),                                # inactive leader
        task(team_id=A, status="pending_review",                         # first slot already passed
             verifications=[{"user_id": s["emp"], "status": "passed"}, {"user_id": s["emp"], "status": "pending"}]),
    ])

    def msg(to, read):
        return {"from_user_id": s["sa"], "to_user_id": to, "content": "hi", "read": read}

    await db["messages"].insert_many(
        [msg(s["emp"], False) for _ in range(3)]
        + [msg(s["emp"], True), msg(s["lead"], False), msg(ghost, False), msg(ghost, False)]
    )

    today = today_ist()
    ago = lambda n: (today - timedelta(days=n)).isoformat()   # noqa: E731

    def report(assignees, start, **kw):
        return {"_id": ObjectId(), "name": "r", "status": "active", "start_date": start,
                "assignees": assignees, "team_ids": [A], **kw}

    r_filled = report([s["emp"]], ago(3))
    await db["ad_reports"].insert_many([
        report([s["emp"], s["emp2"]], ago(5)),                            # days missing: overdue x2
        report([s["lead"]], ago(1), reminder_escalate="23:59"),           # only yesterday, before cut-off: due
        r_filled,                                                          # all filled in
        report([s["emp"]], ago(5), kind="account"),                       # an account: never typed into
        report([s["emp"]], ago(5), status="paused"),
        report([ghost, s["emp2"]], ago(5)),                               # ghost not counted
    ])
    await db["ad_report_entries"].insert_many(
        [{"report_id": str(r_filled["_id"]), "date": ago(n)} for n in (1, 2, 3)]
    )

    app.dependency_overrides[get_db] = lambda: db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as ac:
        yield {"db": db, "s": s, "ac": ac}
    app.dependency_overrides.clear()
    await client.drop_database(name)
    client.close()


async def fetch(w):
    r = await w["ac"].get(URL, headers={"x-portal-secret": SECRET})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["success"] is True
    return body["data"]


async def test_kinds_in_sidebar_order_with_company_totals(w):
    data = await fetch(w)
    assert set(data) == {"kinds", "people"}
    assert data["kinds"] == [
        {"key": "ad_reports", "label": "Ad Reports", "total": 4, "overdue": 3},
        {"key": "leader_desk", "label": "Leader Desk", "total": 8},
        {"key": "verifications", "label": "Verifications", "total": 2},
        {"key": "chat", "label": "Chat", "total": 4},
    ]
    assert not any(k.get("shared") for k in data["kinds"])


async def test_each_person_gets_what_waits_on_them(w):
    data = await fetch(w)
    s = w["s"]
    by_id = {p["id"]: p for p in data["people"]}

    def counts(k):
        return by_id[s[k]]["counts"]

    assert counts("emp") == {"ad_reports": 1, "leader_desk": 0, "verifications": 1, "chat": 3, "ad_reports_overdue": 1}
    assert counts("emp2") == {"ad_reports": 2, "leader_desk": 0, "verifications": 1, "chat": 0, "ad_reports_overdue": 2}
    # Both leaders of team A see A's whole desk.
    assert counts("lead") == {"ad_reports": 1, "leader_desk": 5, "verifications": 0, "chat": 1, "ad_reports_overdue": 0}
    assert counts("lead2")["leader_desk"] == 5
    # No team, or a leaderless team: on every active Super Admin / Admin.
    assert counts("sa")["leader_desk"] == 2
    assert counts("adm")["leader_desk"] == 2
    assert s["adm2"] not in by_id
    # An inactive leader still owns their team's desk, and says so.
    assert by_id[s["lead3"]]["active"] is False and counts("lead3")["leader_desk"] == 1

    # total excludes *_overdue; sorted by total, highest first.
    assert [(p["name"], p["total"]) for p in data["people"]] == [
        ("Lead", 7), ("Emp", 5), ("Lead2", 5), ("Emp2", 3), ("Adm", 2), ("Sa", 2), ("Lead3", 1)]
    emp = by_id[s["emp"]]
    assert emp["email"] == "emp@t.io" and emp["active"] is True
    assert set(emp) == {"id", "name", "email", "active", "counts", "total"}


async def test_reading_changes_nothing_and_tracks_the_data(w):
    db, s = w["db"], w["s"]
    before = await fetch(w)
    await db["messages"].update_many({"to_user_id": s["emp"]}, {"$set": {"read": True}})
    after = await fetch(w)
    assert after["kinds"][3]["total"] == before["kinds"][3]["total"] - 3
    assert {p["id"]: p for p in after["people"]}[s["emp"]]["counts"]["chat"] == 0


async def test_empty_company(w):
    db = w["db"]
    for c in ("project_tasks", "messages", "ad_reports"):
        await db[c].delete_many({})
    data = await fetch(w)
    assert data["people"] == []
    assert [k["total"] for k in data["kinds"]] == [0, 0, 0, 0]


async def test_refused_without_the_right_secret(w, monkeypatch):
    ac = w["ac"]
    r = await ac.get(URL)
    assert r.status_code == 401 and r.json()["success"] is False
    r = await ac.get(URL, headers={"x-portal-secret": "wrong"})
    assert r.status_code == 401 and r.json()["success"] is False
    monkeypatch.setitem(settings.__dict__, "root_erp_secret", "")
    r = await ac.get(URL, headers={"x-portal-secret": SECRET})
    assert r.status_code == 503


async def test_matches_each_persons_own_sidebar_badges(w):
    """The same numbers the badges' own endpoints give each person signed in here."""
    from app.middleware.auth import get_current_user

    db, ac = w["db"], w["ac"]
    data = await fetch(w)
    by_id = {p["id"]: p["counts"] for p in data["people"]}
    elevated = {"Super Admin", "Admin", "Coordinator"}
    sa_desk = None

    for u in await db["users"].find({}).to_list(None):
        role = await db["roles"].find_one({"_id": ObjectId(u["role_id"])})

        async def me(u=u, role=role):
            return {**u, "_role": role}
        app.dependency_overrides[get_current_user] = me

        chat = sum((await ac.get("/api/v1/chat/unread")).json().values())
        verify = len((await ac.get("/api/v1/verify", params={"scope": "pending"})).json()["data"])
        ads = (await ac.get("/api/v1/ad-reports/today")).json()["data"]["my_due_count"]
        q = (await ac.get("/api/v1/projects/leader/queue")).json()["data"]
        desk = len(q["review"]) + len(q["incoming"]) + len(q["reedit"])

        mine = by_id.get(str(u["_id"]), {})
        assert (chat, verify, ads) == (mine.get("chat", 0), mine.get("verifications", 0), mine.get("ad_reports", 0)), u["name"]
        if role["role_name"] in elevated:
            sa_desk = desk if role["role_name"] == "Super Admin" else sa_desk
        else:
            assert desk == mine.get("leader_desk", 0), u["name"]

    app.dependency_overrides.pop(get_current_user, None)
    # A Super Admin's own Leader Desk badge is the company-wide total.
    assert sa_desk == data["kinds"][1]["total"]
    assert sum(c.get("chat", 0) for c in by_id.values()) == data["kinds"][3]["total"]
