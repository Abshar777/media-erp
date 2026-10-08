"""
"Ad not performing" — marketing flags an ad, a chosen team leader recreates it.

Drives the real endpoints against a throwaway MongoDB database (created and
dropped here). Skips without Mongo.

Fixture
  Marketing  leader MLEAD, members ASHA (on the ad), OMAR
  Media      leader MEDLEAD, member VIC
  Design     leader DLEAD, and GONE (an inactive leader)
  SA = Super Admin, STRANGER = an employee in no team
  Ad R (Marketing, assignee ASHA) with 14 days of numbers; account A (Marketing).
"""
import asyncio
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
from app.utils.timezone import today_ist


@pytest.fixture
async def w():
    client = AsyncIOMotorClient(settings.mongodb_url, serverSelectionTimeoutMS=3000)
    try:
        await client.admin.command("ping")
    except Exception:
        client.close()
        pytest.skip("MongoDB not reachable — integration tests skipped")
    name = f"mediaerp_test_adflag_{secrets.token_hex(4)}"
    db = client[name]
    roles = {r: {"_id": ObjectId(), "role_name": r} for r in ("Team Leader", "Employee", "Super Admin")}
    await db["roles"].insert_many(list(roles.values()))
    people = {"mlead": "Team Leader", "medlead": "Team Leader", "dlead": "Team Leader", "gone": "Team Leader",
              "asha": "Employee", "omar": "Employee", "vic": "Employee", "stranger": "Employee", "sa": "Super Admin"}
    U = {k: ObjectId() for k in people}
    await db["users"].insert_many([{"_id": U[k], "name": k.title(), "email": f"{k}@t.io",
                                    "is_active": k != "gone", "role_id": str(roles[r]["_id"])}
                                   for k, r in people.items()])
    s = {k: str(v) for k, v in U.items()}

    def team(nm, leaders, members):
        return {"_id": ObjectId(), "name": nm, "color": "#888",
                "members": [{"user_id": s[x], "role": "leader"} for x in leaders]
                           + [{"user_id": s[x], "role": "member"} for x in members]}
    mkt, media, design = team("Marketing", ["mlead"], ["asha", "omar"]), team("Media", ["medlead"], ["vic"]), \
        team("Design", ["dlead", "gone"], [])
    await db["teams"].insert_many([mkt, media, design])
    t = {"mkt": str(mkt["_id"]), "media": str(media["_id"]), "design": str(design["_id"])}

    today = today_ist()
    now = datetime.now(timezone.utc)
    R = {"_id": ObjectId(), "name": "Open Day Reel", "platform": "meta", "team_id": t["mkt"],
         "assignees": [s["asha"]], "start_date": (today - timedelta(days=30)).isoformat(), "end_date": None,
         "extra_metrics": [], "currency": "INR", "status": "active", "pauses": [], "creatives": [],
         "reminder_due": "12:00", "reminder_escalate": "17:00", "created_at": now, "updated_at": now}
    A = {**R, "_id": ObjectId(), "name": "Delta — Meta", "kind": "account", "assignees": []}
    await db[ar.REPORTS].insert_many([R, A])
    # Last 7 complete days: 2 leads/day for ₹100; the 7 before: 5 leads/day for ₹100.
    entries = []
    for i in range(1, 15):
        d = (today - timedelta(days=i)).isoformat()
        entries.append({"report_id": str(R["_id"]), "date": d,
                        "values": {"leads": 2 if i <= 7 else 5, "spend": 10000}})
    await db[ar.ENTRIES].insert_many(entries)
    await ar.ensure_indexes(db)
    await fl.ensure_indexes(db)

    def as_user(k):
        async def _u():
            return {"_id": U[k], "name": k.title(), "email": f"{k}@t.io",
                    "role_id": str(roles[people[k]]["_id"]), "_role": roles[people[k]]}
        return _u

    app.dependency_overrides[get_db] = lambda: db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as ac:
        async def call(method, path, who, **kw):
            app.dependency_overrides[get_current_user] = as_user(who)
            return await ac.request(method, path, **kw)
        yield {"db": db, "s": s, "t": t, "R": str(R["_id"]), "A": str(A["_id"]), "call": call}
    app.dependency_overrides.clear()
    await client.drop_database(name)
    client.close()


