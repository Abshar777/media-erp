"""
Auto-approve — roles and isolation between leaders (the QA pass of 2026-10-14).

A realistic organisation on a throwaway MongoDB database:

    T1  leaders leadA, leadB           members asha, tlx (Team Leader who leads nothing), leadC
    T2  leader  leadC, leadX           member  mira
    T3  leader  leadX, pia (Employee)  member  zane
    T4  leader  adminlead (Admin)      member  omar
    sa / admin / coord — elevated, lead no team

Checks, per role: who sees and may use the switch, who may Hold, and that one
leader's switch and delay never touch another leader — not their settings, not
their timers, not tasks of a team they don't lead. Ends with a model-based test:
random sequences of switches, delay changes, submissions, Holds, manual
decisions and time passing, compared step by step with an independent model of
the agreed rules.
"""
import random
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
from app.services import auto_approve_service as auto


class Clock:
    def __init__(self, t):
        self.t = t

    def __call__(self):
        return self.t

    def add(self, **kw):
        self.t = self.t + timedelta(**kw)


ROLE_OF = {
    "sa": "Super Admin", "admin": "Admin", "coord": "Coordinator",
    "leadA": "Team Leader", "leadB": "Team Leader", "leadC": "Team Leader", "leadX": "Team Leader",
    "tlx": "Team Leader", "pia": "Employee", "adminlead": "Admin",
    "asha": "Employee", "mira": "Employee", "zane": "Employee", "omar": "Employee",
}
TEAMS = {
    "T1": {"leader": ["leadA", "leadB"], "member": ["asha", "tlx", "leadC"]},
    "T2": {"leader": ["leadC", "leadX"], "member": ["mira"]},
    "T3": {"leader": ["leadX", "pia"], "member": ["zane"]},
    "T4": {"leader": ["adminlead"], "member": ["omar"]},
}
LEADS = {u: sorted(t for t, m in TEAMS.items() if u in m["leader"]) for u in ROLE_OF}
LEADERS = [u for u in ROLE_OF if LEADS[u]]


@pytest.fixture
async def org(monkeypatch):
    client = AsyncIOMotorClient(settings.mongodb_url, serverSelectionTimeoutMS=3000)
    try:
        await client.admin.command("ping")
    except Exception:
        client.close()
        pytest.skip("MongoDB not reachable — integration tests skipped")
    name = f"mediaerp_test_autoroles_{secrets.token_hex(4)}"
    db = client[name]
    import app.database as dbmod
    monkeypatch.setattr(dbmod, "_client", client)
    monkeypatch.setitem(settings.__dict__, "mongodb_db_name", name)
    clock = Clock(datetime.now(timezone.utc).replace(microsecond=0))
    monkeypatch.setattr(auto, "_now", clock)

    roles = {r: {"_id": ObjectId(), "role_name": r} for r in set(ROLE_OF.values())}
    await db["roles"].insert_many(list(roles.values()))
    U = {k: ObjectId() for k in ROLE_OF}
    await db["users"].insert_many([{"_id": U[k], "name": k, "email": f"{k}@t.io", "status": "active",
                                    "is_active": True, "role_id": str(roles[r]["_id"])}
                                   for k, r in ROLE_OF.items()])
    s = {k: str(v) for k, v in U.items()}
    T = {t: ObjectId() for t in TEAMS}
    await db["teams"].insert_many([{"_id": T[t], "name": t, "members":
                                    [{"user_id": s[u], "role": "leader"} for u in m["leader"]] +
                                    [{"user_id": s[u], "role": "member"} for u in m["member"]]}
                                   for t, m in TEAMS.items()])

    def as_user(k):
        async def _u():
            return {"_id": U[k], "name": k, "email": f"{k}@t.io",
                    "role_id": str(roles[ROLE_OF[k]]["_id"]), "_role": roles[ROLE_OF[k]]}
        return _u

    app.dependency_overrides[get_db] = lambda: db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as ac:
        async def call(method, path, who, **kw):
            app.dependency_overrides[get_current_user] = as_user(who)
            return await ac.request(method, path, **kw)

        yield {"db": db, "s": s, "who": {v: k for k, v in s.items()}, "T": {k: str(v) for k, v in T.items()},
               "clock": clock, "call": call}
    app.dependency_overrides.clear()
    await client.drop_database(name)
    client.close()


