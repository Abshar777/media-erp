"""
"Late by" end to end — real API, real workflow, real PDF and Performance report.

A leader creates Sharanya's tasks; she starts and submits them; the leader
verifies and approves them — all through the HTTP endpoints, so the history rows
are the ones the app really writes. The history is then moved to the times in the
reported PDF (Oct 2026) and the downloaded PDF and the Performance report are
checked row by row: work handed in on its due day is "On time" even though the
approval came the next day, and late work is late only up to the hand-in.

Integration test on a throwaway MongoDB database (created and dropped here).
Skips when Mongo is down.
"""
import re
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
from tests.test_overview_pdf import pdf_strings

IST = timezone(timedelta(hours=5, minutes=30))


def at(y, m, d, hh, mm, ss=0):
    return datetime(y, m, d, hh, mm, ss, tzinfo=IST).astimezone(timezone.utc)


# title, due, (started, submitted, approved) in IST  — None = not reached
ROWS = [
    ("Meeting with Ajvad",              "2026-10-08", (at(2026, 10, 9, 16, 47), at(2026, 10, 9, 16, 47, 8), at(2026, 10, 9, 16, 54))),
    ("Google Ads Optimisation - DXB",   "2026-10-07", (at(2026, 10, 7, 21, 50), at(2026, 10, 7, 21, 50, 8), at(2026, 10, 8, 13, 4))),
    ("blr Malayalam leads counts",      "2026-10-07", (at(2026, 10, 7, 21, 49), at(2026, 10, 7, 21, 49, 16), at(2026, 10, 8, 13, 4))),
    ("Check Nidhin Leads in CRM",       "2026-10-07", (at(2026, 10, 7, 21, 50), at(2026, 10, 7, 21, 51), at(2026, 10, 8, 13, 4))),
    ("Check Leads in CRM and tally",    "2026-10-06", (at(2026, 10, 7, 21, 51), at(2026, 10, 7, 21, 51, 5), at(2026, 10, 8, 13, 3))),
    ("Review all campaigns",            "2026-10-03", (at(2026, 10, 7, 21, 53), at(2026, 10, 7, 21, 53, 8), at(2026, 10, 8, 13, 3))),
    ("Share September reports",         "2026-10-01", (at(2026, 10, 1, 18, 23), at(2026, 10, 1, 18, 23, 6), at(2026, 10, 1, 18, 54))),
    ("Submitted late, awaiting approval", "2026-10-08", (at(2026, 10, 9, 13, 0), at(2026, 10, 9, 14, 0), None)),
    ("Google Ads New Campaign Dubai",   "2026-10-03", (None, None, None)),
]
# Expected "Late by" per row (None = On time): clock time from the end of the due day
# (midnight IST after it) to the submission — worked out by hand.
EXPECT = {
    "Meeting with Ajvad": "16h 47m",                 # due 08 → 09 Oct 00:00 → 16:47
    "Google Ads Optimisation - DXB": None,           # submitted on the due day (was "2h 04m")
    "blr Malayalam leads counts": None,
    "Check Nidhin Leads in CRM": None,
    "Check Leads in CRM and tally": "21h 51m",       # due 06 → 07 Oct 00:00 → 21:51
    "Review all campaigns": "3d 21h 53m",            # due 03 → 04 Oct 00:00 → 07 Oct 21:53
    "Share September reports": None,
    "Submitted late, awaiting approval": "14h 00m",  # due 08 → 09 Oct 00:00 → 14:00, fixed (not "so far")
}