async def bells(w, who, kind=None):
    await asyncio.sleep(0.15)          # delivery is fire-and-forget
    q = {"user_id": ObjectId(w["s"][who])}
    if kind:
        q["type"] = kind
    return await w["db"]["notifications"].find(q).to_list(50)


def body(w, to="medlead", team="media", **kw):
    return {"recipient_id": w["s"][to], "recipient_team_id": w["t"][team],
            "reasons": ["high_cpl", "few_leads"], "note": "CPL doubled this week", **kw}


async def test_draft_gives_leaders_snapshot_and_rules(w):
    r = await w["call"]("GET", f"/api/v1/ad-reports/{w['R']}/flag-draft", "asha")
    assert r.status_code == 200, r.text
    d = r.json()["data"]
    leaders = {(t["team_name"], l["name"]) for t in d["recipients"] for l in t["leaders"]}
    assert leaders == {("Marketing", "Mlead"), ("Media", "Medlead"), ("Design", "Dlead")}, "no inactive leader"
    assert d["default"] is None and len(d["reasons"]) == len(fl.REASONS)
    snap = d["snapshot"]
    # The report's own calculation: 14 leads for ₹700 → ₹50 a lead; before: 35 leads.
    assert snap["totals"]["leads"] == 14 and snap["totals"]["spend"] == 70000 and snap["totals"]["cpl"] == 5000
    assert snap["previous"]["leads"] == 35 and len(snap["sparkline"]) == 14
    # A leader isn't offered themselves.
    d2 = (await w["call"]("GET", f"/api/v1/ad-reports/{w['R']}/flag-draft", "mlead")).json()["data"]
    assert "Mlead" not in {l["name"] for t in d2["recipients"] for l in t["leaders"]}
    # Strangers get the same 404 as a missing id; accounts aren't flagged.
    assert (await w["call"]("GET", f"/api/v1/ad-reports/{w['R']}/flag-draft", "stranger")).status_code == 404
    assert (await w["call"]("GET", f"/api/v1/ad-reports/{w['R']}/flag-draft", "medlead")).status_code == 404
    assert (await w["call"]("GET", f"/api/v1/ad-reports/{w['A']}/flag-draft", "mlead")).status_code == 409


async def test_sending_validates_and_notifies(w):
    url = f"/api/v1/ad-reports/{w['R']}/flags"
    bad = [
        (body(w, reasons=[], note="  "), 422, "a reason or a note"),
        (body(w, "mlead", "mkt"), 422, "not yourself"),
        (body(w, "omar", "mkt"), 422, "not a leader"),
        (body(w, "medlead", "design"), 422, "leader of a different team"),
        (body(w, "gone", "design"), 422, "inactive leader"),
    ]
    for b, code, why in bad:
        who = "mlead" if why == "not yourself" else "asha"
        r = await w["call"]("POST", url, who, json=b)
        assert r.status_code == code, (why, r.text)
    assert (await w["call"]("POST", url, "stranger", json=body(w))).status_code == 404
    assert (await w["call"]("POST", f"/api/v1/ad-reports/{w['A']}/flags", "mlead", json=body(w))).status_code == 409

    r = await w["call"]("POST", url, "asha", json=body(w, reasons=["high_cpl", "nonsense", "high_cpl"]))
    assert r.status_code == 201, r.text
    f = r.json()["data"]
    assert f["status"] == "open" and [x["key"] for x in f["reasons"]] == ["high_cpl"]
    assert f["recipient"]["name"] == "Medlead" and f["recipient"]["team_name"] == "Media"
    assert f["snapshot"]["totals"]["leads"] == 14 and f["can_withdraw"] and not f["can_act"]
    n = await bells(w, "medlead", fl.NOTIF_FLAGGED)
    assert len(n) == 1 and n[0]["title"] == "Ad not performing: Open Day Reel"
    assert n[0]["metadata"]["link"] == f"/leader?tab=ads&flag={f['id']}"

    # One open flag per ad.
    r = await w["call"]("POST", url, "mlead", json=body(w, "dlead", "design"))
    assert r.status_code == 409 and "Medlead" in r.json()["message"]
    # The next time, the dialog pre-selects whoever this ad went to.
    assert (await w["call"]("GET", f"/api/v1/ad-reports/{w['R']}/flag-draft", "omar")).status_code == 404,         "a teammate who isn't on the ad can't flag it"
    d = (await w["call"]("GET", f"/api/v1/ad-reports/{w['R']}/flag-draft", "mlead")).json()["data"]
    assert d["default"] == {"recipient_id": w["s"]["medlead"], "team_id": w["t"]["media"]}
    assert d["active_flag"]["id"] == f["id"]

    # The ad's report shows the status line.
    lst = (await w["call"]("GET", "/api/v1/ad-reports", "asha")).json()["data"]
    row = next(x for x in lst if x["id"] == w["R"])
    assert row["flag"]["active"] and row["flag"]["recipient_name"] == "Medlead"
    lead_list = (await w["call"]("GET", "/api/v1/ad-reports", "mlead")).json()["data"]
    assert next(x for x in lead_list if x["id"] == w["A"])["flag"] is None, "accounts carry no flag"


