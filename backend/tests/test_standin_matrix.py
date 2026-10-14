"""
Stand-in — the QA pass across roles (2026-10-14).

1. Role × action matrix: every kind of person against every stand-in action
   and every Leader Desk action, with a live hand-over (lead → arjun, Video).
2. Edge cases found while planning the matrix: one person standing in for two
   leaders of the same team (with and without review), a stand-in who leads
   another team, an Employee who leads a team handing over, routing on approval
   by a stand-in, a scheduled hand-over, a co-leader as stand-in.
3. Model-based: random sequences of hand-overs, ends, replacements, team changes
   and time passing, compared step by step with an independent model of who may
   do what.

Organisation (throwaway database, clock controlled):
    Video   leaders lead, lead2      members arjun, asha, mira, coordm (Coordinator)
    Design  leader  lead             members zane, arjun2
    Ops     leader  pia (Employee)   members omar, arjun
    Other   leader  kofi             members xav
    sa / admin — elevated, in no team;  out — in no team
"""
import random
import secrets
from datetime import date, timedelta

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
S, P = "/api/v1/standin", "/api/v1/projects"
ROLE = {"lead": "Team Leader", "lead2": "Team Leader", "kofi": "Team Leader", "pia": "Employee",
        "arjun": "Employee", "arjun2": "Employee", "asha": "Employee", "mira": "Employee", "zane": "Employee",
        "omar": "Employee", "xav": "Employee", "coordm": "Coordinator", "sa": "Super Admin", "admin": "Admin",
        "out": "Employee"}
ELEVATED = {"sa", "admin", "coordm"}
TEAMS = {
    "video": (["lead", "lead2"], ["arjun", "asha", "mira", "coordm"]),
    "design": (["lead"], ["zane", "arjun2"]),
    "ops": (["pia"], ["omar", "arjun"]),
    "other": (["kofi"], ["xav"]),
}


class Clock:
    def __init__(self):
        self.t = ist_day_start_utc(TODAY) + timedelta(hours=10)

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
    name = f"mediaerp_test_standinm_{secrets.token_hex(4)}"
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
    T = {k: ObjectId() for k in TEAMS}
    await db["teams"].insert_many([
        {"_id": T[k], "name": k.title(), "members": [{"user_id": s[u], "role": "leader"} for u in L] +
         [{"user_id": s[u], "role": "member"} for u in M]} for k, (L, M) in TEAMS.items()])

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


def day(n=0):
    return (TODAY + timedelta(days=n)).isoformat()


async def hand(o, who="lead", to="arjun", start=0, end=6, **kw):
    return await o["call"]("PUT", S, who, json={"standin_id": o["s"][to], "start_date": day(start),
                                                "end_date": day(end), **kw})


async def task(o, team, assignee, creator):
    r = await o["call"]("POST", P, creator, json={"title": f"T-{secrets.token_hex(3)}", "team_id": o["t"][team],
                                                  "assigned_to": o["s"][assignee], "due_date": "2026-12-31"})
    assert r.status_code == 201, r.text
    return r.json()["data"]["id"]


async def submit(o, tid, who):
    assert (await o["call"]("PUT", f"{P}/{tid}", who, json={"status": "started"})).status_code == 200
    assert (await o["call"]("PUT", f"{P}/{tid}", who, json={"status": "pending_review", "caption": "x"})).status_code == 200


async def routed_in(o, dest="video", next_leader=None):
    """Work kofi's team routes into `dest` — the unassigned Assign Work item (or to a named leader)."""
    tid = await task(o, "other", "xav", "kofi")
    await submit(o, tid, "xav")
    body = {"status": "approved", "destination_team_id": o["t"][dest]}
    if next_leader:
        body.update(next_leader_id=o["s"][next_leader], next_leader_name=next_leader.title())
    assert (await o["call"]("PUT", f"{P}/{tid}", "kofi", json=body)).status_code == 200
    return await o["db"]["project_tasks"].find_one({"parent_task_id": tid})


