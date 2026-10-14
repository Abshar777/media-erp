"""
Ad Reports — account keepers, the QA pass (2026-10-14).

1. A full role × action matrix: every kind of person against every action on an
   ad inside an account, on the account itself, and on neighbouring accounts.
2. A model-based test: random sequences of actions by random people (including
   the team leader adding / removing the account's people mid-way, deletes and
   undos) compared step by step with an independent model of the rules.

Organisation (throwaway database):
    T1 "Media"   leader lead;  members keeper (Employee), member, adteam
    T2 "Other"   leader lead2, xkeeper (Team Leader of T2 only)
    ACC  (T1)  looked after by keeper + xkeeper   ← the account under test
    ACC2 (T1)  looked after by member
    ACCX (T2)  looked after by keeper (she is not in T2)
    AD   in ACC, updated by adteam;  LOOSE ad in T1 (no account), updated by keeper
    sa / admin / coord — elevated;  out — in no team
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
from app.routers import ad_reports as ar_router
from app.services import ad_report_service as ar

B = "/api/v1/ad-reports"
WED = date(2026, 10, 14)
START = "2026-10-10"
ROLE = {"lead": "Team Leader", "lead2": "Team Leader", "xkeeper": "Team Leader", "keeper": "Employee",
        "member": "Employee", "adteam": "Employee", "out": "Employee",
        "sa": "Super Admin", "admin": "Admin", "coord": "Coordinator"}
ELEVATED = {"sa", "admin", "coord"}
MANAGERS_T1 = {"lead"} | ELEVATED
T1_MEMBERS = {"lead", "keeper", "member", "adteam"}


class Clock:
    def __init__(self, d):
        self.today = d

    def __call__(self):
        return self.today


@pytest.fixture
async def org(monkeypatch):
    client = AsyncIOMotorClient(settings.mongodb_url, serverSelectionTimeoutMS=3000)
    try:
        await client.admin.command("ping")
    except Exception:
        client.close()
        pytest.skip("MongoDB not reachable — integration tests skipped")
    name = f"mediaerp_test_keepers_{secrets.token_hex(4)}"
    db = client[name]
    import app.database as dbmod
    monkeypatch.setattr(dbmod, "_client", client)
    monkeypatch.setitem(settings.__dict__, "mongodb_db_name", name)
    clock = Clock(WED)
    monkeypatch.setattr(ar, "today_ist", clock)
    monkeypatch.setattr(ar_router, "today_ist", clock)

    roles = {r: {"_id": ObjectId(), "role_name": r} for r in set(ROLE.values())}
    await db["roles"].insert_many(list(roles.values()))
    U = {k: ObjectId() for k in ROLE}
    await db["users"].insert_many([{"_id": U[k], "name": k, "email": f"{k}@t.io", "is_active": True,
                                    "role_id": str(roles[r]["_id"])} for k, r in ROLE.items()])
    s = {k: str(v) for k, v in U.items()}
    T1, T2 = ObjectId(), ObjectId()
    await db["teams"].insert_many([
        {"_id": T1, "name": "Media", "members": [{"user_id": s["lead"], "role": "leader"}] +
         [{"user_id": s[u], "role": "member"} for u in ("keeper", "member", "adteam")]},
        {"_id": T2, "name": "Other", "members": [{"user_id": s["lead2"], "role": "leader"},
                                                 {"user_id": s["xkeeper"], "role": "leader"}]},
    ])
    await ar.ensure_indexes(db)

    def as_user(k):
        async def _u():
            return {"_id": U[k], "name": k, "email": f"{k}@t.io",
                    "role_id": str(roles[ROLE[k]]["_id"]), "_role": roles[ROLE[k]]}
        return _u

    app.dependency_overrides[get_db] = lambda: db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as ac:
        async def call(method, path, who, **kw):
            app.dependency_overrides[get_current_user] = as_user(who)
            return await ac.request(method, path, **kw)

        t1, t2 = str(T1), str(T2)

        async def mk(who, **kw):
            r = await call("POST", B, who, json=kw)
            assert r.status_code == 201, r.text
            return r.json()["data"]["id"]
        acc = await mk("lead", kind="account", name="ACC", team_ids=[t1], assignees=[s["keeper"], s["xkeeper"]])
        acc2 = await mk("lead", kind="account", name="ACC2", team_ids=[t1], assignees=[s["member"]])
        accx = await mk("lead2", kind="account", name="ACCX", team_ids=[t2], assignees=[s["keeper"]])
        ad = await mk("lead", name="AD", team_ids=[t1], assignees=[s["adteam"]], start_date=START, account_id=acc)
        loose = await mk("lead", name="LOOSE", team_ids=[t1], assignees=[s["keeper"]], start_date=START)
        yield {"db": db, "s": s, "who": {v: k for k, v in s.items()}, "t1": t1, "t2": t2, "clock": clock,
               "call": call, "acc": acc, "acc2": acc2, "accx": accx, "ad": ad, "loose": loose}
    app.dependency_overrides.clear()
    await client.drop_database(name)
    client.close()


# ── 1. Role × action matrix ─────────────────────────────────────────────────

def expected(role, action):
    manage = role in MANAGERS_T1
    keeper = role in ("keeper", "xkeeper")
    sees_ad = manage or keeper or role == "adteam"
    on_ad = lambda ok: ok if (manage or keeper) else (403 if sees_ad else 404)
    sees_acc = manage or keeper
    leader_only_on_ad = lambda ok: ok if manage else (403 if sees_ad else 404)
    return {
        "view_ad": 200 if sees_ad else 404,
        "add_ad": 201 if (manage or keeper) else 403,
        "edit_name": on_ad(200),
        "edit_people_team": on_ad(200),
        "edit_people_outsider": leader_only_on_ad(200),
        "change_teams": (200 if role in ELEVATED else 403 if sees_ad else 404),
        "move_account": leader_only_on_ad(200),
        "clear_account": leader_only_on_ad(200),
        "pause": on_ad(200),
        "end": on_ad(200),
        "delete": on_ad(200),
        "remind": on_ad(200),
        "old_numbers": leader_only_on_ad(200),
        "edit_account": 200 if manage else (403 if sees_acc else 404),
        "end_account": 200 if manage else (403 if sees_acc else 404),
        "delete_account": 200 if manage else (403 if sees_acc else 404),
        "create_account": 201 if manage else 403,
        "create_loose_ad": 201 if manage else 403,
        "add_to_acc2": 201 if (manage or role == "member") else 403,
        "add_to_accx": 201 if (role in ELEVATED or role in ("lead2", "xkeeper", "keeper")) else 403,
        "loose_pause": 200 if manage else (403 if role == "keeper" else 404),
    }[action]


ACTIONS = ["view_ad", "add_ad", "edit_name", "edit_people_team", "edit_people_outsider", "change_teams",
           "move_account", "clear_account", "pause", "end", "delete", "remind", "old_numbers",
           "edit_account", "end_account", "delete_account", "create_account", "create_loose_ad",
           "add_to_acc2", "add_to_accx", "loose_pause"]


async def act(o, role, action):
    c, s, ad = o["call"], o["s"], o["ad"]
    new_ad = {"name": "New", "start_date": START, "assignees": [s["adteam"]]}
    if action == "view_ad":
        return await c("GET", f"{B}/{ad}", role)
    if action == "add_ad":
        return await c("POST", B, role, json={**new_ad, "team_ids": [o["t1"]], "account_id": o["acc"]})
    if action == "edit_name":
        return await c("PATCH", f"{B}/{ad}", role, json={"name": "Renamed", "team_ids": [o["t1"]]})
    if action == "edit_people_team":
        return await c("PATCH", f"{B}/{ad}", role, json={"assignees": [s["member"], s["keeper"]]})
    if action == "edit_people_outsider":
        return await c("PATCH", f"{B}/{ad}", role, json={"assignees": [s["out"]]})
    if action == "change_teams":
        return await c("PATCH", f"{B}/{ad}", role, json={"team_ids": [o["t1"], o["t2"]]})
    if action == "move_account":
        return await c("PATCH", f"{B}/{ad}", role, json={"account_id": o["acc2"]})
    if action == "clear_account":
        return await c("PATCH", f"{B}/{ad}", role, json={"clear_account": True})
    if action in ("pause", "end"):
        return await c("PATCH", f"{B}/{ad}", role, json={"action": action})
    if action == "delete":
        return await c("DELETE", f"{B}/{ad}", role)
    if action == "remind":
        return await c("POST", f"{B}/{ad}/remind", role)
    if action == "old_numbers":
        assert (await c("PUT", f"{B}/{ad}/entries/{START}", "lead", json={"leads": 1, "spend": "10"})).status_code == 201
        o["clock"].today = WED + timedelta(days=ar.OWNER_EDIT_DAYS + 3)
        return await c("PUT", f"{B}/{ad}/entries/{START}", role, json={"leads": 2, "spend": "20"})
    if action == "edit_account":
        return await c("PATCH", f"{B}/{o['acc']}", role, json={"name": "x"})
    if action == "end_account":
        return await c("PATCH", f"{B}/{o['acc']}", role, json={"action": "end"})
    if action == "delete_account":
        return await c("DELETE", f"{B}/{o['acc']}", role)
    if action == "create_account":
        return await c("POST", B, role, json={"kind": "account", "name": "Acc new", "team_ids": [o["t1"]]})
    if action == "create_loose_ad":
        return await c("POST", B, role, json={**new_ad, "team_ids": [o["t1"]]})
    if action == "add_to_acc2":
        return await c("POST", B, role, json={**new_ad, "team_ids": [o["t1"]], "account_id": o["acc2"]})
    if action == "add_to_accx":
        return await c("POST", B, role, json={**new_ad, "assignees": [s["keeper"]], "team_ids": [o["t2"]],
                                               "account_id": o["accx"]})
    if action == "loose_pause":
        return await c("PATCH", f"{B}/{o['loose']}", role, json={"action": "pause"})
    raise AssertionError(action)


@pytest.mark.parametrize("action", ACTIONS)
@pytest.mark.parametrize("role", list(ROLE))
async def test_matrix(org, role, action):
    before = await org["db"][ar.REPORTS].find({}, {"updated_at": 0}).to_list(100)
    r = await act(org, role, action)
    want = expected(role, action)
    assert r.status_code == want, (role, action, r.status_code, r.text[:200])
    if want >= 400 and action not in ("old_numbers",):
        after = await org["db"][ar.REPORTS].find({}, {"updated_at": 0}).to_list(100)
        assert after == before, "a refused action changes nothing"


async def test_flags_in_payload_per_role(org):
    for role in ROLE:
        r = await org["call"]("GET", f"{B}/{org['ad']}", role)
        if r.status_code != 200:
            continue
        d = r.json()["data"]
        assert d["can_manage"] is (role in MANAGERS_T1), role
        assert d["can_run"] is (role in MANAGERS_T1 or role in ("keeper", "xkeeper")), role
        ra = await org["call"]("GET", f"{B}/{org['acc']}", role)
        if role == "adteam":
            assert ra.status_code == 404, "the ad's updater doesn't see the account"
            continue
        a = ra.json()["data"]
        assert a["can_add_ads"] is (role in MANAGERS_T1 or role in ("keeper", "xkeeper")), role
        assert a["can_run"] is a["can_manage"], "nobody 'runs' an account without managing it"


# ── 2. Edge cases ────────────────────────────────────────────────────────────

async def test_keeper_adds_into_a_two_team_account_in_either_team(org):
    c, s = org["call"], org["s"]
    both = (await c("POST", B, "sa", json={"kind": "account", "name": "Both", "team_ids": [org["t1"], org["t2"]],
                                           "assignees": [s["keeper"]]})).json()["data"]["id"]
    for teams in ([org["t1"]], [org["t2"]], [org["t1"], org["t2"]]):
        r = await c("POST", B, "keeper", json={"name": "x", "start_date": START, "assignees": [s["keeper"]],
                                                "team_ids": teams, "account_id": both})
        assert r.status_code == 201, (teams, r.text)
    # People from either team are fine; from neither, not.
    r = await c("POST", B, "keeper", json={"name": "x", "start_date": START, "assignees": [s["lead2"], s["member"]],
                                            "team_ids": [org["t1"], org["t2"]], "account_id": both})
    assert r.status_code == 201
    r = await c("POST", B, "keeper", json={"name": "x", "start_date": START, "assignees": [s["lead2"]],
                                            "team_ids": [org["t1"]], "account_id": both})
    assert r.status_code == 403, "lead2 isn't in the ad's team (T1) nor the account's people"


async def test_keeper_cannot_reorder_teams_either(org):
    c = org["call"]
    both_ad = (await c("POST", B, "sa", json={"name": "two", "start_date": START, "assignees": [org["s"]["adteam"]],
                                              "team_ids": [org["t1"], org["t2"]], "account_id": org["acc"]}))
    rid = both_ad.json()["data"]["id"]
    r = await c("PATCH", f"{B}/{rid}", "keeper", json={"team_ids": [org["t2"], org["t1"]]})
    assert r.status_code == 403, "changing the main team is a team change"
    assert (await c("PATCH", f"{B}/{rid}", "keeper", json={"team_ids": [org["t1"], org["t2"], org["t1"]], "name": "ok"})).status_code == 200


async def test_keeper_of_an_ended_account(org):
    c = org["call"]
    assert (await c("PATCH", f"{B}/{org['acc']}", "lead", json={"action": "end"})).status_code == 200
    a = (await c("GET", f"{B}/{org['acc']}", "keeper")).json()["data"]
    assert a["can_add_ads"] is False
    r = await c("POST", B, "keeper", json={"name": "x", "start_date": START, "assignees": [org["s"]["adteam"]],
                                            "team_ids": [org["t1"]], "account_id": org["acc"]})
    assert r.status_code == 422, "no new ads in an ended account"
    # Its ads keep running — and she still runs them.
    assert (await c("PATCH", f"{B}/{org['ad']}", "keeper", json={"action": "pause"})).status_code == 200


async def test_keeper_validation_still_applies(org):
    c, s = org["call"], org["s"]
    base = {"start_date": START, "assignees": [s["adteam"]], "team_ids": [org["t1"]], "account_id": org["acc"]}
    for bad in ({"name": ""}, {"name": "x" * 121}, {"name": "x", "end_date": "2026-10-01"},
                {"name": "x", "assignees": []}, {"name": "x", "start_date": "2020-01-01"},
                {"name": "x", "reminder_due": "18:00", "reminder_escalate": "17:00"}):
        r = await c("POST", B, "keeper", json={**base, **bad})
        assert r.status_code == 422, (bad, r.status_code)
    assert (await c("PATCH", f"{B}/{org['ad']}", "keeper", json={"assignees": []})).status_code == 422
    assert (await c("PATCH", f"{B}/{org['ad']}", "keeper", json={"end_date": "2026-01-01"})).status_code == 422


async def test_remind_once_an_hour_for_keepers_too(org):
    c = org["call"]
    assert (await c("POST", f"{B}/{org['ad']}/remind", "keeper")).status_code == 200
    assert (await c("POST", f"{B}/{org['ad']}/remind", "xkeeper")).status_code == 429
    import asyncio
    for _ in range(50):                       # delivered by a background task
        bell = await org["db"]["notifications"].find({"type": ar.NOTIF_DUE}).to_list(10)
        if bell:
            break
        await asyncio.sleep(0.05)
    assert [str(b["user_id"]) for b in bell] == [org["s"]["adteam"]], "goes to the ad's people only"


async def test_undo_after_a_keeper_delete(org):
    c = org["call"]
    batch = (await c("DELETE", f"{B}/{org['ad']}", "keeper")).json()["data"]["batch"]
    assert (await c("POST", f"{B}/deleted/{batch}/restore", "xkeeper")).status_code == 403, "another keeper can't"
    assert (await c("POST", f"{B}/deleted/{batch}/restore", "lead")).status_code == 403, \
        "nor the team leader (existing rule: the deleter or an admin)"
    assert (await c("POST", f"{B}/deleted/{batch}/restore", "admin")).status_code == 200
    assert (await c("GET", f"{B}/{org['ad']}", "keeper")).json()["data"]["account_id"] == org["acc"]


async def test_two_keepers_pausing_at_once_one_wins(org):
    import asyncio
    c = org["call"]
    # Sequential through the shared client, but the second sees the first's change.
    r1 = await c("PATCH", f"{B}/{org['ad']}", "keeper", json={"action": "pause"})
    r2 = await c("PATCH", f"{B}/{org['ad']}", "xkeeper", json={"action": "pause"})
    assert r1.status_code == 200 and r2.status_code == 409
    await asyncio.sleep(0)


async def test_keeper_flags_follow_the_account_people_live(org):
    c, s = org["call"], org["s"]
    await c("PATCH", f"{B}/{org['acc']}", "lead", json={"assignees": [s["member"]]})
    assert (await c("GET", f"{B}/{org['ad']}", "keeper")).status_code == 404
    d = (await c("GET", f"{B}/{org['ad']}", "member")).json()["data"]
    assert d["can_run"] and not d["can_manage"]
    await c("PATCH", f"{B}/{org['acc']}", "lead", json={"assignees": [s["keeper"]]})
    assert (await c("GET", f"{B}/{org['ad']}", "keeper")).json()["data"]["can_run"] is True
    assert (await c("GET", f"{B}/{org['ad']}", "member")).status_code == 404


# ── 3. Model-based: random sequences vs an independent model ────────────────

ACTORS = ["lead", "lead2", "keeper", "xkeeper", "member", "adteam", "out", "sa", "coord"]
KEEPER_CANDIDATES = ["keeper", "xkeeper", "member"]
PEOPLE_CHOICES = [["adteam"], ["member"], ["keeper", "adteam"], ["out"], ["xkeeper"], ["member", "out"]]


@pytest.mark.parametrize("seed", range(20))
async def test_random_sequences_match_the_model(org, seed):
    rnd = random.Random(seed)
    o, c, s = org, org["call"], org["s"]
    keepers = {"keeper", "xkeeper"}
    ads = {o["ad"]: {"exists": True, "status": "active", "name": "AD", "people": ["adteam"], "reminded": False}}
    batches = {}                 # batch -> (ad id, deleter, snapshot)

    def manage(a):
        return a in MANAGERS_T1

    def runs(a):
        return manage(a) or a in keepers

    def sees(a, x):
        return manage(a) or a in keepers or a in x["people"]

    for step in range(40):
        op = rnd.choice(["create", "name", "people", "pause", "resume", "end", "delete", "restore", "remind", "keepers"])
        a = rnd.choice(ACTORS)
        live = [k for k, v in ads.items() if v["exists"]]
        rid = rnd.choice(live) if live else None
        x = ads.get(rid)

        if op == "keepers":
            new = sorted(rnd.sample(KEEPER_CANDIDATES, rnd.randint(0, 3)))
            r = await c("PATCH", f"{B}/{o['acc']}", "lead", json={"assignees": [s[k] for k in new]})
            assert r.status_code == 200
            keepers = set(new)
            continue
        if op == "create":
            r = await c("POST", B, a, json={"name": f"C{step}", "start_date": START, "assignees": [s["adteam"]],
                                             "team_ids": [o["t1"]], "account_id": o["acc"]})
            want = 201 if runs(a) else 403
            assert r.status_code == want, (seed, step, op, a, r.status_code, r.text[:150])
            if want == 201:
                ads[r.json()["data"]["id"]] = {"exists": True, "status": "active", "name": f"C{step}",
                                               "people": ["adteam"], "reminded": False}
            continue
        if op == "restore":
            if not batches:
                continue
            b = rnd.choice(list(batches))
            ad_id, deleter, snap = batches[b]
            r = await c("POST", f"{B}/deleted/{b}/restore", a)
            want = 200 if (a == deleter or a in ELEVATED) else 403
            assert r.status_code == want, (seed, step, op, a, deleter, r.status_code)
            if want == 200:
                ads[ad_id] = {**snap, "exists": True}
                del batches[b]
            continue
        if x is None:
            continue

        def gate(ok_code, state_ok=True, conflict=409):
            if not sees(a, x):
                return 404
            if not runs(a):
                return 403
            return ok_code if state_ok else conflict

        if op == "name":
            r = await c("PATCH", f"{B}/{rid}", a, json={"name": f"N{step}"})
            want = gate(200, x["status"] != "ended")
            if want == 200:
                x["name"] = f"N{step}"
        elif op == "people":
            choice = rnd.choice(PEOPLE_CHOICES)
            r = await c("PATCH", f"{B}/{rid}", a, json={"assignees": [s[p] for p in choice]})
            want = gate(200, x["status"] != "ended")
            if sees(a, x) and runs(a) and not manage(a):
                pool = T1_MEMBERS | keepers | set(x["people"])
                if not set(choice) <= pool:
                    want = 403                # people are checked before "it has ended"
            if want == 200:
                x["people"] = choice
        elif op in ("pause", "resume", "end"):
            r = await c("PATCH", f"{B}/{rid}", a, json={"action": op})
            ok = {"pause": x["status"] == "active", "resume": x["status"] == "paused", "end": x["status"] != "ended"}[op]
            want = gate(200, ok)
            if want == 200:
                x["status"] = {"pause": "paused", "resume": "active", "end": "ended"}[op]
        elif op == "delete":
            r = await c("DELETE", f"{B}/{rid}", a)
            want = gate(200)
            if want == 200:
                batches[r.json()["data"]["batch"]] = (rid, a, dict(x))
                x["exists"] = False
        elif op == "remind":
            r = await c("POST", f"{B}/{rid}/remind", a)
            want = gate(200, x["status"] == "active")
            if want == 200 and x["reminded"]:
                want = 429
            if want == 200:
                x["reminded"] = True
        assert r.status_code == want, (seed, step, op, a, rid == o["ad"], x, keepers, r.status_code, r.text[:150])

        # Compare the whole world after every step.
        for k, v in ads.items():
            g = await c("GET", f"{B}/{k}", "sa")
            if not v["exists"]:
                assert g.status_code == 404, (seed, step, k)
                continue
            d = g.json()["data"]
            assert (d["status"], d["name"], sorted(p["id"] for p in d["assignees"]), d["account_id"]) == \
                   (v["status"], v["name"], sorted(s[p] for p in v["people"]), o["acc"]), (seed, step, op, v, d["status"])
