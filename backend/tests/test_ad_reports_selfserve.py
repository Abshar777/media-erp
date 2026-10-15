"""
Ad Reports — self-service (2026-10-15): an employee creates their own ad
account or ad, in teams they belong to, with only themselves on it, and then
edits / ends / deletes what they made. Their team leaders are told and keep
full control. Ads inside an account they made are theirs alone too.

World (from test_ad_reports): Media = lead (leader), asha, mira; Other = lead2;
"out" is in no team; sa is Super Admin.
"""
from datetime import timedelta

from bson import ObjectId

from app.services import ad_report_service as ar
from tests.test_ad_reports import B, START, WED, put, world  # noqa: F401


async def mk(w, who, **kw):
    body = {"name": f"{who}'s", "team_id": w["t1"], "start_date": START, **kw}
    return await w["call"]("POST", B, who, json=body)


async def acct(w, who="asha", **kw):
    return await mk(w, who, kind="account", ad_account_ref="act_self", **kw)


async def get(w, rid, who):
    return await w["call"]("GET", f"{B}/{rid}", who)


async def bells(w, who, kind="ad_self_created"):
    return await w["db"]["notifications"].find(
        {"type": kind, "user_id": {"$in": [w["s"][who], ObjectId(w["s"][who])]}}).to_list(20)


async def join(w, who, team="t2"):
    await w["db"]["teams"].update_one({"_id": ObjectId(w[team])}, {"$push": {"members": {"user_id": w["s"][who], "role": "member"}}})


async def leave(w, who, team="t1"):
    await w["db"]["teams"].update_one({"_id": ObjectId(w[team])}, {"$pull": {"members": {"user_id": w["s"][who]}}})


# ── Creating ─────────────────────────────────────────────────────────────────

async def test_employee_creates_own_account_and_the_leader_hears(world):
    w, s = world, world["s"]
    r = await acct(w)
    assert r.status_code == 201, r.text
    d = r.json()["data"]
    assert d["self_made"] and d["kind"] == "account" and d["team_ids"] == [w["t1"]]
    assert [a["id"] for a in d["assignees"]] == [s["asha"]] and d["created_by"] == s["asha"]
    assert d["can_own"] and d["can_run"] and not d["can_manage"] and d["can_add_ads"]
    b = await bells(w, "lead")
    assert len(b) == 1 and "Asha" in b[0]["title"] and "ad account" in b[0]["title"]
    assert b[0]["metadata"]["link"] == f"/ad-reports?report={d['id']}"
    assert not await bells(w, "asha") and not await bells(w, "lead2") and not await bells(w, "sa")


async def test_only_themselves(world):
    w, s = world, world["s"]
    for people in ([s["asha"], s["mira"]], [s["mira"]], [s["out"]]):
        assert (await acct(w, assignees=people)).status_code == 403, people
        assert (await mk(w, "asha", assignees=people)).status_code == 403, people
    assert (await acct(w, assignees=[s["asha"]])).status_code == 201
    assert (await acct(w, assignees=[])).json()["data"]["assignees"][0]["id"] == s["asha"], "nobody = themselves"
    assert (await mk(w, "asha")).json()["data"]["assignees"][0]["id"] == s["asha"]


async def test_only_their_own_teams(world):
    w = world
    assert (await acct(w, team_id=w["t2"])).status_code == 403
    assert (await acct(w, team_ids=[w["t1"], w["t2"]])).status_code == 403
    assert (await acct(w, "out")).status_code == 403, "in no team at all"
    await join(w, "asha")
    r = await acct(w, team_ids=[w["t1"], w["t2"]])
    assert r.status_code == 201 and r.json()["data"]["team_ids"] == [w["t1"], w["t2"]]
    assert [len(await bells(w, x)) for x in ("lead", "lead2")] == [1, 1], "both teams' leaders hear"


async def test_standalone_ad_for_themselves(world):
    w, s = world, world["s"]
    r = await mk(w, "asha", extra_metrics=["clicks"])
    assert r.status_code == 201
    d = r.json()["data"]
    assert d["self_made"] and d["kind"] == "ad" and d["account_id"] is None and d["can_own"]
    assert "New ad by Asha" == (await bells(w, "lead"))[0]["title"]


async def test_ads_in_own_account_only_themselves(world):
    w, s = world, world["s"]
    acc = (await acct(w)).json()["data"]["id"]
    r = await mk(w, "asha", account_id=acc, assignees=[s["asha"]])
    assert r.status_code == 201 and r.json()["data"]["account_id"] == acc
    r = await mk(w, "asha", account_id=acc, assignees=[s["mira"]])
    assert r.status_code == 403 and "own account" in r.json()["message"]
    r = await mk(w, "asha", account_id=acc, assignees=[s["asha"], s["mira"]])
    assert r.status_code == 403


