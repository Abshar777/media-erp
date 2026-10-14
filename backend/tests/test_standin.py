"""
Stand-in — a team leader hands their Leader Desk to a teammate while away
(app/services/standin_service.py, agreed 2026-10-14).

Organisation (throwaway database, clock controlled):
    Video  leaders lead, lead2   members arjun (the stand-in), asha, mira
    Design leader  lead          member  zane            (arjun is not in it)
    Other  leader  kofi          member  xav
    sa — Super Admin

Covers: who may hand over and to whom (validation), which teams are covered,
the time window (scheduled → live → over; end now; replace), what the stand-in
sees on the Leader Desk and may do there (assign, send routed work back, review
only when allowed and never their own work), work routed straight to the away
leader, alerts (hand-over, new work, reviews), the "as stand-in for" history
note, and live re-checks (removed from the team, leader demoted, deactivated).
"""
import secrets
from datetime import date, datetime, timedelta, timezone

import pytest
from bson import ObjectId
from httpx import ASGITransport, AsyncClient
from motor.motor_asyncio import AsyncIOMotorClient

from app.config import settings
from app.database import get_db
from app.main import app
from app.middleware.auth import get_current_user
from app.services import standin_service as sv
from app.utils.timezone import ist_day_start_utc

TODAY = date(2026, 10, 14)
S = "/api/v1/standin"
P = "/api/v1/projects"
ROLE = {"lead": "Team Leader", "lead2": "Team Leader", "kofi": "Team Leader", "arjun": "Employee",
        "asha": "Employee", "mira": "Employee", "zane": "Employee", "xav": "Employee", "sa": "Super Admin"}


class Clock:
    def __init__(self):
        self.t = ist_day_start_utc(TODAY) + timedelta(hours=10)      # 10:00 IST

    def now(self):
        return self.t

    def today(self):
        return (self.t + timedelta(hours=5, minutes=30)).date()

    def add(self, **kw):
        self.t += timedelta(**kw)


@pytest.fixture
async def org(monkeypatch):
    client = AsyncIOMotorClient(settings.mongodb_url, serverSelectionTimeoutMS=3000)
    try:
        await client.admin.command("ping")
    except Exception:
        client.close()
        pytest.skip("MongoDB not reachable — integration tests skipped")
    name = f"mediaerp_test_standin_{secrets.token_hex(4)}"
    db = client[name]
    import app.database as dbmod
    monkeypatch.setattr(dbmod, "_client", client)
    monkeypatch.setitem(settings.__dict__, "mongodb_db_name", name)
    clock = Clock()
    monkeypatch.setattr(sv, "_now", clock.now)
    monkeypatch.setattr(sv, "_today", clock.today)

    roles = {r: {"_id": ObjectId(), "role_name": r} for r in set(ROLE.values())}
    await db["roles"].insert_many(list(roles.values()))
    U = {k: ObjectId() for k in ROLE}
    await db["users"].insert_many([{"_id": U[k], "name": k.title(), "email": f"{k}@t.io", "is_active": True,
                                    "status": "active", "role_id": str(roles[r]["_id"])} for k, r in ROLE.items()])
    s = {k: str(v) for k, v in U.items()}
    T = {"video": ObjectId(), "design": ObjectId(), "other": ObjectId()}
    await db["teams"].insert_many([
        {"_id": T["video"], "name": "Video", "members": [{"user_id": s["lead"], "role": "leader"},
                                                         {"user_id": s["lead2"], "role": "leader"}] +
         [{"user_id": s[u], "role": "member"} for u in ("arjun", "asha", "mira")]},
        {"_id": T["design"], "name": "Design", "members": [{"user_id": s["lead"], "role": "leader"},
                                                           {"user_id": s["zane"], "role": "member"}]},
        {"_id": T["other"], "name": "Other", "members": [{"user_id": s["kofi"], "role": "leader"},
                                                         {"user_id": s["xav"], "role": "member"}]},
    ])

    def as_user(k):
        async def _u():
            return {"_id": U[k], "name": k.title(), "email": f"{k}@t.io",
                    "role_id": str(roles[ROLE[k]]["_id"]), "_role": roles[ROLE[k]]}
        return _u

    app.dependency_overrides[get_db] = lambda: db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as ac:
        async def call(method, path, who, **kw):
            app.dependency_overrides[get_current_user] = as_user(who)
            return await ac.request(method, path, **kw)

        yield {"db": db, "s": s, "t": {k: str(v) for k, v in T.items()}, "clock": clock, "call": call,
               "who": {v: k for k, v in s.items()}}
    app.dependency_overrides.clear()
    await client.drop_database(name)
    client.close()


