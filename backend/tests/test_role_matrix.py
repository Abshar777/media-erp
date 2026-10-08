"""
Role matrix — every new feature, as every kind of user.

Roles (the five system roles + the awkward cases real data has):
  SA        Super Admin
  ADMIN     Admin
  COORD     Coordinator
  TL        Team Leader, leads Marketing
  OTHERTL   Team Leader, leads Design (not Marketing)
  PIA       Employee ROLE who leads Media by membership
  EMP       Employee in Marketing (the person on the ad)
  EMP2      Employee in Media
  LONER     Employee in no team
  CUSTOM    a custom role ("Finance"), in no team

Teams: Marketing (TL; EMP, EMP3) · Media (PIA; EMP2) · Design (OTHERTL)

Features: Overview (list + member + date filters, PDF), Leader Desk, multi-assign
+ repeating tasks, saved tasks, Ad Reports, "Ad not performing" flags.

Integration test on a throwaway MongoDB database (created and dropped here).
Skips when Mongo is down.
"""
import asyncio
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
from app.services import ad_flag_service as fl
from app.services import ad_report_service as ar
from app.services import overview_report_service as ovs
from app.utils.timezone import today_ist

ROLE_OF = {"SA": "Super Admin", "ADMIN": "Admin", "COORD": "Coordinator", "TL": "Team Leader",
           "OTHERTL": "Team Leader", "PIA": "Employee", "EMP": "Employee", "EMP2": "Employee",
           "EMP3": "Employee", "LONER": "Employee", "CUSTOM": "Finance"}
ELEVATED = ("SA", "ADMIN", "COORD")
EVERYONE = ("SA", "ADMIN", "COORD", "TL", "OTHERTL", "PIA", "EMP", "EMP2", "LONER", "CUSTOM")


@pytest.fixture
async def w(monkeypatch):
    client = AsyncIOMotorClient(settings.mongodb_url, serverSelectionTimeoutMS=3000)
    try:
        await client.admin.command("ping")
    except Exception:
        client.close()
        pytest.skip("MongoDB not reachable — integration tests skipped")
    name = f"mediaerp_test_roles_{secrets.token_hex(4)}"
    db = client[name]
    import app.database as dbmod
    monkeypatch.setattr(dbmod, "_client", client)
    monkeypatch.setitem(settings.__dict__, "mongodb_db_name", name)

    roles = {r: {"_id": ObjectId(), "role_name": r, "is_system_role": r != "Finance"}
             for r in set(ROLE_OF.values())}
    await db["roles"].insert_many(list(roles.values()))
    U = {k: ObjectId() for k in ROLE_OF}
    s = {k: str(v) for k, v in U.items()}
    await db["users"].insert_many([{"_id": U[k], "name": k.title(), "email": f"{k.lower()}@t.io", "is_active": True,
                                    "role_id": str(roles[r]["_id"])} for k, r in ROLE_OF.items()])

    def team(nm, leader, *members):
        return {"_id": ObjectId(), "name": nm, "color": "#888",
                "members": [{"user_id": s[leader], "role": "leader"}] + [{"user_id": s[m], "role": "member"} for m in members]}
    mkt, media, design = team("Marketing", "TL", "EMP", "EMP3"), team("Media", "PIA", "EMP2"), team("Design", "OTHERTL")
    await db["teams"].insert_many([mkt, media, design])
    T = {"mkt": str(mkt["_id"]), "media": str(media["_id"]), "design": str(design["_id"])}

    today = today_ist()
    now = datetime.now(timezone.utc)

    def task(title, who, team_id, days_ago, status="pending", due=None):
        at = now - timedelta(days=days_ago)
        return {"title": title, "assigned_to": s[who], "assigned_to_name": who.title(), "status": status,
                "priority": "medium", "attachments": [], "created_by": s["TL"], "team_id": team_id,
                "due_date": due, "created_at": at, "updated_at": at,
                "history": [{"action": "created", "timestamp": at}], "timing": {"intervals": [], "total_seconds": None}}
    await db["project_tasks"].insert_many([
        task("emp-recent", "EMP", T["mkt"], 1), task("emp-old", "EMP", T["mkt"], 40),
        task("emp3-recent", "EMP3", T["mkt"], 2),
        task("emp2-media", "EMP2", T["media"], 1), task("pia-own", "PIA", T["media"], 1),
        task("othertl-design", "OTHERTL", T["design"], 1),
    ])

    R = {"_id": ObjectId(), "name": "Open Day Reel", "platform": "meta", "team_id": T["mkt"], "assignees": [s["EMP"]],
         "start_date": (today - timedelta(days=20)).isoformat(), "end_date": None, "extra_metrics": [],
         "currency": "INR", "status": "active", "pauses": [], "creatives": [], "reminder_due": "12:00",
         "reminder_escalate": "17:00", "created_at": now, "updated_at": now}
    await db[ar.REPORTS].insert_one(R)
    await db[ar.ENTRIES].insert_many([{"report_id": str(R["_id"]), "date": (today - timedelta(days=i)).isoformat(),
                                       "values": {"leads": 3, "spend": 10000}} for i in range(2, 15)])
    await ar.ensure_indexes(db)
    await fl.ensure_indexes(db)

    def as_user(k):
        async def _u():
            r = roles[ROLE_OF[k]]
            return {"_id": U[k], "name": k.title(), "email": f"{k.lower()}@t.io", "role_id": str(r["_id"]), "_role": r}
        return _u

    app.dependency_overrides[get_db] = lambda: db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as ac:
        async def call(method, path, who, **kw):
            app.dependency_overrides[get_current_user] = as_user(who)
            return await ac.request(method, path, **kw)
        yield {"db": db, "s": s, "T": T, "R": str(R["_id"]), "call": call}
    app.dependency_overrides.clear()
    await asyncio.sleep(0.2)               # let fire-and-forget notifications finish
    await client.drop_database(name)
    client.close()


