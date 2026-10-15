"""
Ad Reports — the people who look after an ad account run the ads inside it (2026-10-14).

An account's people ("Looked after by", e.g. an employee) may now add ads to
that account and run them — edit, pause / resume, end, delete (with undo),
remind, remove creatives. What stays with the team leader: the account itself
(edit, end, delete, its people), an ad's teams, moving an ad between accounts,
and correcting numbers older than OWNER_EDIT_DAYS.

World (from test_ad_reports): team Media = lead (leader), asha, mira; team
Other = lead2; "out" belongs to no team; sa is Super Admin. mira looks after the
Media account; asha only updates ads.
"""
from datetime import timedelta

from bson import ObjectId

from app.services import ad_report_service as ar
from tests.test_ad_reports import B, START, WED, make, make_account, put, rid_of, world  # noqa: F401

pytest_plugins = []


async def keeper_world(w):
    s = w["s"]
    acc = (await make_account(w, assignees=[s["mira"]])).json()["data"]["id"]
    return acc


async def add_ad(w, acc, who="mira", **kw):
    body = {"name": "Keeper's ad", "team_id": w["t1"], "assignees": [w["s"]["mira"]],
            "start_date": START, "account_id": acc, **kw}
    return await w["call"]("POST", B, who, json=body)


async def get(w, rid, who):
    return (await w["call"]("GET", f"{B}/{rid}", who)).json()["data"]


# ── Adding ads ───────────────────────────────────────────────────────────────

async def test_who_sees_add_ad_on_an_account(world):
    w = world
    acc = await keeper_world(w)
    assert (await get(w, acc, "lead"))["can_add_ads"] is True, "the team leader"
    assert (await get(w, acc, "mira"))["can_add_ads"] is True, "the person who looks after it"
    assert (await get(w, acc, "sa"))["can_add_ads"] is True, "admins"
    # asha is in the team but doesn't look after the account → she doesn't see it at all.
    assert (await w["call"]("GET", f"{B}/{acc}", "asha")).status_code == 404
    await w["call"]("PATCH", f"{B}/{acc}", "lead", json={"action": "end"})
    assert (await get(w, acc, "mira"))["can_add_ads"] is False, "not on an ended account"


async def test_the_keeper_adds_an_ad_to_her_account(world):
    w, s = world, world["s"]
    acc = await keeper_world(w)
    r = await add_ad(w, acc, assignees=[s["mira"], s["asha"]], extra_metrics=["clicks"])
    assert r.status_code == 201, r.text
    d = r.json()["data"]
    assert d["account_id"] == acc and d["team_ids"] == [w["t1"]] and d["created_by"] == s["mira"]
    assert [a["id"] for a in d["assignees"]] == [s["mira"], s["asha"]]
    assert d["can_run"] is True and d["can_manage"] is False and d["can_enter"] is True
    acc_now = await get(w, acc, "lead")
    assert acc_now["account"]["ads"] == 1, "it adds up in the account"
    assert d["id"] in {x["id"] for x in (await w["call"]("GET", B, "lead")).json()["data"]}, "the leader sees it"


async def test_what_a_keeper_cannot_create(world):
    w, s = world, world["s"]
    acc = await keeper_world(w)
    other_acc = (await make_account(w, name="Not hers")).json()["data"]["id"]
    r = await w["call"]("POST", B, "mira", json={"name": "Loose ad", "team_id": w["t1"],
                                                  "assignees": [s["asha"]], "start_date": START})
    assert r.status_code == 403, "outside an account only for herself (self-service, 2026-10-15)"
    assert (await add_ad(w, other_acc)).status_code == 403, "not in an account she doesn't look after"
    assert (await add_ad(w, acc, team_ids=[w["t1"], w["t2"]])).status_code == 403, "not into other teams"
    assert (await add_ad(w, acc, team_id=w["t2"])).status_code == 403
    r = await add_ad(w, acc, assignees=[s["out"]])
    assert r.status_code == 403 and "account's teams" in r.json()["message"], "only people from the account's teams"
    assert (await add_ad(w, acc, assignees=[s["lead2"]])).status_code == 403
    assert (await w["call"]("POST", B, "mira", json={"kind": "account", "name": "Mine", "team_id": w["t2"]})).status_code == 403, \
        "not an account in a team she isn't in"
    assert (await add_ad(w, acc, who="asha")).status_code == 403, "a team member who doesn't look after it can't"
    await w["call"]("PATCH", f"{B}/{acc}", "lead", json={"action": "end"})
    assert (await add_ad(w, acc)).status_code == 422, "not into an ended account"