async def test_leader_desk_inbox_and_lifecycle(w):
    url = f"/api/v1/ad-reports/{w['R']}/flags"
    fid = (await w["call"]("POST", url, "asha", json=body(w))).json()["data"]["id"]
    F = f"/api/v1/ad-flags/{fid}"

    inbox = (await w["call"]("GET", "/api/v1/ad-flags/inbox", "medlead")).json()["data"]
    assert [x["id"] for x in inbox["active"]] == [fid] and inbox["closed"] == []
    one = inbox["active"][0]
    assert one["can_act"] and not one["can_open_report"], "the media leader acts, but can't open Marketing's report"
    assert (await w["call"]("GET", "/api/v1/ad-flags/inbox", "dlead")).json()["data"]["active"] == []

    # Who may see it: recipient, sender, the ad's team, admins — not others.
    assert (await w["call"]("GET", F, "mlead")).json()["data"]["can_open_report"] is True
    for who in ("stranger", "dlead", "vic"):
        assert (await w["call"]("GET", F, who)).status_code == 404, who

    # Only the recipient (or an admin) moves it along.
    assert (await w["call"]("PATCH", F, "asha", json={"action": "start"})).status_code == 403
    assert (await w["call"]("PATCH", F, "mlead", json={"action": "done"})).status_code == 403
    r = await w["call"]("PATCH", F, "medlead", json={"action": "start"})
    assert r.status_code == 200 and r.json()["data"]["status"] == "in_progress"
    upd = await bells(w, "asha", fl.NOTIF_UPDATE)
    assert len(upd) == 1 and upd[0]["title"] == "Being recreated: Open Day Reel", "sender = assignee → one bell"
    assert upd[0]["metadata"]["link"] == f"/ad-reports?report={w['R']}"
    assert (await w["call"]("PATCH", F, "medlead", json={"action": "start"})).status_code == 409
    # Too late to withdraw once work has started.
    assert (await w["call"]("PATCH", F, "asha", json={"action": "withdraw"})).status_code == 409
    # Declining needs a reason.
    assert (await w["call"]("PATCH", F, "medlead", json={"action": "decline", "note": " "})).status_code == 422
    r = await w["call"]("PATCH", F, "medlead", json={"action": "done", "note": "New reel uploaded"})
    assert r.status_code == 200 and r.json()["data"]["status"] == "done"
    assert [h["action"] for h in r.json()["data"]["history"]] == ["flagged", "start", "done"]
    assert len(await bells(w, "asha", fl.NOTIF_UPDATE)) == 2
    assert not await w["db"][fl.FLAGS].find_one({"_id": ObjectId(fid), "active": True})

    inbox = (await w["call"]("GET", "/api/v1/ad-flags/inbox", "medlead")).json()["data"]
    assert inbox["active"] == [] and [x["id"] for x in inbox["closed"]] == [fid]
    row = next(x for x in (await w["call"]("GET", "/api/v1/ad-reports", "asha")).json()["data"] if x["id"] == w["R"])
    assert row["flag"]["status"] == "done" and not row["flag"]["active"]

    # Closed → the ad can be flagged again; the sender may withdraw while it's still open.
    fid2 = (await w["call"]("POST", url, "mlead", json=body(w, "dlead", "design"))).json()["data"]["id"]
    assert (await w["call"]("PATCH", f"/api/v1/ad-flags/{fid2}", "asha", json={"action": "withdraw"})).status_code == 403
    r = await w["call"]("PATCH", f"/api/v1/ad-flags/{fid2}", "mlead", json={"action": "withdraw"})
    assert r.status_code == 200 and r.json()["data"]["status"] == "withdrawn"
    assert any(n["title"] == "Withdrawn: Open Day Reel" for n in await bells(w, "dlead"))

    # Admins can act on any flag.
    fid3 = (await w["call"]("POST", url, "asha", json=body(w))).json()["data"]["id"]
    r = await w["call"]("PATCH", f"/api/v1/ad-flags/{fid3}", "sa", json={"action": "decline", "note": "Budget cut"})
    assert r.status_code == 200 and r.json()["data"]["resolution_note"] == "Budget cut"
    assert (await w["call"]("PATCH", f"/api/v1/ad-flags/{fid3}", "medlead", json={"action": "bogus"})).status_code == 422