# ── helpers ─────────────────────────────────────────────────────────────────

async def put(o, who, enabled, delay=0):
    return await o["call"]("PUT", "/api/v1/auto-approve", who, json={"enabled": enabled, "delay_minutes": delay})


async def on(o, who, delay=0, enabled=True):
    r = await put(o, who, enabled, delay)
    assert r.status_code == 200, (who, r.text)
    return r.json()["data"]


async def create(o, team, assignee, creator="sa", title="Task"):
    r = await o["call"]("POST", "/api/v1/projects", creator, json={
        "title": title, "team_id": o["T"][team], "assigned_to": o["s"][assignee], "due_date": "2026-12-31"})
    assert r.status_code == 201, r.text
    return r.json()["data"]["id"]


async def submit(o, tid, who):
    assert (await o["call"]("PUT", f"/api/v1/projects/{tid}", who, json={"status": "started"})).status_code == 200
    r = await o["call"]("PUT", f"/api/v1/projects/{tid}", who, json={"status": "pending_review", "caption": "Done"})
    assert r.status_code == 200, r.text
    return r.json()["data"]


async def new_task(o, team, assignee, title="Task"):
    tid = await create(o, team, assignee, title=title)
    await submit(o, tid, assignee)
    return tid


async def doc(o, tid):
    return await o["db"]["project_tasks"].find_one({"_id": ObjectId(tid)})


def approver(o, d):
    a = [h for h in d.get("history") or [] if h.get("action") == "approved"]
    return (o["who"].get(a[-1]["actor_id"]), bool(a[-1].get("auto"))) if a else None


def timers(o, d):
    return {o["who"][e["leader_id"]]: e["delay_minutes"] for e in d.get("auto_approvals") or []}


async def all_settings(o):
    return {k: (u.get("auto_approve") or None)
            for u in await o["db"]["users"].find({}, {"auto_approve": 1}).to_list(100)
            for k in [o["who"][str(u["_id"])]]}


# ── 1. Roles: who sees it, who may use it, who may Hold ─────────────────────

@pytest.mark.parametrize("who", list(ROLE_OF))
async def test_everyone_starts_off_and_sees_only_teams_they_lead(org, who):
    r = await org["call"]("GET", "/api/v1/auto-approve", who)
    assert r.status_code == 200
    d = r.json()["data"]
    assert d["enabled"] is False and d["delay_minutes"] == 0 and d["enabled_since"] is None
    assert d["can_use"] is bool(LEADS[who])
    assert sorted(t["name"] for t in d["teams"]) == LEADS[who]


@pytest.mark.parametrize("who", list(ROLE_OF))
async def test_only_people_who_lead_a_team_can_turn_it_on(org, who):
    r = await put(org, who, True, 15)
    if LEADS[who]:
        assert r.status_code == 200 and r.json()["data"]["enabled"] is True
    else:
        # Super Admin / Admin / Coordinator who lead no team, a Team Leader who leads
        # nothing, plain employees — none of them can switch it on.
        assert r.status_code == 403, (who, r.text)
        assert (await all_settings(org))[who] is None, "nothing was written"


@pytest.mark.parametrize("who,allowed", [
    ("sa", True), ("admin", True), ("coord", True),       # elevated roles
    ("leadA", True), ("leadB", True),                      # this team's leaders
    ("adminlead", True),                                   # Admin (leads T4) — elevated anyway
    ("leadC", False),                                      # leads T2, only a member of T1
    ("leadX", False), ("pia", False),                      # leaders of other teams
    ("tlx", False),                                        # Team Leader role, leads nothing
    ("asha", False),                                       # the person who submitted it
    ("mira", False), ("zane", False), ("omar", False),
])
async def test_who_may_hold_a_task(org, who, allowed):
    await on(org, "leadA", 30)
    tid = await new_task(org, "T1", "asha")
    r = await org["call"]("POST", f"/api/v1/auto-approve/hold/{tid}", who, json={"hold": True})
    assert r.status_code == (200 if allowed else 403), (who, r.text)
    assert bool((await doc(org, tid)).get("auto_approve_hold")) is allowed