async def queue(o, who):
    return (await o["call"]("GET", f"{P}/leader/queue", who)).json()["data"]


# ── 1. Matrix ────────────────────────────────────────────────────────────────

LEADS = {"lead": {"video", "design"}, "lead2": {"video"}, "pia": {"ops"}, "kofi": {"other"}}


def expected(role, action, review):
    """lead → arjun on Video (review per `review`). What each role may do."""
    leads_video = role in ("lead", "lead2")
    elevated = role in ELEVATED
    standin = role == "arjun"
    in_video = role in ("lead", "lead2", "arjun", "asha", "mira", "coordm")
    return {
        "can_use": bool(LEADS.get(role)),
        "hand_over": 200 if role in LEADS else 403,          # to someone in their own team
        "end": 200 if role == "lead" else 404,               # only lead has one open
        "desk": role in LEADS or elevated or standin,       # their own teams count too
        "sees_incoming": leads_video or elevated or standin,
        "sees_review": leads_video or elevated or (standin and review),
        "assign": 200 if (in_video or elevated) else 403,    # pre-existing: any team member may assign
        "send_back": 200 if (leads_video or elevated or standin) else (403 if in_video else 403),
        "approve_others": 200 if (leads_video or elevated or (standin and review)) else 403,
        "approve_own": 200 if leads_video or elevated else 403,
    }[action]


@pytest.mark.parametrize("review", [False, True])
@pytest.mark.parametrize("role", list(ROLE))
async def test_matrix(org, role, review):
    o, c, s = org, org["call"], org["s"]
    assert (await hand(o, can_review=review)).status_code == 200
    incoming = await routed_in(o)
    asha_task = await task(o, "video", "asha", "lead")
    await submit(o, asha_task, "asha")
    own_task = await task(o, "video", role if role in TEAMS["video"][1] + TEAMS["video"][0] else "asha", "lead")
    await submit(o, own_task, role if role in TEAMS["video"][1] + TEAMS["video"][0] else "asha")

    # Settings visibility
    g = (await c("GET", S, role)).json()["data"]
    assert g["can_use"] is expected(role, "can_use", review), role
    standing = [h for h in g["standing_in"] if h["state"] == "active"]
    assert bool(standing) is (role == "arjun"), role

    # Desk
    q = await queue(o, role)
    want_desk = expected(role, "desk", review)
    assert bool(q["is_leader"]) is want_desk, (role, q.get("is_leader"))
    inc_ids = [t["id"] for t in q["incoming"]]
    assert (str(incoming["_id"]) in inc_ids) is expected(role, "sees_incoming", review), role
    rev_ids = [t["id"] for t in q["review"]]
    assert (asha_task in rev_ids) is expected(role, "sees_review", review), (role, review)
    if role == "arjun":
        assert q["led_team_ids"] == [] and [x["leader_name"] for x in q["standin"]] == ["Lead"]

    # Actions on the incoming (routed, unassigned) Video task
    r = await c("PUT", f"{P}/{incoming['_id']}", role, json={"status": "reedit", "reedit_reason": "no"})
    want = expected(role, "send_back", review)
    assert r.status_code == want or (want == 403 and r.status_code in (403, 404)), (role, "send_back", r.status_code)

    # Approving asha's work, and the role's own work
    if role != "asha":
        r = await c("PUT", f"{P}/{asha_task}", role, json={"status": "approved"})
        want = expected(role, "approve_others", review)
        assert r.status_code == want or (want == 403 and r.status_code in (403, 404)), (role, "approve", r.status_code)
    if role in ("arjun", "lead", "lead2"):
        r = await c("PUT", f"{P}/{own_task}", role, json={"status": "approved"})
        assert r.status_code == expected(role, "approve_own", review), (role, "own", r.status_code)