async def test_not_into_someone_elses_account(world):
    w, s = world, world["s"]
    leaders = (await mk(w, "lead", kind="account", name="Leader's")).json()["data"]["id"]
    r = await mk(w, "asha", account_id=leaders, assignees=[s["asha"]])
    assert r.status_code == 403 and "look after" in r.json()["message"]
    mira_acc = (await acct(w, "mira")).json()["data"]["id"]
    assert (await mk(w, "asha", account_id=mira_acc, assignees=[s["asha"]])).status_code == 403


# ── Owning: edit, end, delete ────────────────────────────────────────────────

async def test_owner_edits_ends_deletes_own_account(world):
    w, s = world, world["s"]
    acc = (await acct(w)).json()["data"]["id"]
    ad = (await mk(w, "asha", account_id=acc)).json()["data"]["id"]
    c = w["call"]
    r = await c("PATCH", f"{B}/{acc}", "asha", json={"name": "Renamed", "ad_account_ref": "act_9", "assignees": [s["asha"]]})
    assert r.status_code == 200 and r.json()["data"]["name"] == "Renamed"
    assert (await c("PATCH", f"{B}/{acc}", "asha", json={"assignees": [s["asha"], s["mira"]]})).status_code == 403
    assert (await c("PATCH", f"{B}/{acc}", "asha", json={"team_ids": [w["t2"]]})).status_code == 403
    r = await c("PATCH", f"{B}/{acc}", "asha", json={"action": "end"})
    assert r.status_code == 200 and r.json()["data"]["status"] == "ended", r.text
    r = await c("DELETE", f"{B}/{acc}?with_ads=true", "asha")
    assert r.status_code == 200, r.text
    assert (await get(w, ad, "lead")).status_code == 404, "its ads went too"
    assert (await c("POST", f"{B}/deleted/{r.json()['data']['batch']}/restore", "asha")).status_code == 200
    assert (await get(w, ad, "asha")).json()["data"]["account_id"] == acc


async def test_owner_runs_own_ad(world):
    w, s = world, world["s"]
    ad = (await mk(w, "asha")).json()["data"]["id"]
    acc = (await acct(w)).json()["data"]["id"]
    leaders = (await mk(w, "lead", kind="account", name="Leader's")).json()["data"]["id"]
    c = w["call"]
    r = await c("PATCH", f"{B}/{ad}", "asha", json={"name": "Mine v2", "extra_metrics": ["reach"], "end_date": "2026-12-31",
                                                     "reminder_due": "11:00", "reminder_escalate": "15:00"})
    assert r.status_code == 200
    assert (await c("PATCH", f"{B}/{ad}", "asha", json={"action": "pause"})).status_code == 200
    assert (await c("PATCH", f"{B}/{ad}", "asha", json={"action": "resume"})).status_code == 200
    assert (await c("PATCH", f"{B}/{ad}", "asha", json={"account_id": acc})).json()["data"]["account_id"] == acc, \
        "into her own account"
    assert (await c("PATCH", f"{B}/{ad}", "asha", json={"account_id": leaders})).status_code == 403, \
        "not into one she doesn't look after"
    assert (await c("PATCH", f"{B}/{ad}", "asha", json={"clear_account": True})).json()["data"]["account_id"] is None
    assert (await c("PATCH", f"{B}/{ad}", "asha", json={"assignees": [s["mira"]]})).status_code == 403
    assert (await c("POST", f"{B}/{ad}/remind", "asha")).status_code == 200
    assert (await c("PATCH", f"{B}/{ad}", "asha", json={"action": "end"})).status_code == 200
    r = await c("DELETE", f"{B}/{ad}", "asha")
    assert r.status_code == 200
    assert (await c("POST", f"{B}/deleted/{r.json()['data']['batch']}/restore", "asha")).status_code == 200


async def test_owner_moves_between_own_teams_only(world):
    w = world
    await join(w, "asha")
    ad = (await mk(w, "asha")).json()["data"]["id"]
    c = w["call"]
    r = await c("PATCH", f"{B}/{ad}", "asha", json={"team_ids": [w["t2"], w["t1"]]})
    assert r.status_code == 200 and r.json()["data"]["team_ids"] == [w["t2"], w["t1"]]
    await leave(w, "asha", "t2")
    assert (await c("PATCH", f"{B}/{ad}", "asha", json={"team_ids": [w["t2"]]})).status_code == 403


async def test_old_numbers_stay_with_the_leader(world):
    w = world
    ad = (await mk(w, "asha")).json()["data"]["id"]
    assert (await put(w, ad, "2026-10-12", who="asha")).status_code == 201
    w["clock"].today = WED + timedelta(days=ar.OWNER_EDIT_DAYS + 3)
    assert (await put(w, ad, "2026-10-12", who="asha", leads=5)).status_code == 403
    assert (await put(w, ad, "2026-10-12", who="lead", leads=5)).status_code == 200


# ── Others, leaders, and losing it ──────────────────────────────────────────

async def test_other_employees_cannot_touch_it(world):
    w = world
    acc = (await acct(w)).json()["data"]["id"]
    ad = (await mk(w, "asha")).json()["data"]["id"]
    for rid in (acc, ad):
        for who in ("mira", "out", "lead2"):
            assert (await get(w, rid, who)).status_code == 404, who
            assert (await w["call"]("PATCH", f"{B}/{rid}", who, json={"name": "x"})).status_code == 404
            assert (await w["call"]("DELETE", f"{B}/{rid}", who)).status_code == 404