async def test_settings_endpoint_cannot_touch_another_leader(org):
    """Extra fields are ignored: there is no way to switch someone else on."""
    r = await org["call"]("PUT", "/api/v1/auto-approve", "leadA", json={
        "enabled": True, "delay_minutes": 5, "user_id": org["s"]["leadB"], "leader_id": org["s"]["leadB"],
        "_id": org["s"]["leadB"]})
    assert r.status_code == 200
    st = await all_settings(org)
    assert st["leadA"]["enabled"] is True and st["leadA"]["delay_minutes"] == 5
    assert all(v is None for k, v in st.items() if k != "leadA")
    # An admin cannot set it for a leader either — the endpoint only ever writes the caller.
    r = await org["call"]("PUT", "/api/v1/auto-approve", "sa", json={
        "enabled": True, "delay_minutes": 0, "user_id": org["s"]["leadB"]})
    assert r.status_code == 403
    assert (await all_settings(org))["leadB"] is None


# ── 2. One leader's switch never affects another ────────────────────────────

@pytest.mark.parametrize("who", LEADERS)
async def test_each_settings_change_writes_only_the_callers_own_setting(org, who):
    others_before = {k: v for k, v in (await all_settings(org)).items() if k != who}
    for enabled, delay in [(True, 0), (True, 45), (True, 1440), (False, 45), (True, 7), (False, 0)]:
        await on(org, who, delay, enabled)
        after = await all_settings(org)
        assert after[who]["enabled"] is enabled and after[who]["delay_minutes"] == delay
        assert {k: v for k, v in after.items() if k != who} == others_before


async def test_switching_on_does_not_switch_on_the_other_leader_of_the_same_team(org):
    await on(org, "leadA", 0)
    assert (await org["call"]("GET", "/api/v1/auto-approve", "leadB")).json()["data"]["enabled"] is False
    tid = await new_task(org, "T1", "asha")
    d = await doc(org, tid)
    assert d["status"] == "approved" and approver(org, d) == ("leadA", True)
    # Only leadA's switch did it; leadB has no timer anywhere.
    assert await org["db"]["project_tasks"].count_documents({"auto_approvals.leader_id": org["s"]["leadB"]}) == 0


async def test_a_leader_of_another_team_never_approves_this_team(org):
    """leadC leads T2 and is only a member of T1 — their switch covers T2 only."""
    await on(org, "leadC", 0)
    t1 = await new_task(org, "T1", "asha")
    t2 = await new_task(org, "T2", "mira")
    assert (await doc(org, t1))["status"] == "pending_review" and not timers(org, await doc(org, t1))
    assert approver(org, await doc(org, t2)) == ("leadC", True)


async def test_an_admin_who_leads_a_team_auto_approves_only_that_team(org):
    """adminlead may approve anything by hand, but the switch covers only teams they lead."""
    await on(org, "adminlead", 0)
    t4 = await new_task(org, "T4", "omar")
    t1 = await new_task(org, "T1", "asha")
    t2 = await new_task(org, "T2", "mira")
    assert approver(org, await doc(org, t4)) == ("adminlead", True)
    for t in (t1, t2):
        assert (await doc(org, t))["status"] == "pending_review"


@pytest.mark.parametrize("change", ["demoted", "removed"])
async def test_an_admin_no_longer_leading_the_team_stops_auto_approving(org, change):
    """An Admin may approve anything by hand, so only the fire-time "still leads this
    team?" check stops their switch once they stop leading it."""
    await on(org, "adminlead", 10)
    tid = await new_task(org, "T4", "omar")
    team = {"_id": ObjectId(org["T"]["T4"])}
    if change == "demoted":
        await org["db"]["teams"].update_one({**team, "members.user_id": org["s"]["adminlead"]},
                                            {"$set": {"members.$.role": "member"}})
    else:
        await org["db"]["teams"].update_one(team, {"$pull": {"members": {"user_id": org["s"]["adminlead"]}}})
    org["clock"].add(minutes=10)
    assert await auto.run_due(org["db"]) == 0
    d = await doc(org, tid)
    assert d["status"] == "pending_review" and not d.get("auto_approvals"), "the stale timer is dropped"


