"""
Ad Reports self-service — the QA pass across roles (2026-10-15).

1. Create matrix: every role × every team choice (own team, someone else's,
   two teams, a mix of a led team and a member team).
2. Action matrix: every role × every action on an employee's own account + ad.
3. Model-based: random sequences of creating, renaming, adding people, moving
   teams, ending, deleting, undoing, and people leaving / rejoining teams,
   compared step by step with an independent model of the rules.

Organisation (throwaway database):
    T1 Media   leader lead            members asha, mira, multi, kofi, coordm (Coordinator)
    T2 Design  leader lead2           members multi, zane
    T3 Ops     leader kofi            members omar
    sa / admin — elevated, no team;  tlx — Team Leader role, leads nothing;  out — no team
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
ROLE = {"lead": "Team Leader", "lead2": "Team Leader", "kofi": "Team Leader", "tlx": "Team Leader",
        "asha": "Employee", "mira": "Employee", "multi": "Employee", "zane": "Employee", "omar": "Employee",
        "out": "Employee", "coordm": "Coordinator", "sa": "Super Admin", "admin": "Admin"}
ELEVATED = {"sa", "admin", "coordm"}
TEAMS0 = {"T1": (["lead"], ["asha", "mira", "multi", "kofi", "coordm"]),
          "T2": (["lead2"], ["multi", "zane"]),
          "T3": (["kofi"], ["omar"])}


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
    name = f"mediaerp_test_selfm_{secrets.token_hex(4)}"
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
    await db["users"].insert_many([{"_id": U[k], "name": k.title(), "email": f"{k}@t.io", "is_active": True,
                                    "role_id": str(roles[r]["_id"])} for k, r in ROLE.items()])
    s = {k: str(v) for k, v in U.items()}
    T = {k: ObjectId() for k in TEAMS0}
    await db["teams"].insert_many([{"_id": T[k], "name": k, "members": [{"user_id": s[u], "role": "leader"} for u in L] +
                                    [{"user_id": s[u], "role": "member"} for u in M]} for k, (L, M) in TEAMS0.items()])
    await ar.ensure_indexes(db)

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
        yield {"db": db, "s": s, "who": {v: k for k, v in s.items()}, "T": {k: str(v) for k, v in T.items()},
               "call": call, "clock": clock}
    app.dependency_overrides.clear()
    await client.drop_database(name)
    client.close()


def members(teams=TEAMS0):
    return {t: set(L) | set(M) for t, (L, M) in teams.items()}


def leaders(teams=TEAMS0):
    return {t: set(L) for t, (L, _) in teams.items()}


def create_expect(role, chosen, mem=None, led=None):
    """(status, self_made) for `role` creating with only themselves on it in `chosen` teams."""
    mem, led = mem or members(), led or leaders()
    if role in ELEVATED or all(role in led[t] for t in chosen):
        return 201, False
    if all(role in mem[t] for t in chosen):
        return 201, True
    return 403, None


# ── 1. Create matrix ─────────────────────────────────────────────────────────

CHOICES = [["T1"], ["T2"], ["T3"], ["T1", "T2"], ["T3", "T1"]]


@pytest.mark.parametrize("kind", ["account", "ad"])
@pytest.mark.parametrize("chosen", CHOICES, ids=lambda c: "+".join(c))
@pytest.mark.parametrize("role", list(ROLE))
async def test_create_matrix(org, role, chosen, kind):
    o = org
    body = {"name": f"{role} {kind}", "team_ids": [o["T"][t] for t in chosen], "start_date": START,
            "assignees": [o["s"][role]]}
    if kind == "account":
        body["kind"] = "account"
    r = await o["call"]("POST", B, role, json=body)
    want, self_made = create_expect(role, chosen)
    assert r.status_code == want, (role, chosen, kind, r.status_code, r.text[:150])
    if want == 201:
        d = r.json()["data"]
        assert d["self_made"] is self_made, (role, chosen)
        assert [a["id"] for a in d["assignees"]] == [o["s"][role]]
        bell = await o["db"]["notifications"].find({"type": "ad_self_created"}).to_list(20)
        told = sorted(o["who"][str(b["user_id"])] for b in bell)
        want_told = sorted({l for t in chosen for l in leaders()[t]} - {role}) if self_made else []
        assert told == want_told, (role, chosen, told, want_told)


@pytest.mark.parametrize("role", ["asha", "multi", "kofi", "mira"])
async def test_never_for_someone_else(org, role):
    o = org
    team = "T1"
    for other in ("zane", "out", "lead"):
        if other == role:
            continue
        r = await o["call"]("POST", B, role, json={"name": "x", "team_ids": [o["T"][team]], "start_date": START,
                                                   "assignees": [o["s"][role], o["s"][other]]})
        assert r.status_code == 403, (role, other)


# ── 2. Action matrix on asha's own account + ad ─────────────────────────────

def act_expect(role, action):
    owner = role == "asha"
    manage = role == "lead" or role in ELEVATED
    sees = owner or manage
    run = lambda ok: ok if (owner or manage) else 404
    return {
        "view": 200 if sees else 404,
        "rename_acc": run(200), "rename_ad": run(200),
        "end_acc": run(200), "pause_ad": run(200), "remind_ad": run(200),
        "add_mira": (200 if manage else 403 if owner else 404),
        "move_T2": (200 if role in ELEVATED else 403 if sees else 404),
        "delete_acc": run(200), "delete_ad": run(200),
        "ad_into_acc": (201 if (owner or manage) else 403),
    }[action]


ACTIONS = ["view", "rename_acc", "rename_ad", "end_acc", "pause_ad", "remind_ad", "add_mira", "move_T2",
           "delete_acc", "delete_ad", "ad_into_acc"]


@pytest.mark.parametrize("action", ACTIONS)
@pytest.mark.parametrize("role", list(ROLE))
async def test_action_matrix(org, role, action):
    o, c, s = org, org["call"], org["s"]
    acc = (await c("POST", B, "asha", json={"kind": "account", "name": "Asha acc", "team_ids": [o["T"]["T1"]]})).json()["data"]["id"]
    ad = (await c("POST", B, "asha", json={"name": "Asha ad", "team_ids": [o["T"]["T1"]], "start_date": START,
                                           "account_id": acc})).json()["data"]["id"]
    before = await o["db"][ar.REPORTS].find({}, {"updated_at": 0, "last_manual_remind_at": 0}).to_list(50)
    r = {
        "view": lambda: c("GET", f"{B}/{acc}", role),
        "rename_acc": lambda: c("PATCH", f"{B}/{acc}", role, json={"name": "R"}),
        "rename_ad": lambda: c("PATCH", f"{B}/{ad}", role, json={"name": "R"}),
        "end_acc": lambda: c("PATCH", f"{B}/{acc}", role, json={"action": "end"}),
        "pause_ad": lambda: c("PATCH", f"{B}/{ad}", role, json={"action": "pause"}),
        "remind_ad": lambda: c("POST", f"{B}/{ad}/remind", role),
        "add_mira": lambda: c("PATCH", f"{B}/{ad}", role, json={"assignees": [s["asha"], s["mira"]]}),
        "move_T2": lambda: c("PATCH", f"{B}/{acc}", role, json={"team_ids": [o["T"]["T2"]]}),
        "delete_acc": lambda: c("DELETE", f"{B}/{acc}?with_ads=true", role),
        "delete_ad": lambda: c("DELETE", f"{B}/{ad}", role),
        "ad_into_acc": lambda: c("POST", B, role, json={"name": "In", "team_ids": [o["T"]["T1"]], "start_date": START,
                                                         "account_id": acc, "assignees": [s[role]]}),
    }[action]
    res = await r()
    want = act_expect(role, action)
    if action == "move_T2" and role in ELEVATED:
        want = 422            # its ad is in T1 only — a pre-existing rule, same for everyone
    assert res.status_code == want, (role, action, res.status_code, res.text[:160])
    if want >= 400:
        after = await o["db"][ar.REPORTS].find({}, {"updated_at": 0, "last_manual_remind_at": 0}).to_list(50)
        assert after == before, "a refused action changes nothing"


# ── 3. Model-based ───────────────────────────────────────────────────────────

ACTORS = ["asha", "multi", "mira", "kofi", "lead", "lead2", "sa", "zane"]


@pytest.mark.parametrize("seed", range(20))
async def test_random_sequences_match_the_model(org, seed):
    rnd = random.Random(seed)
    o, c, s, T = org, org["call"], org["s"], org["T"]
    mem, led = members(), leaders()
    reps = {}        # rid -> {creator, self_made, teams, people, status, exists, name, kind}
    batches = {}     # batch -> (rid, deleter, snapshot)

    def manage(a, r):
        return a in ELEVATED or any(a in led[t] for t in r["teams"])

    def owner(a, r):
        return r["self_made"] and r["creator"] == a and any(a in mem[t] for t in r["teams"]) and not manage(a, r)

    def visible(a, r):
        return a in r["people"] or manage(a, r)

    for step in range(40):
        op = rnd.choice(["create", "create", "rename", "add", "move", "end", "delete", "restore", "leave", "join",
                         "demote", "into"])
        a = rnd.choice(ACTORS)
        live = [k for k, v in reps.items() if v["exists"]]
        rid = rnd.choice(live) if live else None
        x = reps.get(rid)
        if op == "create":
            chosen = rnd.choice([["T1"], ["T2"], ["T1", "T2"], ["T3"]])
            kind = rnd.choice(["account", "ad"])
            body = {"name": f"C{step}", "team_ids": [T[t] for t in chosen], "start_date": START, "assignees": [s[a]]}
            if kind == "account":
                body["kind"] = "account"
            r = await c("POST", B, a, json=body)
            want, sm = create_expect(a, chosen, mem, led)
            assert r.status_code == want, (seed, step, a, chosen, r.text[:120])
            if want == 201:
                reps[r.json()["data"]["id"]] = {"creator": a, "self_made": sm, "teams": list(chosen), "people": [a],
                                                "status": "active", "exists": True, "name": f"C{step}", "kind": kind}
            continue
        if op == "demote":
            # lead2 steps down to a member of Design, or back up.
            now_leader = "lead2" in led["T2"]
            await o["db"]["teams"].update_one({"_id": ObjectId(T["T2"]), "members.user_id": s["lead2"]},
                                              {"$set": {"members.$.role": "member" if now_leader else "leader"}})
            if now_leader:
                led["T2"].discard("lead2")
            else:
                led["T2"].add("lead2")
            continue
        if op in ("leave", "join"):
            who, t = rnd.choice([("asha", "T1"), ("multi", "T1"), ("multi", "T2"), ("mira", "T1")])
            if op == "leave" and who in mem[t]:
                await o["db"]["teams"].update_one({"_id": ObjectId(T[t])}, {"$pull": {"members": {"user_id": s[who]}}})
                mem[t].discard(who)
            elif op == "join" and who not in mem[t]:
                await o["db"]["teams"].update_one({"_id": ObjectId(T[t])}, {"$push": {"members": {"user_id": s[who], "role": "member"}}})
                mem[t].add(who)
            continue
        if op == "restore":
            if not batches:
                continue
            b = rnd.choice(list(batches))
            rid_b, deleter, snap = batches[b]
            r = await c("POST", f"{B}/deleted/{b}/restore", a)
            want = 200 if (a == deleter or a in ELEVATED) else 403
            assert r.status_code == want, (seed, step, a, deleter)
            if want == 200:
                detached = snap.pop("_detached", [])
                reps[rid_b] = {**snap, "exists": True}
                acc_of = reps[rid_b].get("account")
                if acc_of and not reps.get(acc_of, {}).get("exists"):
                    reps[rid_b]["account"] = None          # its account is gone now
                for k in detached:
                    if reps[k]["exists"] and reps[k].get("account") is None:
                        reps[k]["account"] = rid_b
                del batches[b]
            continue
        if x is None:
            continue

        def gate():
            if not visible(a, x):
                return 404
            if not (manage(a, x) or owner(a, x)):
                return 403
            return None

        want = gate()
        if op == "rename":
            r = await c("PATCH", f"{B}/{rid}", a, json={"name": f"N{step}"})
            if want is None:
                want = 409 if x["status"] == "ended" else 200
            if want == 200:
                x["name"] = f"N{step}"
        elif op == "add":
            p = rnd.choice(["mira", "zane", a])
            new = list(dict.fromkeys(x["people"] + [p]))
            r = await c("PATCH", f"{B}/{rid}", a, json={"assignees": [s[q] for q in new]})
            if want is None:
                if not manage(a, x) and not set(new) <= ({a} | set(x["people"])):
                    want = 403
                elif x["status"] == "ended":
                    want = 409
                else:
                    want = 200
            if want == 200:
                x["people"] = new
        elif op == "move":
            nt = rnd.choice([["T1"], ["T2"], ["T1", "T2"]])
            r = await c("PATCH", f"{B}/{rid}", a, json={"team_ids": [T[t] for t in nt]})
            if want is None:
                changed = set(nt) != set(x["teams"]) or nt[0] != x["teams"][0]
                if not changed:
                    want = 409 if False else 200
                elif a in ELEVATED:
                    want = 200
                elif owner(a, x):
                    want = 200 if all(a in mem[t] for t in nt) else 403
                else:      # a leader of one of its teams
                    mine = {t for t in led if a in led[t]}
                    if any(t not in mine for t in set(nt) ^ set(x["teams"])):
                        want = 403
                    elif not set(nt) & mine:
                        want = 422
                    else:
                        want = 200
                if want == 200 and changed and x["status"] == "ended":
                    want = 409
            if want == 200:
                x["teams"] = list(nt)
        elif op == "into":
            accs = [k for k, v in reps.items() if v["exists"] and v["kind"] == "account"]
            if x["kind"] != "ad" or not accs:
                continue
            target = rnd.choice(accs)
            tv = reps[target]
            r = await c("PATCH", f"{B}/{rid}", a, json={"account_id": target})
            if want is None:
                if target == x.get("account"):
                    want = 200
                elif not manage(a, x) and a not in tv["people"]:
                    want = 403                      # owners move it only into accounts they look after
                elif tv["status"] == "ended" or not set(tv["teams"]) & set(x["teams"]):
                    want = 422
                elif x["status"] == "ended":
                    want = 409
                else:
                    want = 200
            if want == 200:
                x["account"] = target
        elif op == "end":
            r = await c("PATCH", f"{B}/{rid}", a, json={"action": "end"})
            if want is None:
                want = 409 if x["status"] == "ended" else 200
            if want == 200:
                x["status"] = "ended"
        elif op == "delete":
            r = await c("DELETE", f"{B}/{rid}", a)
            if want is None:
                want = 200
            if want == 200:
                # Deleting an account (keeping its ads) detaches them; Undo puts them back.
                detached = [k for k, v in reps.items() if v["exists"] and v.get("account") == rid] if x["kind"] == "account" else []
                for k in detached:
                    reps[k]["account"] = None
                batches[r.json()["data"]["batch"]] = (rid, a, {**x, "_detached": detached})
                x["exists"] = False
        assert r.status_code == want, (seed, step, op, a, x, r.status_code, r.text[:160])

        # compare the world
        for k, v in reps.items():
            g = await c("GET", f"{B}/{k}", "sa")
            if not v["exists"]:
                assert g.status_code == 404
                continue
            d = g.json()["data"]
            assert (d["name"], d["status"], sorted(t for t in d["team_ids"]), sorted(p["id"] for p in d["assignees"]),
                    d.get("account_id")) == \
                   (v["name"], v["status"], sorted(T[t] for t in v["teams"]), sorted(s[p] for p in v["people"]),
                    v.get("account")), (seed, step, op, v)


@pytest.mark.parametrize("kind", ["account", "ad"])
async def test_demoted_leader_gets_no_owner_rights(org, kind):
    """A leader's own report is not self-service: stepping down leaves them only as one of its people."""
    o, c = org, org["call"]
    body = {"name": "L2", "team_ids": [o["T"]["T2"]], "start_date": START, "assignees": [o["s"]["lead2"]]}
    if kind == "account":
        body["kind"] = "account"
    rid = (await c("POST", B, "lead2", json=body)).json()["data"]["id"]
    await o["db"]["teams"].update_one({"_id": ObjectId(o["T"]["T2"]), "members.user_id": o["s"]["lead2"]},
                                      {"$set": {"members.$.role": "member"}})
    d = (await c("GET", f"{B}/{rid}", "lead2")).json()["data"]
    assert d["self_made"] is False and d["can_own"] is False and d["can_manage"] is False
    assert (await c("PATCH", f"{B}/{rid}", "lead2", json={"name": "x"})).status_code == 403
    assert (await c("DELETE", f"{B}/{rid}", "lead2")).status_code == 403