async def test_leader_keeps_full_control(world):
    w, s = world, world["s"]
    acc = (await acct(w)).json()["data"]["id"]
    ad = (await mk(w, "asha")).json()["data"]["id"]
    c = w["call"]
    d = (await get(w, ad, "lead")).json()["data"]
    assert d["can_manage"] and not d["can_own"]
    r = await c("PATCH", f"{B}/{ad}", "lead", json={"assignees": [s["asha"], s["mira"]]})
    assert r.status_code == 200, "a leader may add others"
    # The creator may keep who the leader added, but add nobody new.
    assert (await c("PATCH", f"{B}/{ad}", "asha", json={"name": "ok", "assignees": [s["asha"], s["mira"]]})).status_code == 200
    assert (await c("PATCH", f"{B}/{ad}", "asha", json={"assignees": [s["asha"], s["out"]]})).status_code == 403
    assert (await c("DELETE", f"{B}/{acc}", "lead")).status_code == 200


async def test_leaving_the_team_ends_owner_rights(world):
    w = world
    ad = (await mk(w, "asha")).json()["data"]["id"]
    await leave(w, "asha")
    d = (await get(w, ad, "asha")).json()["data"]
    assert d["can_own"] is False and d["can_run"] is False, "she still sees it (she's on it) but can't run it"
    assert (await w["call"]("PATCH", f"{B}/{ad}", "asha", json={"name": "x"})).status_code == 403
    assert (await w["call"]("DELETE", f"{B}/{ad}", "asha")).status_code == 403


async def test_a_leaders_own_report_is_not_self_made(world):
    """Owner rights come only from self-service; a demoted leader doesn't keep them."""
    w = world
    rid = (await mk(w, "lead", assignees=[w["s"]["lead"], w["s"]["asha"]])).json()["data"]["id"]   # still sees it after
    assert (await get(w, rid, "lead")).json()["data"]["self_made"] is False
    await w["db"]["teams"].update_one({"_id": ObjectId(w["t1"]), "members.user_id": w["s"]["lead"]},
                                      {"$set": {"members.$.role": "member"}})
    assert (await get(w, rid, "lead")).status_code == 200, "on it, so they still see it"
    assert (await w["call"]("PATCH", f"{B}/{rid}", "lead", json={"name": "x"})).status_code == 403


async def test_today_flags(world):
    w = world
    t = lambda who: w["call"]("GET", f"{B}/today", who)
    a = (await t("asha")).json()["data"]
    assert a["can_create_own"] and not a["can_create"] and a["visible"]
    l = (await t("lead")).json()["data"]
    assert l["can_create"] and not l["can_create_own"]
    o = (await t("out")).json()["data"]
    assert not o["can_create"] and not o["can_create_own"]


async def test_elevated_creation_is_not_self_made(world):
    w = world
    d = (await mk(w, "sa", assignees=[w["s"]["asha"]])).json()["data"]
    assert d["self_made"] is False and not await bells(w, "lead")


async def test_an_ad_added_inside_own_account_is_owned_too(world):
    w, s = world, world["s"]
    await join(w, "asha")
    acc = (await acct(w)).json()["data"]["id"]
    ad = (await mk(w, "asha", account_id=acc)).json()["data"]
    assert ad["self_made"] and ad["can_own"], "made by her → hers"
    assert [a["id"] for a in ad["assignees"]] == [s["asha"]], "nobody named in her own account = her"
    c = w["call"]
    assert (await c("PATCH", f"{B}/{ad['id']}", "asha", json={"clear_account": True})).status_code == 200
    assert (await c("PATCH", f"{B}/{ad['id']}", "asha", json={"team_ids": [w["t2"]]})).status_code == 200
    assert (await c("PATCH", f"{B}/{ad['id']}", "asha", json={"assignees": [s["mira"]]})).status_code == 403


async def test_keeper_made_ad_in_a_leaders_account_keeps_teammates(world):
    """Sharanya's case: she looks after a leader's account; her own ad there may still name teammates."""
    w, s = world, world["s"]
    leaders = (await mk(w, "lead", kind="account", name="Leader's", assignees=[s["asha"]])).json()["data"]["id"]
    r = await mk(w, "asha", account_id=leaders, assignees=[s["mira"]])
    assert r.status_code == 201 and r.json()["data"]["self_made"]
    ad = r.json()["data"]["id"]
    r = await w["call"]("PATCH", f"{B}/{ad}", "asha", json={"assignees": [s["mira"], s["asha"]]})
    assert r.status_code == 200, "keeper's teammates still allowed"
    r = await w["call"]("PATCH", f"{B}/{ad}", "asha", json={"assignees": [s["out"]]})
    assert r.status_code == 403
    assert len(await bells(w, "lead")) == 1, "the leader hears about the new ad"
