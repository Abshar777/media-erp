"""
Overview date range: GET /api/v1/projects with date_filter (+ member_id).

The Overview's date filter sends exactly what the Projects date filter sends:
  today | this_week | this_month | this_year      → date_filter=<preset>
  yesterday | last 7 days | last month | custom   → date_filter=custom&date_from&date_to
and combines it with member_id ("Sara, 1 Oct – 8 Oct"). "All time" sends no
date params at all.

What must hold:
  • days are IST calendar days — a task made at 23:59 IST on 30 Sep is NOT in
    "1 Oct – 8 Oct", one made at 00:00 IST on 1 Oct is, and 8 Oct runs to its
    last millisecond IST;
  • the date filter narrows the member filter, never widens it (a leader still
    can't see the person's work outside the teams they lead them in);
  • it combines with search, and with an Employee's own-only visibility.

Integration test on a throwaway MongoDB database (created and dropped here).
Skips when Mongo is down.
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


async def _mongo_or_skip() -> AsyncIOMotorClient:
    client = AsyncIOMotorClient(settings.mongodb_url, serverSelectionTimeoutMS=3000)
    try:
        await client.admin.command("ping")
    except Exception:
        client.close()
        pytest.skip("MongoDB not reachable — integration test skipped")
    return client


def utc(y, mo, d, h, mi, s=0, ms=0):
    return datetime(y, mo, d, h, mi, s, ms * 1000, tzinfo=timezone.utc)


async def test_overview_date_range_with_member_filter():
    client = await _mongo_or_skip()
    db_name = f"mediaerp_test_ovrange_{secrets.token_hex(4)}"
    db = client[db_name]
    try:
        roles = {
            "TL": {"_id": ObjectId(), "role_name": "Team Leader"},
            "SA": {"_id": ObjectId(), "role_name": "Super Admin", "is_system_role": True},
            "EM": {"_id": ObjectId(), "role_name": "Employee"},
        }
        role_of = {"LEAD": "TL", "OTHERLEAD": "TL", "ADMIN": "SA", "SARA": "EM", "OMAR": "EM"}
        U = {k: ObjectId() for k in role_of}
        s = {k: str(v) for k, v in U.items()}

        mine = {"_id": ObjectId(), "name": "Design", "color": "#888", "members": [
            {"user_id": s["LEAD"], "role": "leader"},
            {"user_id": s["SARA"], "role": "member"}, {"user_id": s["OMAR"], "role": "member"}]}
        other = {"_id": ObjectId(), "name": "Video", "color": "#888", "members": [
            {"user_id": s["OTHERLEAD"], "role": "leader"}, {"user_id": s["SARA"], "role": "member"}]}
        await db["teams"].insert_many([mine, other])
        T, X = str(mine["_id"]), str(other["_id"])

        now = datetime.now(timezone.utc)

        def task(title, who, team_id, created):
            return {"title": title, "assigned_to": s[who], "status": "pending", "priority": "medium",
                    "attachments": [], "created_by": s[who], "history": [], "team_id": team_id,
                    "created_at": created, "updated_at": created}

        await db["project_tasks"].insert_many([
            # IST boundaries around 1 Oct – 8 Oct 2026 (IST = UTC+5:30)
            task("sara-sep30-2359ist", "SARA", T, utc(2026, 9, 30, 18, 29, 59, 999)),   # out
            task("sara-oct01-0000ist", "SARA", T, utc(2026, 9, 30, 18, 30)),            # in
            task("sara-oct05", "SARA", T, utc(2026, 10, 5, 6, 0)),                      # in
            task("sara-oct08-2359ist", "SARA", T, utc(2026, 10, 8, 18, 29, 59, 999)),   # in
            task("sara-oct09-0000ist", "SARA", T, utc(2026, 10, 8, 18, 30)),            # out
            task("sara-video-oct05", "SARA", X, utc(2026, 10, 5, 6, 0)),   # in range, team LEAD doesn't lead
            task("omar-oct03", "OMAR", T, utc(2026, 10, 3, 6, 0)),         # in range, someone else
            # For the server presets (relative to the real clock)
            task("sara-now", "SARA", T, now),
            task("sara-400d-ago", "SARA", T, now - timedelta(days=400)),
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
                return sorted(x["title"] for x in r.json()["data"])

            oct1_8 = {"date_filter": "custom", "date_from": "2026-10-01", "date_to": "2026-10-08"}
            sara_oct = ["sara-oct01-0000ist", "sara-oct05", "sara-oct08-2359ist"]
            # "sara-now" is made at the real clock time — on 1–8 Oct 2026 IST it
            # rightly falls inside the range too.
            now_ist = (now + timedelta(hours=5, minutes=30)).date().isoformat()
            if "2026-10-01" <= now_ist <= "2026-10-08":
                sara_oct = sorted(sara_oct + ["sara-now"])

            # ── The headline case: a leader views Sara, 1 Oct – 8 Oct ──────────
            assert await titles("LEAD", member_id=s["SARA"], **oct1_8) == sara_oct, \
                "IST day edges: 23:59:59.999 on 30 Sep out, 00:00 on 1 Oct in, 8 Oct to its last ms, 9 Oct out"
            # The date filter never widens the member filter: Sara's Video work
            # (a team LEAD doesn't lead) stays hidden.
            assert "sara-video-oct05" not in await titles("LEAD", member_id=s["SARA"], **oct1_8)
            # Same request without a member: the leader's teams, still in range.
            assert await titles("LEAD", **oct1_8) == sorted(sara_oct + ["omar-oct03"])

            # Admin sees all of Sara's work in range, across teams.
            assert await titles("ADMIN", member_id=s["SARA"], **oct1_8) == sorted(sara_oct + ["sara-video-oct05"])

            # An Employee is own-only; the date filter narrows that, and a
            # member_id pointing at someone else is still ignored.
            assert await titles("SARA", **oct1_8) == sorted(sara_oct + ["sara-video-oct05"])
            assert await titles("OMAR", member_id=s["SARA"], **oct1_8) == ["omar-oct03"]
            assert "sara-now" not in await titles("OMAR", member_id=s["SARA"])

            # A single day (the Overview's "Yesterday", or From = To).
            assert await titles("LEAD", member_id=s["SARA"], date_filter="custom",
                                date_from="2026-10-01", date_to="2026-10-01") == ["sara-oct01-0000ist"]
            assert await titles("LEAD", member_id=s["SARA"], date_filter="custom",
                                date_from="2026-09-30", date_to="2026-09-30") == ["sara-sep30-2359ist"]

            # Combines with search (search owns the top-level $or; dates must not drop it).
            assert await titles("LEAD", member_id=s["SARA"], search="oct05", **oct1_8) == ["sara-oct05"]

            # ── Server presets, relative to the real clock ─────────────────────
            for preset in ("today", "this_week", "this_month", "this_year"):
                got = await titles("LEAD", member_id=s["SARA"], date_filter=preset)
                assert "sara-now" in got and "sara-400d-ago" not in got, preset

            # ── "All time": no date params → everything the scope allows ───────
            everything = await titles("LEAD", member_id=s["SARA"])
            assert "sara-400d-ago" in everything and "sara-sep30-2359ist" in everything
            assert "sara-video-oct05" not in everything
    finally:
        app.dependency_overrides.clear()
        await client.drop_database(db_name)
        client.close()