# ── helpers ─────────────────────────────────────────────────────────────────

def day(n=0):
    return (TODAY + timedelta(days=n)).isoformat()


async def hand(o, who="lead", to="arjun", start=0, end=6, **kw):
    return await o["call"]("PUT", S, who, json={"standin_id": o["s"][to], "start_date": day(start),
                                                "end_date": day(end), **kw})


async def new_task(o, team="video", assignee=None, creator="lead", title="Task"):
    body = {"title": title, "team_id": o["t"][team], "due_date": "2026-12-31"}
    if assignee:
        body["assigned_to"] = o["s"][assignee]
    r = await o["call"]("POST", P, creator, json=body)
    assert r.status_code == 201, r.text
    return r.json()["data"]["id"]


async def submit(o, tid, who):
    assert (await o["call"]("PUT", f"{P}/{tid}", who, json={"status": "started"})).status_code == 200
    r = await o["call"]("PUT", f"{P}/{tid}", who, json={"status": "pending_review", "caption": "done"})
    assert r.status_code == 200, r.text


async def queue(o, who):
    r = await o["call"]("GET", f"{P}/leader/queue", who)
    assert r.status_code == 200
    return r.json()["data"]


async def routed_copy(o, team="other", worker="xav", approver="kofi", dest="video", next_leader="lead"):
    tid = await new_task(o, team, worker, creator=approver, title="To route")
    await submit(o, tid, worker)
    body = {"status": "approved", "destination_team_id": o["t"][dest]}
    if next_leader:
        body.update(next_leader_id=o["s"][next_leader], next_leader_name=next_leader.title())
    r = await o["call"]("PUT", f"{P}/{tid}", approver, json=body)
    assert r.status_code == 200, r.text
    d = await o["db"]["project_tasks"].find_one({"parent_task_id": tid})
    return d


async def bells(o, who, kind=None):
    q = {"user_id": {"$in": [o["s"][who], ObjectId(o["s"][who])]}}
    if kind:
        q["type"] = kind
    return await o["db"]["notifications"].find(q).to_list(100)


# ── 1. Settings and validation ───────────────────────────────────────────────

async def test_defaults_and_who_can_hand_over(org):
    o = org
    d = (await o["call"]("GET", S, "lead")).json()["data"]
    assert d["can_use"] and d["mine"] is None and d["standing_in"] == []
    assert sorted(t["name"] for t in d["teams"]) == ["Design", "Video"]
    for who in ("arjun", "asha", "sa"):
        assert (await o["call"]("GET", S, who)).json()["data"]["can_use"] is False
        r = await o["call"]("PUT", S, who, json={"standin_id": o["s"]["mira"], "start_date": day(), "end_date": day(3)})
        assert r.status_code == 403, who


@pytest.mark.parametrize("kw,msg", [
    ({"to": "lead"}, "teammate"),
    ({"to": "xav"}, "team you lead"),                           # not in any of lead's teams
    ({"start": -1}, "past"),
    ({"start": 3, "end": 2}, "before"),
    ({"end": sv.MAX_DAYS}, "up to"),                            # 61 days
    ({"start": sv.MAX_LEAD_DAYS + 1, "end": sv.MAX_LEAD_DAYS + 2}, "next"),
    ({"note": "x" * (sv.NOTE_MAX + 1)}, "note"),
])
async def test_validation(org, kw, msg):
    r = await hand(org, **kw)
    assert r.status_code == 422 and msg in r.json()["message"], r.text
    assert await org["db"][sv.COLL].count_documents({}) == 0