# ── Running the ads in her account ───────────────────────────────────────────

async def test_the_keeper_runs_every_ad_in_her_account(world):
    w, s = world, world["s"]
    acc = await keeper_world(w)
    ad = await rid_of(w, account_id=acc, assignees=[s["asha"]])        # made by the leader
    call = w["call"]
    d = await get(w, ad, "mira")
    assert d["can_run"] and not d["can_manage"]
    r = await call("PATCH", f"{B}/{ad}", "mira", json={
        "name": "Renamed by keeper", "assignees": [s["asha"], s["mira"]], "extra_metrics": ["reach"],
        "reminder_due": "11:00", "reminder_escalate": "16:00", "end_date": "2026-12-31", "team_ids": [w["t1"]]})
    assert r.status_code == 200, r.text
    d = r.json()["data"]
    assert d["name"] == "Renamed by keeper" and d["extra_metrics"] == ["reach"] and d["end_date"] == "2026-12-31"
    assert (await call("PATCH", f"{B}/{ad}", "mira", json={"action": "pause"})).json()["data"]["status"] == "paused"
    assert (await call("PATCH", f"{B}/{ad}", "mira", json={"action": "resume"})).json()["data"]["status"] == "active"
    assert (await call("POST", f"{B}/{ad}/remind", "mira")).status_code == 200, "numbers are missing → reminder"
    assert (await call("PATCH", f"{B}/{ad}", "mira", json={"action": "end"})).json()["data"]["status"] == "ended"


async def test_the_keeper_deletes_an_ad_and_undoes_it(world):
    w = world
    acc = await keeper_world(w)
    ad = (await add_ad(w, acc)).json()["data"]["id"]
    assert (await put(w, ad, "2026-10-12", who="mira")).status_code == 201
    r = await w["call"]("DELETE", f"{B}/{ad}", "mira")
    assert r.status_code == 200, r.text
    assert (await w["call"]("GET", f"{B}/{ad}", "lead")).status_code == 404
    batch = r.json()["data"]["batch"]
    assert (await w["call"]("POST", f"{B}/deleted/{batch}/restore", "mira")).status_code == 200
    d = await get(w, ad, "mira")
    assert d["account_id"] == acc and "2026-10-12" not in d["missing"], "back with its numbers, in its account"


async def test_what_stays_with_the_team_leader(world):
    w, s = world, world["s"]
    acc = await keeper_world(w)
    acc2 = (await make_account(w, name="Second", assignees=[s["mira"]])).json()["data"]["id"]
    ad = await rid_of(w, account_id=acc, assignees=[s["mira"]])       # made by the leader
    own_ad = (await add_ad(w, acc)).json()["data"]["id"]                # made by mira herself
    call = w["call"]
    # The account itself.
    for body in ({"name": "x"}, {"assignees": [s["mira"], s["asha"]]}, {"ad_account_ref": "act_1"}, {"action": "end"}):
        assert (await call("PATCH", f"{B}/{acc}", "mira", json=body)).status_code == 403, body
    assert (await call("DELETE", f"{B}/{acc}", "mira")).status_code == 403
    # An ad's teams and its account — even into another account she looks after.
    assert (await call("PATCH", f"{B}/{ad}", "mira", json={"team_ids": [w["t1"], w["t2"]]})).status_code == 403
    assert (await call("PATCH", f"{B}/{ad}", "mira", json={"clear_account": True})).status_code == 403
    assert (await call("PATCH", f"{B}/{ad}", "mira", json={"account_id": acc2})).status_code == 403
    # People from outside the account's teams.
    r = await call("PATCH", f"{B}/{ad}", "mira", json={"assignees": [s["out"]]})
    assert r.status_code == 403
    # …but an ad she made herself is hers (self-service, 2026-10-15): she may move it
    # between accounts she looks after, or take it out.
    assert (await call("PATCH", f"{B}/{own_ad}", "mira", json={"account_id": acc2})).status_code == 200
    assert (await call("PATCH", f"{B}/{own_ad}", "mira", json={"clear_account": True})).status_code == 200
    assert (await call("PATCH", f"{B}/{own_ad}", "mira", json={"team_ids": [w["t1"], w["t2"]]})).status_code == 403,         "still only her own teams"
    # Numbers older than OWNER_EDIT_DAYS.
    assert (await put(w, ad, "2026-10-12", who="mira")).status_code == 201
    w["clock"].today = WED + timedelta(days=ar.OWNER_EDIT_DAYS + 2)
    r = await put(w, ad, "2026-10-12", who="mira", leads=11)
    assert r.status_code == 403, "corrections of old numbers stay with the leader"
    assert (await put(w, ad, "2026-10-12", who="lead", leads=11)).status_code == 200