async def test_late_by_through_the_real_workflow(monkeypatch):
    client = AsyncIOMotorClient(settings.mongodb_url, serverSelectionTimeoutMS=3000)
    try:
        await client.admin.command("ping")
    except Exception:
        client.close()
        pytest.skip("MongoDB not reachable — integration test skipped")
    db_name = f"mediaerp_test_lateby_{secrets.token_hex(4)}"
    db = client[db_name]
    try:
        roles = {"TL": {"_id": ObjectId(), "role_name": "Team Leader"},
                 "EM": {"_id": ObjectId(), "role_name": "Employee"}}
        U = {"LEAD": ObjectId(), "SHA": ObjectId()}
        s = {k: str(v) for k, v in U.items()}
        names = {"LEAD": "Ashik Lead", "SHA": "Sharanya"}
        role_of = {"LEAD": "TL", "SHA": "EM"}
        await db["users"].insert_many([{"_id": U[k], "name": names[k], "email": f"{k.lower()}@t.io",
                                        "role_id": str(roles[role_of[k]]["_id"]), "status": "active"} for k in U])
        team = {"_id": ObjectId(), "name": "Marketing", "members": [
            {"user_id": s["LEAD"], "role": "leader"}, {"user_id": s["SHA"], "role": "member"}]}
        await db["teams"].insert_one(team)
        T = str(team["_id"])

        def as_user(key):
            async def _user():
                return {"_id": U[key], "name": names[key], "email": f"{key.lower()}@t.io",
                        "role_id": str(roles[role_of[key]]["_id"]), "_role": roles[role_of[key]]}
            return _user

        app.dependency_overrides[get_db] = lambda: db
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as ac:
            async def call(who, method, url, **kw):
                app.dependency_overrides[get_current_user] = as_user(who)
                r = await ac.request(method, url, **kw)
                return r

            ids = {}
            for title, due, (st, sub, appr) in ROWS:
                r = await call("LEAD", "POST", "/api/v1/projects", json={
                    "title": title, "team_id": T, "assigned_to": s["SHA"], "assigned_to_name": "Sharanya",
                    "due_date": "2026-12-31", "priority": "medium"})
                assert r.status_code == 201, r.text
                tid = r.json()["data"]["id"]; ids[title] = tid
                if st:
                    r = await call("SHA", "PUT", f"/api/v1/projects/{tid}", json={"status": "started"})
                    assert r.status_code == 200, r.text
                if sub:
                    r = await call("SHA", "PUT", f"/api/v1/projects/{tid}",
                                   json={"status": "pending_review", "caption": "Done"})
                    assert r.status_code == 200, r.text
                if appr:
                    doc = await db["project_tasks"].find_one({"_id": ObjectId(tid)})
                    if any(v.get("user_id") == s["LEAD"] for v in doc.get("verifications") or []):
                        r = await call("LEAD", "POST", f"/api/v1/verify/{tid}", json={"passed": True})
                        assert r.status_code == 200, r.text
                    r = await call("LEAD", "PUT", f"/api/v1/projects/{tid}", json={"status": "approved"})
                    assert r.status_code == 200, r.text

                # Move the app-written history to the report's times (and the due date to the past).
                doc = await db["project_tasks"].find_one({"_id": ObjectId(tid)})
                when = {"started": st, "pending_review": sub, "approved": appr, "verified": appr}
                hist = []
                for h in doc.get("history") or []:
                    t_ = when.get(h.get("action"))
                    hist.append({**h, "timestamp": t_ or at(2026, 9, 30, 10, 0)})
                timing = doc.get("timing") or {}
                if st and sub:
                    timing = {**timing, "intervals": [{"started_at": st, "ended_at": sub}],
                              "total_seconds": int((sub - st).total_seconds())}
                await db["project_tasks"].update_one({"_id": doc["_id"]}, {"$set": {
                    "history": hist, "due_date": due, "timing": timing,
                    "created_at": at(2026, 9, 30, 10, 0), "updated_at": appr or sub or at(2026, 9, 30, 10, 0)}})

            # ── 1. The downloaded PDF (built from the API's own task list) ──
            r = await call("LEAD", "GET", "/api/v1/projects/overview/pdf", params={"member_id": s["SHA"]})
            assert r.status_code == 200 and r.content.startswith(b"%PDF"), r.text[:200]
            text = pdf_strings(r.content)
            for bad in ("2h 04m", "30h 33m", "11h 33m", "5h 54m", "28h 30m", "days past due"):
                assert bad not in text, f"old value {bad} still printed"
            for want in ("3d 21h 53m", "21h 51m", "16h 47m", "14h 00m", "On time"):
                assert want in text, want
            assert text.count("On time") == 4, text.count("On time")
            assert "so far" in text, "the not-started task is still late 'so far'"

            # ── 2. The same rows through the pure function, on the API's serialized tasks ──
            from app.services import overview_report_service as svc
            r = await call("LEAD", "GET", "/api/v1/projects", params={"member_id": s["SHA"]})
            listed = {t["title"]: t for t in r.json()["data"]}
            now = datetime(2026, 10, 13, 12, 33, tzinfo=IST)
            for title, want in EXPECT.items():
                tl = svc.task_timeline(listed[title], now=now)
                got = svc.fmt_late(tl["late"]) if tl["late"] is not None else None
                assert got == want, (title, got, want)
            dubai = svc.task_timeline(listed["Google Ads New Campaign Dubai"], now=now)
            assert svc.fmt_late(dubai["late"]) == "9d 12h 33m" and dubai["late_open"]   # 04 Oct 00:00 → 13 Oct 12:33

            # ── 3. Performance: per-task "On time" and the on-time rate ──
            r = await call("LEAD", "GET", "/api/v1/performance/tasks", params={
                "user_id": s["SHA"], "role": "member", "date_from": "2026-09-01", "date_to": "2026-10-31"})
            assert r.status_code == 200, r.text
            body = r.json()["data"]
            rows = body if isinstance(body, list) else (body.get("tasks") or body.get("items") or body.get("rows"))
            on_time = {x["title"]: x["on_time"] for x in rows}
            assert on_time == {
                "Meeting with Ajvad": False, "Google Ads Optimisation - DXB": True,
                "blr Malayalam leads counts": True, "Check Nidhin Leads in CRM": True,
                "Check Leads in CRM and tally": False, "Review all campaigns": False,
                "Share September reports": True}, on_time
            r = await call("LEAD", "GET", "/api/v1/performance",
                           params={"date_from": "2026-09-01", "date_to": "2026-10-31"})
            assert r.status_code == 200, r.text
            flat = re.sub(r"\s", "", r.text)
            assert '"on_time_rate":57' in flat, "4 of 7 approved on time → 57% (was 1 of 7 → 14%)"
    finally:
        app.dependency_overrides.clear()
        await client.drop_database(db_name)
        client.close()