async def test_an_employee_who_leads_a_team_can_use_it(org):
    await on(org, "pia", 0)
    t3 = await new_task(org, "T3", "zane")
    assert approver(org, await doc(org, t3)) == ("pia", True)


async def test_a_leader_of_two_teams_covers_both_and_nothing_else(org):
    await on(org, "leadX", 10)
    t2, t3, t1 = (await new_task(org, "T2", "mira"), await new_task(org, "T3", "zane"),
                  await new_task(org, "T1", "asha"))
    assert timers(org, await doc(org, t2)) == {"leadX": 10}
    assert timers(org, await doc(org, t3)) == {"leadX": 10}
    assert timers(org, await doc(org, t1)) == {}
    org["clock"].add(minutes=10)
    assert await auto.run_due(org["db"]) == 2
    assert (await doc(org, t1))["status"] == "pending_review"


async def test_a_member_who_is_a_team_leader_elsewhere_is_covered_like_any_member(org):
    """tlx has the Team Leader role but is a plain member of T1 → leadA's switch covers their work."""
    await on(org, "leadA", 0)
    tid = await new_task(org, "T1", "tlx")
    assert approver(org, await doc(org, tid)) == ("leadA", True)


# ── 3. Delay times are per leader too ───────────────────────────────────────

async def test_two_leaders_two_delays_each_their_own(org):
    await on(org, "leadA", 30)
    await on(org, "leadB", 120)
    tid = await new_task(org, "T1", "asha")
    assert timers(org, await doc(org, tid)) == {"leadA": 30, "leadB": 120}
    # leadA changes their delay — leadB's setting and timer stay exactly as they were.
    await on(org, "leadA", 5)
    st = await all_settings(org)
    assert st["leadB"]["delay_minutes"] == 120 and st["leadA"]["delay_minutes"] == 5
    assert timers(org, await doc(org, tid)) == {"leadA": 30, "leadB": 120}, "timers are fixed at submission"
    t_new = await new_task(org, "T1", "asha", "Next")
    assert timers(org, await doc(org, t_new)) == {"leadA": 5, "leadB": 120}
    org["clock"].add(minutes=5)
    assert await auto.run_due(org["db"]) == 1
    assert approver(org, await doc(org, t_new)) == ("leadA", True)
    assert (await doc(org, tid))["status"] == "pending_review"
    org["clock"].add(minutes=25)
    assert await auto.run_due(org["db"]) == 1
    assert approver(org, await doc(org, tid)) == ("leadA", True)


async def test_the_shorter_delay_wins_whoever_set_it(org):
    await on(org, "leadA", 90)
    await on(org, "leadB", 20)
    tid = await new_task(org, "T1", "asha")
    org["clock"].add(minutes=20)
    assert await auto.run_due(org["db"]) == 1
    assert approver(org, await doc(org, tid)) == ("leadB", True)


async def test_one_leader_instant_other_delayed(org):
    await on(org, "leadA", 240)
    await on(org, "leadB", 0)
    tid = await new_task(org, "T1", "asha")
    assert approver(org, await doc(org, tid)) == ("leadB", True)


async def test_turning_off_keeps_the_other_leaders_delay_and_timer(org):
    await on(org, "leadA", 10)
    await on(org, "leadB", 60)
    tid = await new_task(org, "T1", "asha")
    await on(org, "leadA", 10, enabled=False)
    assert timers(org, await doc(org, tid)) == {"leadB": 60}
    assert (await all_settings(org))["leadB"]["enabled"] is True
    org["clock"].add(minutes=59)
    assert await auto.run_due(org["db"]) == 0
    org["clock"].add(minutes=1)
    assert await auto.run_due(org["db"]) == 1
    assert approver(org, await doc(org, tid)) == ("leadB", True)