@pytest.mark.parametrize("role", list(ROLE))
async def test_who_may_hand_over_and_to_whom(org, role):
    o = org
    # To someone in one of their teams.
    target = {"lead": "arjun", "lead2": "mira", "pia": "omar", "kofi": "xav"}.get(role, "asha")
    r = await hand(o, who=role, to=target)
    assert r.status_code == expected(role, "hand_over", False), (role, r.text)
    # Never to someone outside their teams.
    if role in LEADS:
        outsider = "out"
        assert (await hand(o, who=role, to=outsider)).status_code == 422
    r = await o["call"]("DELETE", S, role)
    assert r.status_code == (200 if role in LEADS else 404), role


# ── 2. Edge cases ────────────────────────────────────────────────────────────

async def test_one_person_standing_in_for_two_leaders_of_the_same_team(org):
    """lead (no review) and lead2 (with review) both pick arjun: the review right must hold."""
    o, c = org, org["call"]
    await hand(o, who="lead", to="arjun", can_review=False)
    await hand(o, who="lead2", to="arjun", can_review=True)
    t = await task(o, "video", "asha", "lead")
    await submit(o, t, "asha")
    q = await queue(o, "arjun")
    assert t in [x["id"] for x in q["review"]], "lead2 allowed reviews"
    assert sorted(x["leader_name"] for x in q["standin"]) == ["Lead", "Lead2"], "both leaders in the banner"
    assert (await c("PUT", f"{P}/{t}", "arjun", json={"status": "approved"})).status_code == 200
    # Work routed to either leader reaches arjun.
    assert (await routed_in(o, next_leader="lead"))["assigned_to"] == o["s"]["arjun"]
    assert (await routed_in(o, next_leader="lead2"))["assigned_to"] == o["s"]["arjun"]
    # lead2 ends theirs → reviews go, Assign Work stays.
    await c("DELETE", S, "lead2")
    q = await queue(o, "arjun")
    assert q["is_leader"] and q["review"] == [] and [x["leader_name"] for x in q["standin"]] == ["Lead"]


async def test_stand_in_who_leads_another_team(org):
    """pia leads Ops; lead hands Video... pia isn't in Video — use kofi→xav? Use lead→arjun where arjun is in Ops,
    and pia (Ops leader) hands Ops to arjun too: arjun stands in for two teams, two leaders."""
    o, c = org, org["call"]
    await hand(o, who="lead", to="arjun")
    await hand(o, who="pia", to="arjun", can_review=True)
    q = await queue(o, "arjun")
    assert sorted(x["team_name"] for x in q["standin"]) == ["Ops", "Video"]
    ops_task = await task(o, "ops", "omar", "pia")
    await submit(o, ops_task, "omar")
    vid_task = await task(o, "video", "asha", "lead")
    await submit(o, vid_task, "asha")
    rev = [x["id"] for x in q["review"]] + [x["id"] for x in (await queue(o, "arjun"))["review"]]
    assert ops_task in rev and vid_task not in rev, "reviews only where allowed"


async def test_an_employee_who_leads_a_team_can_hand_over(org):
    o = org
    r = await hand(o, who="pia", to="omar", can_review=True)
    assert r.status_code == 200 and r.json()["data"]["state"] == "active"
    assert (await queue(o, "omar"))["standin"][0]["leader_name"] == "Pia"


async def test_stand_in_with_review_can_route_on_approval(org):
    o, c = org, org["call"]
    await hand(o, can_review=True)
    t = await task(o, "video", "asha", "lead")
    await submit(o, t, "asha")
    r = await c("PUT", f"{P}/{t}", "arjun", json={"status": "approved", "destination_team_id": o["t"]["other"],
                                                  "next_leader_id": o["s"]["kofi"], "next_leader_name": "Kofi"})
    assert r.status_code == 200, r.text
    copy = await o["db"]["project_tasks"].find_one({"parent_task_id": t})
    assert copy and copy["team_id"] == o["t"]["other"] and copy["assigned_to"] == o["s"]["kofi"]


async def test_co_leader_as_stand_in(org):
    o = org
    await hand(o, who="lead", to="lead2")
    q = await queue(o, "lead2")
    assert q["standin"] == [], "a leader of the team needs no banner"
    assert (await routed_in(o, next_leader="lead"))["assigned_to"] == o["s"]["lead2"]