def check(results: dict, expected: dict, what: str):
    bad = {k: (results[k], expected[k]) for k in expected if results[k] != expected[k]}
    assert not bad, f"{what}: role → (got, expected) {bad}"


async def test_leader_desk_and_overview_visibility(w):
    call, s = w["call"], w["s"]
    # Leader Desk: admin roles and anyone who leads a team (even an Employee-role leader).
    got = {k: (await call("GET", "/api/v1/projects/leader/queue", k)).json()["data"]["is_leader"] for k in EVERYONE}
    check(got, {"SA": True, "ADMIN": True, "COORD": True, "TL": True, "OTHERTL": True, "PIA": True,
                "EMP": False, "EMP2": False, "LONER": False, "CUSTOM": False}, "Leader Desk access")

    async def titles(who, **params):
        r = await call("GET", "/api/v1/projects", who, params=params)
        assert r.status_code == 200, (who, r.text)
        return sorted(t["title"] for t in r.json()["data"])

    everything = ["emp-old", "emp-recent", "emp2-media", "emp3-recent", "othertl-design", "pia-own"]
    got = {k: await titles(k) for k in EVERYONE}
    check(got, {"SA": everything, "ADMIN": everything, "COORD": everything,
                "TL": ["emp-old", "emp-recent", "emp3-recent"], "OTHERTL": ["othertl-design"],
                "PIA": ["pia-own"],              # Employee ROLE → own work, though they lead Media
                "EMP": ["emp-old", "emp-recent"], "EMP2": ["emp2-media"], "LONER": [], "CUSTOM": []},
          "Overview — own scope")

    # Member filter (Sara = EMP): leaders of EMP + admins see EMP; others never see EMP's work.
    got = {k: await titles(k, member_id=s["EMP"]) for k in EVERYONE}
    emp = ["emp-old", "emp-recent"]
    check(got, {"SA": emp, "ADMIN": emp, "COORD": emp, "TL": emp,
                "OTHERTL": [],                    # refused: not one of theirs
                "PIA": ["pia-own"], "EMP": emp, "EMP2": ["emp2-media"], "LONER": [], "CUSTOM": []},
          "Overview — member filter")

    # Member + date filter together: last 7 days drops "emp-old" (40 days ago) for everyone who sees EMP.
    t = today_ist()
    rng = {"date_filter": "custom", "date_from": (t - timedelta(days=6)).isoformat(), "date_to": t.isoformat()}
    got = {k: await titles(k, member_id=s["EMP"], **rng) for k in ("SA", "ADMIN", "COORD", "TL", "OTHERTL", "EMP")}
    check(got, {"SA": ["emp-recent"], "ADMIN": ["emp-recent"], "COORD": ["emp-recent"], "TL": ["emp-recent"],
                "OTHERTL": [], "EMP": ["emp-recent"]}, "Overview — member + date")