async def test_same_delay_both_leaders_approves_once(org):
    await on(org, "leadA", 15)
    await on(org, "leadB", 15)
    tid = await new_task(org, "T1", "asha")
    org["clock"].add(minutes=15)
    assert await auto.run_due(org["db"]) == 1
    assert await auto.run_due(org["db"]) == 0
    d = await doc(org, tid)
    assert len([h for h in d["history"] if h["action"] == "approved"]) == 1
    assert approver(org, d)[0] in ("leadA", "leadB")


async def test_hold_by_one_leader_holds_the_task_for_everyone(org):
    """Hold means "a person will decide this one" — the other leader's timer waits too."""
    await on(org, "leadA", 10)
    await on(org, "leadB", 20)
    tid = await new_task(org, "T1", "asha")
    assert (await org["call"]("POST", f"/api/v1/auto-approve/hold/{tid}", "leadB", json={"hold": True})).status_code == 200
    org["clock"].add(minutes=60)
    assert await auto.run_due(org["db"]) == 0
    assert (await org["call"]("POST", f"/api/v1/auto-approve/hold/{tid}", "leadA", json={"hold": False})).status_code == 200
    assert await auto.run_due(org["db"]) == 1
    assert approver(org, await doc(org, tid)) == ("leadA", True)


# ── 4. Edge roles: deactivated leader, leader's own work ────────────────────

async def test_a_deactivated_leader_never_auto_approves(org):
    """Deactivated the way the app does it (is_active false), or only by status."""
    await on(org, "leadA", 10)
    t1 = await new_task(org, "T1", "asha")
    await org["db"]["users"].update_one({"_id": ObjectId(org["s"]["leadA"])}, {"$set": {"is_active": False}})
    org["clock"].add(minutes=10)
    assert await auto.run_due(org["db"]) == 0
    assert (await doc(org, t1))["status"] == "pending_review"

    await on(org, "leadB", 10)
    t2 = await new_task(org, "T1", "asha", "Two")
    await org["db"]["users"].update_one({"_id": ObjectId(org["s"]["leadB"])}, {"$set": {"status": "inactive"}})
    org["clock"].add(minutes=10)
    assert await auto.run_due(org["db"]) == 0
    assert (await doc(org, t2))["status"] == "pending_review"


async def test_a_leaders_own_work_is_not_approved_by_their_own_switch(org):
    """Auto-approve is a stand-in for reviewing the team's work, not a way to sign off your own."""
    await on(org, "leadA", 0)
    tid = await new_task(org, "T1", "leadA")
    d = await doc(org, tid)
    assert d["status"] == "pending_review" and timers(org, d) == {}
    # The other leader's switch still covers it.
    await on(org, "leadB", 0)
    t2 = await new_task(org, "T1", "leadA", "Again")
    assert approver(org, await doc(org, t2)) == ("leadB", True)


async def test_manual_decision_by_an_admin_ends_every_leaders_timer(org):
    await on(org, "leadA", 30)
    await on(org, "leadB", 60)
    tid = await new_task(org, "T1", "asha")
    r = await org["call"]("PUT", f"/api/v1/projects/{tid}", "admin", json={"status": "approved"})
    assert r.status_code == 200
    d = await doc(org, tid)
    assert approver(org, d) == ("admin", False) and not d.get("auto_approvals")
    org["clock"].add(minutes=60)
    assert await auto.run_due(org["db"]) == 0


# ── 5. Model-based: random sequences vs an independent model ────────────────

DELAYS = [0, 1, 5, 30, 120]
SUBMITTERS = {"T1": ["asha", "tlx", "leadC", "leadA", "leadB"], "T2": ["mira", "leadX"], "T3": ["zane", "pia"], "T4": ["omar"]}