async def test_elevated_member_as_stand_in(org):
    """coordm (Coordinator) is a Video member: already sees every desk; routed work still reaches them."""
    o = org
    await hand(o, to="coordm")
    assert (await routed_in(o, next_leader="lead"))["assigned_to"] == o["s"]["coordm"]


async def test_scheduled_hand_over_grants_nothing_yet(org):
    o, c = org, org["call"]
    await hand(o, start=1, end=3, can_review=True)
    incoming = await routed_in(o)
    assert (await queue(o, "arjun"))["is_leader"] is False
    r = await c("PUT", f"{P}/{incoming['_id']}", "arjun", json={"status": "reedit", "reedit_reason": "x"})
    assert r.status_code == 403
    o["clock"].add(days=1)
    r = await c("PUT", f"{P}/{incoming['_id']}", "arjun", json={"status": "reedit", "reedit_reason": "x"})
    assert r.status_code == 200


async def test_payload_never_leaks_other_leaders_hand_overs(org):
    o, c = org, org["call"]
    await hand(o, who="lead", to="arjun")
    await hand(o, who="kofi", to="xav")
    for who in ("asha", "zane", "omar", "out", "sa"):
        g = (await c("GET", S, who)).json()["data"]
        assert g["mine"] is None and g["standing_in"] == [], who
    assert (await c("GET", S, "kofi")).json()["data"]["mine"]["standin_name"] == "Xav"
    assert [h["leader_name"] for h in (await c("GET", S, "arjun")).json()["data"]["standing_in"]] == ["Lead"]


# ── 3. Model-based ───────────────────────────────────────────────────────────

CANDIDATES = {"lead": ["arjun", "asha", "zane", "lead2"], "lead2": ["arjun", "mira"], "pia": ["arjun", "omar"]}
PEOPLE = ["arjun", "asha", "mira", "zane", "omar", "lead2", "xav"]


@pytest.mark.parametrize("seed", range(15))
async def test_random_sequences_match_the_model(org, seed):
    rnd = random.Random(seed)
    o, c, s = org, org["call"], org["s"]
    members = {k: set(L) | set(M) for k, (L, M) in TEAMS.items()}
    leaders = {k: set(L) for k, (L, _) in TEAMS.items()}
    team_of = {"video": "video", "design": "design", "ops": "ops"}
    hands = {}          # leader -> {to, teams, review, start, end (date), }

    def live_teams(person, now_day):
        out = {}
        for L, h in hands.items():
            if not (h["start"] <= now_day <= h["end"]) or h["to"] != person:
                continue
            for t in h["teams"]:
                if L in leaders[t] and person in members[t]:
                    out.setdefault(t, False)
                    out[t] = out[t] or h["review"]
        return out

    for step in range(30):
        today = o["clock"].today()
        op = rnd.choice(["hand", "hand", "end", "time", "leave", "rejoin"])
        if op == "hand":
            L = rnd.choice(list(CANDIDATES))
            to = rnd.choice(CANDIDATES[L])
            start, length = rnd.choice([0, 0, 1, 2]), rnd.choice([1, 3, 7])
            review = rnd.random() < 0.5
            r = await c("PUT", S, L, json={"standin_id": s[to], "start_date": (today + timedelta(days=start)).isoformat(),
                                           "end_date": (today + timedelta(days=start + length - 1)).isoformat(),
                                           "can_review": review})
            led = {t for t in leaders if L in leaders[t]}
            teams = sorted(t for t in led if to in members[t])
            if not teams:
                assert r.status_code == 422, (seed, step, L, to, r.text)
                continue
            assert r.status_code == 200, (seed, step, L, to, r.text)
            hands[L] = {"to": to, "teams": teams, "review": review,
                        "start": today + timedelta(days=start), "end": today + timedelta(days=start + length - 1)}
        elif op == "end":
            L = rnd.choice(list(CANDIDATES))
            r = await c("DELETE", S, L)
            h = hands.get(L)
            open_ = h is not None and h["end"] >= today
            assert r.status_code == (200 if open_ else 404), (seed, step, L)
            hands.pop(L, None)
        elif op == "time":
            o["clock"].add(days=rnd.choice([1, 2, 3]))
            for L in [L for L, h in hands.items() if h["end"] < o["clock"].today()]:
                hands.pop(L)
        elif op in ("leave", "rejoin"):
            person, t = rnd.choice([("arjun", "video"), ("arjun", "ops"), ("asha", "video"), ("omar", "ops")])
            tid = ObjectId(o["t"][t])
            if op == "leave" and person in members[t]:
                await o["db"]["teams"].update_one({"_id": tid}, {"$pull": {"members": {"user_id": s[person]}}})
                members[t].discard(person)
            elif op == "rejoin" and person not in members[t]:
                await o["db"]["teams"].update_one({"_id": tid}, {"$push": {"members": {"user_id": s[person], "role": "member"}}})
                members[t].add(person)

        # ── compare: every candidate's desk ──
        now_day = o["clock"].today()
        for person in PEOPLE:
            want = live_teams(person, now_day)
            q = await queue(o, person)
            got = {x["team_id"]: x["can_review"] for x in q.get("standin", [])}
            led_by_person = {t for t in leaders if person in leaders[t]}
            want_banner = {o["t"][t]: v for t, v in want.items() if t not in led_by_person}
            got_merged = {}
            for x in q.get("standin", []):
                got_merged[x["team_id"]] = got_merged.get(x["team_id"], False) or x["can_review"]
            assert got_merged == want_banner, (seed, step, op, person, got_merged, want_banner, hands)
            assert bool(q["is_leader"]) is bool(want or led_by_person), (seed, step, person)