async def test_sender_and_admins_see_flags_in_flight(w):
    """
    The bug report: a Super Admin sent an ad, opened their own Leader Desk and
    saw nothing — Ads to redo only listed flags sent TO the viewer. Now the
    sender has "Sent by me" and admin roles have "All".
    """
    fid = (await w["call"]("POST", f"/api/v1/ad-reports/{w['R']}/flags", "sa", json=body(w))).json()["data"]["id"]

    async def inbox(who, scope=None):
        params = {"scope": scope} if scope else {}
        r = await w["call"]("GET", "/api/v1/ad-flags/inbox", who, params=params)
        assert r.status_code == 200, r.text
        return r.json()["data"]

    d = await inbox("sa")                                   # default view = sent to me
    assert d["scope"] == "to_me" and d["active"] == []
    assert d["scopes"] == ["to_me", "sent", "all"]
    assert d["counts"] == {"to_me": 0, "sent": 1, "all": 1}, "the desk can open on the view that has it"
    sent = await inbox("sa", "sent")
    assert [x["id"] for x in sent["active"]] == [fid]
    assert sent["active"][0]["recipient"]["name"] == "Medlead" and sent["active"][0]["can_withdraw"]
    assert [x["id"] for x in (await inbox("sa", "all"))["active"]] == [fid]

    # The recipient sees it as before.
    assert [x["id"] for x in (await inbox("medlead"))["active"]] == [fid]
    # A non-admin can't use "all" — they get their own view instead, never others' flags.
    d = await inbox("dlead", "all")
    assert d["scope"] == "to_me" and d["active"] == [] and "all" not in d["scopes"]
    assert (await w["call"]("GET", "/api/v1/ad-flags/inbox", "dlead", params={"scope": "bogus"})).status_code == 422

    # Withdrawn → leaves the open lists, stays visible as recently closed.
    await w["call"]("PATCH", f"/api/v1/ad-flags/{fid}", "sa", json={"action": "withdraw"})
    sent = await inbox("sa", "sent")
    assert sent["active"] == [] and [x["status"] for x in sent["closed"]] == ["withdrawn"]
    assert sent["counts"]["sent"] == 0 and sent["recent"]["sent"] == 1


async def test_send_message_and_same_name_leaders(w):
    # A second leader called "Medlead" (three "Basil Mohammed" accounts exist in real data).
    twin = ObjectId()
    await w["db"]["users"].insert_one({"_id": twin, "name": "Medlead", "email": "medlead.two@t.io", "is_active": True})
    await w["db"]["teams"].update_one({"_id": ObjectId(w["t"]["design"])},
                                      {"$push": {"members": {"user_id": str(twin), "role": "leader"}}})
    d = (await w["call"]("GET", f"/api/v1/ad-reports/{w['R']}/flag-draft", "asha")).json()["data"]
    twins = [l for t in d["recipients"] for l in t["leaders"] if l["name"] == "Medlead"]
    assert sorted(l["email"] for l in twins) == ["medlead.two@t.io", "medlead@t.io"]
    assert all(l["email"] == "" for t in d["recipients"] for l in t["leaders"] if l["name"] != "Medlead")

    r = await w["call"]("POST", f"/api/v1/ad-reports/{w['R']}/flags", "asha", json=body(w))
    assert r.json()["message"] == "Sent to Medlead — it's in their Leader Desk → Ads to redo"

    # A non-leader account sharing a leader's name is enough to show the email.
    await w["db"]["users"].insert_one({"_id": ObjectId(), "name": "Dlead", "email": "dlead.other@t.io", "is_active": True})
    d = (await w["call"]("GET", f"/api/v1/ad-reports/{w['R']}/flag-draft", "mlead")).json()["data"]
    assert [l["email"] for t in d["recipients"] for l in t["leaders"] if l["name"] == "Dlead"] == ["dlead@t.io"]