async def test_deactivated_person_and_bad_teams(org):
    o = org
    await o["db"]["users"].update_one({"_id": ObjectId(o["s"]["mira"])}, {"$set": {"is_active": False}})
    assert (await hand(o, to="mira")).status_code == 422
    r = await hand(o, team_ids=[o["t"]["design"]])              # arjun isn't in Design
    assert r.status_code == 422 and "belong" in r.json()["message"]
    r = await hand(o, team_ids=[o["t"]["other"]])               # lead doesn't lead Other
    assert r.status_code == 422


async def test_covers_only_teams_the_person_belongs_to(org):
    o = org
    d = (await hand(o)).json()["data"]
    assert d["team_ids"] == [o["t"]["video"]] and d["state"] == "active", "arjun isn't in Design"
    d = (await hand(o, to="zane")).json()["data"]
    assert d["team_ids"] == [o["t"]["design"]]


async def test_exactly_sixty_days_is_fine(org):
    assert (await hand(org, end=sv.MAX_DAYS - 1)).status_code == 200


# ── 2. The time window ───────────────────────────────────────────────────────

async def test_scheduled_then_live_then_over(org):
    o = org
    d = (await hand(o, start=2, end=4)).json()["data"]
    assert d["state"] == "scheduled"
    assert (await queue(o, "arjun"))["is_leader"] is False, "nothing before it starts"
    mine = (await o["call"]("GET", S, "arjun")).json()["data"]["standing_in"]
    assert [x["state"] for x in mine] == ["scheduled"], "but they can see it coming"
    o["clock"].add(days=2)
    q = await queue(o, "arjun")
    assert q["is_leader"] and [t["name"] for t in q["teams"]] == ["Video"]
    assert q["standin"][0]["leader_name"] == "Lead" and q["standin"][0]["end_date"] == day(4)
    o["clock"].t = ist_day_start_utc(TODAY + timedelta(days=5)) - timedelta(seconds=1)   # 23:59:59 on the last day
    assert (await queue(o, "arjun"))["is_leader"] is True
    o["clock"].add(seconds=1)                                                            # midnight IST
    assert (await queue(o, "arjun"))["is_leader"] is False, "over at the end of the last day"
    assert (await o["call"]("GET", S, "lead")).json()["data"]["mine"] is None


async def test_end_now_and_replace(org):
    o = org
    await hand(o)
    r = await o["call"]("DELETE", S, "lead")
    assert r.status_code == 200
    assert (await queue(o, "arjun"))["is_leader"] is False
    assert (await o["call"]("DELETE", S, "lead")).status_code == 404
    await hand(o, to="arjun")
    await hand(o, to="asha")                                      # replaces arjun
    assert (await queue(o, "arjun"))["is_leader"] is False
    assert (await queue(o, "asha"))["is_leader"] is True
    assert await o["db"][sv.COLL].count_documents({"status": "open"}) == 1
    assert len(await bells(o, "arjun", "standin_ended")) == 2, "once for End now, once for being replaced"


async def test_today_starts_now_not_this_morning(org):
    o = org
    d = await o["db"][sv.COLL].find_one({"_id": ObjectId((await hand(o)).json()["data"]["id"])})
    assert d["starts_at"].replace(tzinfo=timezone.utc) == o["clock"].now()
    assert d["ends_at"].replace(tzinfo=timezone.utc) == ist_day_start_utc(TODAY + timedelta(days=7))


# ── 3. The stand-in's desk and rights ───────────────────────────────────────

async def test_stand_in_desk_shows_assign_and_reedit_not_reviews(org):
    o = org
    inc = str((await routed_copy(o, next_leader=None))["_id"])
    rev = await new_task(o, assignee="asha", title="For review")
    await submit(o, rev, "asha")
    other = str((await routed_copy(o, team="video", worker="asha", approver="lead", dest="other", next_leader=None))["_id"])
    await hand(o)
    q = await queue(o, "arjun")
    assert [t["id"] for t in q["incoming"]] == [inc]
    assert q["review"] == [], "reviews only when the leader allows it"
    assert other not in [t["id"] for t in q["incoming"]]
    assert q["led_team_ids"] == [] and q["standin"][0]["can_review"] is False
    await hand(o, can_review=True)
    assert [t["id"] for t in (await queue(o, "arjun"))["review"]] == [rev]


