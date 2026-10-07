"""
Authorisation for browsing one person's tasks: GET /api/v1/projects?member_id=

The rule: a Team Leader may browse only the people they lead, and sees that
person's work only inside the teams the leader leads them in (plus teamless
personal tasks, which have no board and would otherwise be invisible to their
approver). Elevated roles see everything; everyone else is confined to their
own tasks and member_id is ignored.

Before this was enforced, a Team Leader with no team_id could pass ANY user id
and read that person's tasks across every team in the company.

This is an integration test: it drives the real endpoint and the real
list_tasks query against a throwaway MongoDB database, created and dropped
here. The developer's database is never touched. Skips when Mongo is down.

Fixture
-------
  Teams   T1 (leader L: A, C)   T2 (leader L2: B)   T3 (leader L2: C)
          T4 (P is "leader" by membership, but P's ROLE is Employee: A)
  Roles   L, L2 Team Leader   E Super Admin   A, B, C, P Employee
  Tasks   a1 A/T1  a2 A/T4  a3 A/teamless   b1 B/T2  b2 B/teamless
          c1 C/T1  c3 C/T3  l1 L/T1
"""
import secrets
from datetime import date, datetime, timezone

import pytest
from bson import ObjectId
from httpx import ASGITransport, AsyncClient
from motor.motor_asyncio import AsyncIOMotorClient

from app.config import settings
from app.database import get_db
from app.main import app
from app.middleware.auth import get_current_user


async def _mongo_or_skip() -> AsyncIOMotorClient:
    client = AsyncIOMotorClient(settings.mongodb_url, serverSelectionTimeoutMS=3000)
    try:
        await client.admin.command("ping")
    except Exception:
        client.close()
        pytest.skip("MongoDB not reachable — integration test skipped")
    return client


async def test_member_scope_authorisation():
    client = await _mongo_or_skip()
    db_name = f"mediaerp_test_scope_{secrets.token_hex(4)}"
    db = client[db_name]
    try:
        roles = {
            "TL": {"_id": ObjectId(), "role_name": "Team Leader"},
            "SA": {"_id": ObjectId(), "role_name": "Super Admin", "is_system_role": True},
            "EM": {"_id": ObjectId(), "role_name": "Employee"},
        }
        role_of = {"L": "TL", "L2": "TL", "E": "SA", "A": "EM", "B": "EM", "C": "EM", "P": "EM"}
        U = {k: ObjectId() for k in role_of}
        s = {k: str(v) for k, v in U.items()}

        def team(leader, *members):
            return {"_id": ObjectId(), "name": f"team-{leader}", "color": "#888",
                    "members": [{"user_id": s[leader], "role": "leader"}]
                               + [{"user_id": s[m], "role": "member"} for m in members]}

        T1, T2, T3, T4 = team("L", "A", "C"), team("L2", "B"), team("L2", "C"), team("P", "A")
        await db["teams"].insert_many([T1, T2, T3, T4])
        t = {"T1": str(T1["_id"]), "T2": str(T2["_id"]), "T3": str(T3["_id"]), "T4": str(T4["_id"])}

        now = datetime.now(timezone.utc)

        def task(title, who, team_id):
            d = {"title": title, "assigned_to": s[who], "status": "pending", "priority": "medium",
                 "attachments": [], "created_by": s[who], "history": [],
                 "created_at": now, "updated_at": now}
            if team_id is not None:
                d["team_id"] = team_id
            return d

        await db["project_tasks"].insert_many([
            task("a1", "A", t["T1"]), task("a2", "A", t["T4"]), task("a3", "A", None),
            task("b1", "B", t["T2"]), task("b2", "B", None),
            task("c1", "C", t["T1"]), task("c3", "C", t["T3"]),
            task("l1", "L", t["T1"]),
        ])

        def as_user(key):
            async def _user():
                return {"_id": U[key], "name": key, "email": f"{key}@t.io",
                        "role_id": str(roles[role_of[key]]["_id"]), "_role": roles[role_of[key]]}
            return _user

        app.dependency_overrides[get_db] = lambda: db
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as ac:

            async def titles(viewer, **params):
                app.dependency_overrides[get_current_user] = as_user(viewer)
                r = await ac.get("/api/v1/projects", params=params)
                assert r.status_code == 200, r.text
                return sorted(x["title"] for x in r.json()["data"]), r.json()

            # ── Team Leader, no team_id: the Overview member filter ─────────────
            assert (await titles("L", member_id=s["A"]))[0] == ["a1", "a3"], \
                "leader sees A's work in teams they lead + personal, never T4 (a2)"
            got, body = await titles("L", member_id=s["B"])
            assert got == [], "a leader must not browse someone they don't lead"
            # A refusal is indistinguishable from "no tasks" — it must not confirm
            # that the user exists.
            assert body["success"] is True and body["meta"]["total"] == 0
            assert body["message"] == "Tasks retrieved"
            assert (await titles("L", member_id=s["C"]))[0] == ["c1"], \
                "C is shared via T1 only; C's T3 work (c3) stays hidden"
            assert (await titles("L", member_id="not-an-id"))[0] == []
            assert (await titles("L", member_id=str(ObjectId())))[0] == []
            assert (await titles("L", member_id=s["A"], search="a2"))[0] == [], \
                "search must not reach outside the leader's teams"

            # ── Team Leader with team_id: the Projects page path ────────────────
            assert (await titles("L", team_id=t["T1"], member_id=s["A"]))[0] == ["a1", "a3"]
            assert (await titles("L", team_id=t["T1"], member_id=s["B"]))[0] == [], \
                "a non-member of the chosen team is refused (used to leak their personal task)"
            assert (await titles("L", team_id=t["T2"], member_id=s["B"]))[0] == [], \
                "a team the caller doesn't lead: member_id is ignored, own-in-T2 is empty"

            # ── Other roles are unaffected ──────────────────────────────────────
            assert (await titles("E", member_id=s["B"]))[0] == ["b1", "b2"]
            assert (await titles("E", member_id=s["A"]))[0] == ["a1", "a2", "a3"]
            assert (await titles("P", member_id=s["A"]))[0] == [], \
                "Employee ROLE gets 'own' even if they lead a team by membership"
            assert (await titles("A", member_id=s["B"]))[0] == ["a1", "a2", "a3"], \
                "an employee's member_id is ignored"

            # ── No member_id: unchanged ─────────────────────────────────────────
            assert (await titles("L"))[0] == ["a1", "c1", "l1"]
            assert (await titles("E"))[0] == ["a1", "a2", "a3", "b1", "b2", "c1", "c3", "l1"]
            assert (await titles("B"))[0] == ["b1", "b2"]

            # ── Media Schedule's request shapes (the other member_id consumer) ──
            d = date.today().isoformat()
            dates = {"date_filter": "custom", "date_from": d, "date_to": d}
            assert (await titles("L", member_id=s["A"], **dates))[0] == ["a1", "a3"]
            assert (await titles("L", member_id=s["A"], team_id=t["T1"], **dates))[0] == ["a1", "a3"]
            assert (await titles("E", member_id=s["B"], **dates))[0] == ["b1", "b2"]
    finally:
        app.dependency_overrides.clear()
        await client.drop_database(db_name)
        client.close()