async def test_overview_pdf_for_every_role(w, monkeypatch):
    call, s = w["call"], w["s"]
    captured = []
    real = ovs.build_pdf
    monkeypatch.setattr(ovs, "build_pdf", lambda **kw: (captured.append(kw), real(**kw))[1])
    for who in EVERYONE:
        for params in ({}, {"member_id": s["EMP"]}, {"member_id": s["EMP"], "date_filter": "this_month"}):
            lst = await call("GET", "/api/v1/projects", who, params=params)
            pdf = await call("GET", "/api/v1/projects/overview/pdf", who, params=params)
            assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF"), (who, params, pdf.text[:200])
            assert [t["id"] for t in captured[-1]["tasks"]] == [t["id"] for t in lst.json()["data"]], \
                f"{who} {params}: the PDF must hold exactly the Overview's tasks"
            fname = re.search(r'filename="([^"]+)"', pdf.headers["content-disposition"]).group(1)
            assert re.fullmatch(r"overview_[a-z0-9-]+_[a-z0-9_-]+_made-\d{4}-\d{2}-\d{2}-\d{4}\.pdf", fname), fname
    # Who gets a named report for EMP, and who doesn't (no leak of the name).
    heads = {}
    for who in EVERYONE:
        await call("GET", "/api/v1/projects/overview/pdf", who, params={"member_id": s["EMP"]})
        heads[who] = captured[-1]["heading"]
    check(heads, {"SA": "Emp's overview", "ADMIN": "Emp's overview", "COORD": "Emp's overview", "TL": "Emp's overview",
                  "OTHERTL": "Member overview", "PIA": "Pia's overview", "EMP": "Emp's overview",
                  "EMP2": "Emp2's overview", "LONER": "Loner's overview", "CUSTOM": "Custom's overview"},
          "PDF heading for member EMP")


async def test_multi_assign_and_repeating_tasks(w):
    call, s, T = w["call"], w["s"], w["T"]
    due = (today_ist() + timedelta(days=2)).isoformat()      # one-off tasks need a due date
    body = lambda team, **kw: {"title": "Daily reel edit", "team_id": T[team], "priority": "medium",
                               "assignees": [s["EMP"], s["EMP3"]], "due_date": due, **kw}
    # One-off work for colleagues is open to every role, across team lines — the
    # same deliberate rule as a normal "Add Task" (workflow.can_assign_task).
    # Each person gets their own copy.
    got = {}
    for k in ("SA", "ADMIN", "COORD", "TL", "OTHERTL", "PIA", "EMP", "LONER", "CUSTOM"):
        r = await call("POST", "/api/v1/projects/batch", k, json=body("mkt"))
        got[k] = r.status_code
        if r.status_code == 201:
            assert sorted(t["assigned_to"] for t in r.json()["data"]["tasks"]) == sorted([s["EMP"], s["EMP3"]]), k
    check(got, {k: 201 for k in got}, "multi-assign (once)")
    # …but naming an APPROVER (approval rights) stays leader / admin only.
    appr = {k: (await call("POST", "/api/v1/projects/batch", k, json=body("mkt", approver_id=s["TL"]))).status_code
            for k in ("SA", "TL", "EMP", "OTHERTL", "CUSTOM")}
    check(appr, {"SA": 201, "TL": 201, "EMP": 403, "OTHERTL": 403, "CUSTOM": 403}, "choose an approver")
    r = await call("POST", "/api/v1/projects/batch", "PIA",
                   json={"title": "Thumbnail", "team_id": T["media"], "due_date": due,
                         "assignees": [s["EMP2"], s["PIA"]]})
    assert r.status_code == 201, r.text

    # Repeating tasks keep assigning on someone's behalf: leader / admin only.
    rep = {"frequency": "daily", "count": 3}
    got = {k: (await call("POST", "/api/v1/projects/batch", k, json=body("mkt", repeat=rep))).status_code
           for k in ("SA", "COORD", "TL", "OTHERTL", "EMP", "CUSTOM")}
    check(got, {"SA": 201, "COORD": 201, "TL": 201, "OTHERTL": 403, "EMP": 403, "CUSTOM": 403}, "repeating task")
    # The series LIST is for people who manage series (creator, team leader, admins)…
    lists = {k: [x["id"] for x in (await call("GET", "/api/v1/projects/recurring", k)).json()["data"]]
             for k in ("SA", "ADMIN", "COORD", "TL", "EMP", "EMP2", "OTHERTL", "LONER")}
    check({k: bool(v) for k, v in lists.items()},
          {"SA": True, "ADMIN": True, "COORD": True, "TL": True, "EMP": False, "EMP2": False, "OTHERTL": False, "LONER": False},
          "repeating-series list (managers)")
    # …while an assignee opens the series from their task (detail), and outsiders get 404.
    sid = lists["TL"][0]
    detail = {k: (await call("GET", f"/api/v1/projects/recurring/{sid}", k)).status_code
              for k in ("SA", "TL", "EMP", "EMP3", "EMP2", "OTHERTL", "LONER", "CUSTOM")}
    check(detail, {"SA": 200, "TL": 200, "EMP": 200, "EMP3": 200,
                   "EMP2": 404, "OTHERTL": 404, "LONER": 404, "CUSTOM": 404}, "repeating-series detail")