@pytest.mark.parametrize("seed", range(30))
async def test_random_sequences_match_the_model(org, seed):
    rnd = random.Random(seed)
    o = org
    model_set = {u: {"enabled": False, "delay": 0, "since": None} for u in LEADERS}
    tasks = {}       # tid -> {team, assignee, status, submitted, timers{leader: at}, held, approvers(set allowed)}

    def leaders_of(team):
        return TEAMS[team]["leader"]

    def fire(tid, now):
        t = tasks[tid]
        if t["status"] != "pending_review" or t["held"] or not t["timers"]:
            return
        due = {u: at for u, at in t["timers"].items() if at <= now}
        if not due:
            return
        first = min(due.values())
        t["status"] = "approved"
        t["approvers"] = {u for u, at in due.items() if at == first}
        t["timers"] = {}

    for step in range(45):
        now = o["clock"]()
        op = rnd.choices(["switch", "submit", "time", "hold", "manual"], [3, 4, 3, 1, 1])[0]
        if op == "switch":
            u = rnd.choice(LEADERS)
            en, dl = rnd.random() < 0.65, rnd.choice(DELAYS)
            await on(o, u, dl, en)
            m = model_set[u]
            if en and not m["enabled"]:
                m["since"] = now
            if not en:
                m["since"] = None
                for t in tasks.values():
                    if t["status"] == "pending_review":
                        t["timers"].pop(u, None)
            m["enabled"], m["delay"] = en, dl
        elif op == "submit":
            team = rnd.choice(list(TEAMS))
            who = rnd.choice(SUBMITTERS[team])
            tid = await new_task(o, team, who, f"S{seed}-{step}")
            tasks[tid] = {"team": team, "status": "pending_review", "held": False, "approvers": None,
                          "timers": {u: now + timedelta(minutes=model_set[u]["delay"])
                                     for u in leaders_of(team)
                                     if model_set[u]["enabled"] and u != who}}
            if any(at <= now for at in tasks[tid]["timers"].values()) and \
                    min(tasks[tid]["timers"].values()) == now:
                fire(tid, now)
        elif op == "time":
            o["clock"].add(minutes=rnd.choice([1, 4, 5, 25, 30, 90, 120]))
            await auto.run_due(o["db"])
            for tid in tasks:
                fire(tid, o["clock"]())
        elif op == "hold":
            waiting = [t for t, v in tasks.items() if v["status"] == "pending_review"]
            if waiting:
                tid = rnd.choice(waiting)
                h = not tasks[tid]["held"]
                actor = rnd.choice(leaders_of(tasks[tid]["team"]))
                r = await o["call"]("POST", f"/api/v1/auto-approve/hold/{tid}", actor, json={"hold": h})
                assert r.status_code == 200
                tasks[tid]["held"] = h
        else:
            waiting = [t for t, v in tasks.items() if v["status"] == "pending_review"]
            if waiting:
                tid = rnd.choice(waiting)
                st = rnd.choice(["approved", "reedit"])
                body = {"status": st} if st == "approved" else {"status": st, "reedit_reason": "fix"}
                r = await o["call"]("PUT", f"/api/v1/projects/{tid}", "sa", json=body)
                assert r.status_code == 200, r.text
                tasks[tid].update(status=st, timers={}, held=False, approvers={"sa"} if st == "approved" else None)

        # ── compare everything after every step ──
        st = await all_settings(o)
        for u in LEADERS:
            got = st[u] or {"enabled": False, "delay_minutes": 0}
            assert got["enabled"] is model_set[u]["enabled"], (seed, step, u)
            if model_set[u]["enabled"] or st[u]:
                assert got["delay_minutes"] == model_set[u]["delay"], (seed, step, u)
        for u in ROLE_OF:
            if u not in LEADERS:
                assert st[u] is None, (seed, step, u)
        for tid, t in tasks.items():
            d = await doc(o, tid)
            assert d["status"] == t["status"], (seed, step, op, tid, d["status"], t)
            if t["status"] == "pending_review":
                got = {o["who"][e["leader_id"]]: e["at"].replace(tzinfo=timezone.utc)
                       for e in d.get("auto_approvals") or []}
                assert got == t["timers"], (seed, step, op, got, t["timers"])
                assert bool(d.get("auto_approve_hold")) is t["held"]
            if t["status"] == "approved":
                who, is_auto = approver(o, d)
                assert who in t["approvers"], (seed, step, who, t["approvers"])
                assert is_auto is (who != "sa")
                assert who == "sa" or t["team"] in LEADS[who], "approved only by a leader of that team"