async def test_stand_in_assigns_new_work_with_history_note(org):
    o = org
    tid = str((await routed_copy(o, next_leader=None))["_id"])
    await hand(o)
    r = await o["call"]("PUT", f"{P}/{tid}", "arjun", json={"assigned_to": o["s"]["mira"], "assigned_to_name": "Mira"})
    assert r.status_code == 200
    d = await o["db"]["project_tasks"].find_one({"_id": ObjectId(tid)})
    note = [h for h in d["history"] if h["action"] == "assigned"][-1]["note"]
    assert note == "Assigned to Mira · as stand-in for Lead"


async def test_stand_in_sends_routed_work_back_only_while_live(org):
    o = org
    copy = await routed_copy(o, next_leader=None)
    tid = str(copy["_id"])
    body = {"status": "reedit", "reedit_reason": "Wrong format"}
    assert (await o["call"]("PUT", f"{P}/{tid}", "arjun", json=body)).status_code == 403, "not yet a stand-in"
    assert (await o["call"]("PUT", f"{P}/{tid}", "asha", json=body)).status_code == 403
    await hand(o)
    r = await o["call"]("PUT", f"{P}/{tid}", "arjun", json=body)
    assert r.status_code == 200, r.text
    d = await o["db"]["project_tasks"].find_one({"_id": copy["_id"]})
    assert d["status"] == "reedit" and d["team_id"] == o["t"]["other"], "sent home"
    assert [h for h in d["history"] if h["action"] == "reedit"][-1]["note"] == "Wrong format · as stand-in for Lead"


async def test_review_only_when_allowed_and_never_own_work(org):
    o = org
    theirs = await new_task(o, assignee="asha", title="Asha's")
    own = await new_task(o, assignee="arjun", title="Arjun's own")
    await submit(o, theirs, "asha")
    await submit(o, own, "arjun")
    await hand(o)
    assert (await o["call"]("PUT", f"{P}/{theirs}", "arjun", json={"status": "approved"})).status_code == 403
    await hand(o, can_review=True)
    assert (await o["call"]("PUT", f"{P}/{own}", "arjun", json={"status": "approved"})).status_code == 403, \
        "a stand-in never approves their own work"
    r = await o["call"]("PUT", f"{P}/{theirs}", "arjun", json={"status": "approved"})
    assert r.status_code == 200
    d = await o["db"]["project_tasks"].find_one({"_id": ObjectId(theirs)})
    assert [h for h in d["history"] if h["action"] == "approved"][-1]["note"] == "As stand-in for Lead"


async def test_stand_in_has_no_rights_on_other_teams(org):
    o = org
    other = await new_task(o, "other", assignee="xav", creator="kofi")
    await submit(o, other, "xav")
    design = await new_task(o, "design", assignee="zane")
    await submit(o, design, "zane")
    await hand(o, can_review=True)
    for tid in (other, design):
        r = await o["call"]("PUT", f"{P}/{tid}", "arjun", json={"status": "approved"})
        assert r.status_code == 403, tid


# ── 4. Work routed straight to the away leader ──────────────────────────────

async def test_routed_to_the_leader_goes_to_the_stand_in(org):
    o = org
    await hand(o)
    copy = await routed_copy(o, next_leader="lead")
    assert copy["assigned_to"] == o["s"]["arjun"] and copy["standin_for_name"] == "Lead"
    assert "standing in for Lead" in copy["history"][0]["note"]
    b = await bells(o, "arjun", "task_assigned")
    assert b and "standing in for Lead" in b[-1]["message"]
    assert not await bells(o, "lead", "task_assigned")


async def test_routed_to_the_other_leader_or_when_not_live_is_unchanged(org):
    o = org
    await hand(o, start=3, end=5)                                 # scheduled, not live
    assert (await routed_copy(o, next_leader="lead"))["assigned_to"] == o["s"]["lead"]
    await hand(o)
    assert (await routed_copy(o, next_leader="lead2"))["assigned_to"] == o["s"]["lead2"], "lead2 isn't away"
    assert (await routed_copy(o, next_leader=None))["assigned_to"] == "", "unnamed: Assign Work as before"