async def test_saved_tasks(w):
    call, T = w["call"], w["T"]
    url = "/api/v1/task-presets"
    team = lambda who: call("POST", url, who, json={"team_id": T["mkt"], "title": f"Reel by {who}"})
    got = {k: (await team(k)).status_code for k in ("SA", "ADMIN", "COORD", "TL", "OTHERTL", "PIA", "EMP", "CUSTOM")}
    check(got, {"SA": 201, "ADMIN": 201, "COORD": 201, "TL": 201,
                "OTHERTL": 403, "PIA": 403, "EMP": 403, "CUSTOM": 403}, "save a Marketing task name")
    comp = lambda who: call("POST", url, who, json={"team_id": None, "title": f"Weekly report {who}"})
    got = {k: (await comp(k)).status_code for k in ("SA", "ADMIN", "COORD", "TL", "EMP")}
    check(got, {"SA": 201, "ADMIN": 201, "COORD": 201, "TL": 403, "EMP": 403}, "save a company-wide task name")
    # Suggestions for Marketing: members see the team's names, outsiders only the company list.
    async def sug(who):
        d = (await call("GET", f"{url}/suggest", who, params={"team_id": T["mkt"]})).json()["data"]
        return (len(d["saved"]), d["can_save"], len(d["company"]) > 0)
    got = {k: await sug(k) for k in ("SA", "TL", "EMP", "EMP2", "LONER")}
    check(got, {"SA": (4, True, True), "TL": (4, True, True), "EMP": (4, False, True),
                "EMP2": (0, False, True), "LONER": (0, False, True)}, "suggestions in Add Task")


async def test_ad_reports_by_role(w):
    call, s, T, R = w["call"], w["s"], w["T"], w["R"]
    mk = lambda who, team="mkt", ppl=("EMP",): call("POST", "/api/v1/ad-reports", who, json={
        "name": f"Ad by {who}", "team_id": T[team], "assignees": [s[p] for p in ppl],
        "start_date": today_ist().isoformat()})
    got = {k: (await mk(k)).status_code for k in ("SA", "ADMIN", "COORD", "TL", "OTHERTL", "PIA", "EMP", "CUSTOM")}
    check(got, {"SA": 201, "ADMIN": 201, "COORD": 201, "TL": 201,
                "OTHERTL": 403, "PIA": 403, "EMP": 403, "CUSTOM": 403}, "create a Marketing ad report")
    assert (await mk("PIA", "media", ("EMP2",))).status_code == 201, "an Employee-role leader manages their own team's ads"
    # Who sees the "Open Day Reel" ad (Marketing, on EMP).
    sees = {k: any(r["id"] == R for r in (await call("GET", "/api/v1/ad-reports", k)).json()["data"]) for k in EVERYONE}
    check(sees, {"SA": True, "ADMIN": True, "COORD": True, "TL": True, "EMP": True,
                 "OTHERTL": False, "PIA": False, "EMP2": False, "LONER": False, "CUSTOM": False}, "who sees the ad")
    # Entering numbers: the assignee and the team's leader / admins; everyone else gets 404.
    day = (today_ist() - timedelta(days=1)).isoformat()
    got = {k: (await call("PUT", f"/api/v1/ad-reports/{R}/entries/{day}", k, json={"leads": 4, "spend": "100.00"})).status_code
           for k in ("EMP", "TL", "SA", "COORD", "OTHERTL", "EMP2", "CUSTOM")}
    assert got["EMP"] in (200, 201) and got["TL"] in (200, 201) and got["SA"] in (200, 201) and got["COORD"] in (200, 201), got
    check(got, {"OTHERTL": 404, "EMP2": 404, "CUSTOM": 404}, "enter ad numbers (outsiders)")