async def test_a_person_the_leader_already_chose_from_elsewhere_can_stay(world):
    """The leader put someone from outside the teams on it; the keeper's edit keeps them."""
    w, s = world, world["s"]
    acc = await keeper_world(w)
    ad = await rid_of(w, account_id=acc, assignees=[s["out"]])
    r = await w["call"]("PATCH", f"{B}/{ad}", "mira", json={"name": "Kept", "assignees": [s["out"], s["mira"]]})
    assert r.status_code == 200, r.text


async def test_others_still_cannot_run_ads(world):
    w, s = world, world["s"]
    acc = await keeper_world(w)
    ad = (await add_ad(w, acc, assignees=[s["asha"]])).json()["data"]["id"]
    loose = await rid_of(w, assignees=[s["mira"]])                     # not in her account
    call = w["call"]
    # asha updates the ad but doesn't look after the account.
    d = await get(w, ad, "asha")
    assert d["can_enter"] and not d["can_run"]
    for body in ({"name": "x"}, {"action": "pause"}):
        assert (await call("PATCH", f"{B}/{ad}", "asha", json=body)).status_code == 403
    assert (await call("DELETE", f"{B}/{ad}", "asha")).status_code == 403
    assert (await call("POST", f"{B}/{ad}/remind", "asha")).status_code == 403
    # mira on an ad outside her account is only its updater.
    d = await get(w, loose, "mira")
    assert d["can_enter"] and not d["can_run"]
    assert (await call("PATCH", f"{B}/{loose}", "mira", json={"action": "pause"})).status_code == 403
    assert (await call("DELETE", f"{B}/{loose}", "mira")).status_code == 403
    # Another team's leader and a stranger don't even see it.
    for who in ("lead2", "out"):
        assert (await call("PATCH", f"{B}/{ad}", who, json={"name": "x"})).status_code == 404, who


async def test_taking_her_off_the_account_takes_the_rights_away(world):
    w, s = world, world["s"]
    acc = await keeper_world(w)
    ad = (await add_ad(w, acc, assignees=[s["asha"]])).json()["data"]["id"]
    await w["call"]("PATCH", f"{B}/{acc}", "lead", json={"assignees": [s["asha"]]})
    assert (await w["call"]("GET", f"{B}/{ad}", "mira")).status_code == 404
    assert (await w["call"]("PATCH", f"{B}/{ad}", "mira", json={"action": "pause"})).status_code == 404
    assert (await add_ad(w, acc)).status_code == 403
    # asha looks after it now.
    assert (await get(w, ad, "asha"))["can_run"] is True


async def test_creatives_in_her_account(world):
    w, s = world, world["s"]
    acc = await keeper_world(w)
    ad = await rid_of(w, account_id=acc, assignees=[s["asha"]])
    item = {"id": "c1", "url": "https://x/y.png", "kind": "image", "uploaded_by": s["asha"]}
    await w["db"][ar.REPORTS].update_one({"_id": ObjectId(ad)}, {"$push": {"creatives": item}})
    r = await w["call"]("DELETE", f"{B}/{ad}/creatives/c1", "mira")
    assert r.status_code == 200, "she may remove someone else's creative on an ad she runs"