# ── 5. Alerts ────────────────────────────────────────────────────────────────

async def test_hand_over_tells_the_stand_in_and_the_team(org):
    o = org
    await hand(o, can_review=True)
    me = await bells(o, "arjun", "standin_assigned")
    assert len(me) == 1 and "review submissions" in me[0]["message"]
    for who in ("asha", "mira", "lead2"):
        assert len(await bells(o, who, "standin_team")) == 1, who
    for who in ("lead", "zane", "xav", "kofi"):
        assert not await bells(o, who, "standin_team"), who


async def test_stand_in_hears_new_work_and_reviews_only_if_allowed(org):
    o = org
    await hand(o)
    await routed_copy(o, next_leader=None)
    assert await bells(o, "arjun", "team_task_assigned"), "new work in the team"
    tid = await new_task(o, assignee="asha")
    await submit(o, tid, "asha")
    assert not await bells(o, "arjun", "pending_review")
    await hand(o, can_review=True)
    t2 = await new_task(o, assignee="mira")
    await submit(o, t2, "mira")
    assert await bells(o, "arjun", "pending_review")


async def test_end_now_tells_the_stand_in(org):
    o = org
    await hand(o)
    await o["call"]("DELETE", S, "lead")
    b = await bells(o, "arjun", "standin_ended")
    assert b and b[-1]["title"] == "Lead is back"
    await hand(o, start=2, end=3)
    await o["call"]("DELETE", S, "lead")
    assert (await bells(o, "arjun", "standin_ended"))[-1]["title"] == "Stand-in cancelled"


# ── 6. Live re-checks ────────────────────────────────────────────────────────

@pytest.mark.parametrize("change", ["removed", "leader_demoted", "deactivated"])
async def test_hand_over_stops_working_when_things_change(org, change):
    o = org
    await hand(o)
    assert (await queue(o, "arjun"))["is_leader"]
    vid = {"_id": ObjectId(o["t"]["video"])}
    if change == "removed":
        await o["db"]["teams"].update_one(vid, {"$pull": {"members": {"user_id": o["s"]["arjun"]}}})
    elif change == "leader_demoted":
        await o["db"]["teams"].update_one({**vid, "members.user_id": o["s"]["lead"]}, {"$set": {"members.$.role": "member"}})
    else:
        await o["db"]["users"].update_one({"_id": ObjectId(o["s"]["arjun"])}, {"$set": {"is_active": False}})
    assert (await queue(o, "arjun"))["is_leader"] is False
    copy = await routed_copy(o, next_leader="lead")
    assert copy["assigned_to"] != o["s"]["arjun"]
    r = await o["call"]("PUT", f"{P}/{str(copy['_id'])}", "arjun", json={"status": "reedit", "reedit_reason": "x"})
    assert r.status_code in (403, 404)


async def test_two_leaders_two_independent_stand_ins(org):
    o = org
    await hand(o, who="lead", to="arjun")
    await hand(o, who="lead2", to="asha", can_review=True)
    assert (await o["call"]("GET", S, "lead")).json()["data"]["mine"]["standin_name"] == "Arjun"
    assert (await o["call"]("GET", S, "lead2")).json()["data"]["mine"]["standin_name"] == "Asha"
    assert (await queue(o, "arjun"))["review"] == [] and (await queue(o, "asha"))["standin"][0]["can_review"]
    await o["call"]("DELETE", S, "lead")
    assert (await queue(o, "asha"))["is_leader"], "ending one leaves the other"


async def test_leader_keeps_everything(org):
    o = org
    inc = str((await routed_copy(o, next_leader=None))["_id"])
    await hand(o)
    q = await queue(o, "lead")
    assert inc in [t["id"] for t in q["incoming"]] and sorted(q["led_team_ids"]) == sorted([o["t"]["video"], o["t"]["design"]])
    assert q["standin"] == []