async def test_ad_not_performing_by_role(w):
    call, s, T, R = w["call"], w["s"], w["T"], w["R"]
    draft = {k: (await call("GET", f"/api/v1/ad-reports/{R}/flag-draft", k)).status_code for k in EVERYONE}
    check(draft, {"SA": 200, "ADMIN": 200, "COORD": 200, "TL": 200, "EMP": 200,
                  "OTHERTL": 404, "PIA": 404, "EMP2": 404, "LONER": 404, "CUSTOM": 404}, "who may flag the ad")
    # The "Send to" list: every active leader (by membership too), never yourself.
    rec = (await call("GET", f"/api/v1/ad-reports/{R}/flag-draft", "EMP")).json()["data"]["recipients"]
    assert {(t["team_name"], l["name"]) for t in rec for l in t["leaders"]} == \
        {("Marketing", "Tl"), ("Media", "Pia"), ("Design", "Othertl")}
    # EMP sends it to PIA (an Employee-role leader of Media).
    r = await call("POST", f"/api/v1/ad-reports/{R}/flags", "EMP",
                   json={"recipient_id": s["PIA"], "recipient_team_id": T["media"], "reasons": ["high_cpl"]})
    assert r.status_code == 201, r.text
    fid = r.json()["data"]["id"]
    # Inbox views per role.
    async def inbox(who, scope="to_me"):
        d = (await call("GET", "/api/v1/ad-flags/inbox", who, params={"scope": scope})).json()["data"]
        return d["scope"], [x["id"] for x in d["active"]]
    got = {k: await inbox(k) for k in EVERYONE}
    check(got, {k: ("to_me", [fid] if k == "PIA" else []) for k in EVERYONE}, "Sent to me")
    got = {k: await inbox(k, "all") for k in EVERYONE}
    check(got, {k: ("all", [fid]) if k in ELEVATED else ("to_me", [fid] if k == "PIA" else []) for k in EVERYONE},
          "All (admin roles only)")
    assert await inbox("EMP", "sent") == ("sent", [fid])
    # Who may open the flag: recipient, sender, the ad's people, admins.
    view = {k: (await call("GET", f"/api/v1/ad-flags/{fid}", k)).status_code for k in EVERYONE}
    check(view, {"SA": 200, "ADMIN": 200, "COORD": 200, "TL": 200, "EMP": 200, "PIA": 200,
                 "OTHERTL": 404, "EMP2": 404, "LONER": 404, "CUSTOM": 404}, "who may open the flag")
    # Who may act: the recipient (and admin roles); the sender may withdraw while open.
    act = {k: (await call("PATCH", f"/api/v1/ad-flags/{fid}", k, json={"action": "start"})).status_code
           for k in ("EMP", "TL", "COORD")}
    check(act, {"EMP": 403, "TL": 403, "COORD": 200}, "start recreating (sender / ad leader / admin)")
    r = await call("PATCH", f"/api/v1/ad-flags/{fid}", "PIA", json={"action": "done", "note": "New cut uploaded"})
    assert r.status_code == 200 and r.json()["data"]["status"] == "done"
    # The sender (and the ad's assignee) got the updates; nobody outside was told.
    await asyncio.sleep(0.2)
    told = {k: await w["db"]["notifications"].count_documents({"user_id": ObjectId(s[k]), "type": {"$in": [fl.NOTIF_FLAGGED, fl.NOTIF_UPDATE]}})
            for k in EVERYONE}
    assert told["PIA"] == 1 and told["EMP"] >= 2, told
    assert all(told[k] == 0 for k in ("OTHERTL", "EMP2", "LONER", "CUSTOM", "TL", "SA", "ADMIN")), told