# ── Found in the browser pass ────────────────────────────────────────────────

async def test_own_work_stays_out_of_the_stand_ins_review_list(org):
    o, c = org, org["call"]
    await hand(o, can_review=True)
    own = await task(o, "video", "arjun", "lead")
    await submit(o, own, "arjun")
    other = await task(o, "video", "asha", "lead")
    await submit(o, other, "asha")
    ids = [t["id"] for t in (await queue(o, "arjun"))["review"]]
    assert other in ids and own not in ids
    assert own in [t["id"] for t in (await queue(o, "lead"))["review"]], "the leader still sees it"
    r = await c("PUT", f"{P}/{own}", "arjun", json={"status": "approved"})
    assert r.status_code == 403 and "your own work" in r.json()["message"]
    r = await c("PUT", f"{P}/{own}", "arjun", json={"status": "reedit", "reedit_reason": "x"})
    assert r.status_code == 403 and "your own work" in r.json()["message"]


async def test_stand_in_with_review_may_hold_auto_approval(org):
    o, c = org, org["call"]
    t = await task(o, "video", "asha", "lead")
    await submit(o, t, "asha")
    await hand(o, can_review=False)
    assert (await c("POST", f"/api/v1/auto-approve/hold/{t}", "arjun", json={"hold": True})).status_code == 403
    await hand(o, can_review=True)
    assert (await c("POST", f"/api/v1/auto-approve/hold/{t}", "arjun", json={"hold": True})).status_code == 200
    assert (await c("POST", f"/api/v1/auto-approve/hold/{t}", "arjun", json={"hold": False})).status_code == 200
    assert (await c("POST", f"/api/v1/auto-approve/hold/{t}", "asha", json={"hold": True})).status_code == 403


async def test_team_message_mentions_reviews_only_when_allowed(org):
    o = org
    await hand(o, can_review=True)
    n = await o["db"]["notifications"].find_one({"type": "standin_team", "user_id": {"$in": [o["s"]["asha"], ObjectId(o["s"]["asha"])]}})
    assert "reviews submissions" in n["message"]
    await o["db"]["notifications"].delete_many({})
    await hand(o, to="mira", can_review=False)
    n = await o["db"]["notifications"].find_one({"type": "standin_team", "user_id": {"$in": [o["s"]["asha"], ObjectId(o["s"]["asha"])]}})
    assert "reviews" not in n["message"]
