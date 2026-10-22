"""
Ad Reports — an ad's Result: leads or landing page views (2026-10-22).

A traffic campaign's result is landing page views, not form leads. The result
comes first, is always typed, and its cost ("per lead" / "per landing page
view") is the second number; the other result can still be tracked as an
extra. Older ads (no field) are lead ads — nothing changes for them.
"""
from bson import ObjectId

from app.services import ad_flag_service as fl
from app.services import ad_report_service as ar
from tests.test_ad_flags import body as flag_body, w  # noqa: F401
from tests.test_ad_reports import B, make, make_account, put, rid_of, world  # noqa: F401

LPV = "landing_page_views"


async def one(w_, rid, who="lead"):
    return (await w_["call"]("GET", f"{B}/{rid}", who)).json()["data"]


async def series(w_, rid, lo="2026-10-10", hi="2026-10-13"):
    return (await w_["call"]("GET", f"{B}/{rid}/series?from={lo}&to={hi}", "lead")).json()["data"]


# ── Pure rules ───────────────────────────────────────────────────────────────

def test_result_and_metric_order():
    assert ar.result_of({}) == "leads", "older ads are lead ads"
    assert ar.result_of({"result_metric": "nonsense"}) == "leads"
    assert ar.metrics_of({"extra_metrics": ["clicks", LPV]}) == ["leads", "spend", "clicks", LPV]
    traffic = {"result_metric": LPV, "extra_metrics": ["leads", "reach", LPV]}
    assert ar.metrics_of(traffic) == [LPV, "spend", "reach", "leads"], "result first, never twice, leads last"
    kids = [{"result_metric": LPV, "extra_metrics": []}, {"result_metric": LPV, "extra_metrics": ["clicks"]}]
    assert ar.union_metrics(kids) == [LPV, "spend", "clicks"], "an account of traffic ads is after views"
    mixed = kids + [{"extra_metrics": []}]
    assert ar.union_metrics(mixed) == ["leads", "spend", "clicks", LPV], "any lead ad: the account leads with leads"
    assert ar.union_metrics([]) == ["leads", "spend"]


# ── Creating and typing ──────────────────────────────────────────────────────

async def test_lead_ads_are_unchanged(world):
    w_ = world
    d = (await make(w_)).json()["data"]
    assert d["result_metric"] == "leads" and d["metrics"] == ["leads", "spend"]
    rid = d["id"]
    await w_["db"][ar.REPORTS].update_one({"_id": ObjectId(rid)}, {"$unset": {"result_metric": ""}})   # made before this
    assert (await one(w_, rid))["result_metric"] == "leads"
    assert (await put(w_, rid, "2026-10-10")).status_code == 201


async def test_traffic_ad_types_views_not_leads(world):
    w_ = world
    r = await make(w_, result_metric=LPV, extra_metrics=[LPV, "impressions", "reach"])
    assert r.status_code == 201, r.text
    d = r.json()["data"]
    assert d["result_metric"] == LPV and d["metrics"] == [LPV, "spend", "impressions", "reach"]
    doc = await w_["db"][ar.REPORTS].find_one({"_id": ObjectId(d["id"])})
    assert doc["extra_metrics"] == ["impressions", "reach"], "the result is never stored as an extra too"
    rid = d["id"]
    no_views = await w_["call"]("PUT", f"{B}/{rid}/entries/2026-10-10", "asha",
                                json={"leads": 33, "spend": "1515", "impressions": 5000, "reach": 4000})
    assert no_views.status_code == 422 and "Landing page views" in no_views.json()["message"]
    ok = await w_["call"]("PUT", f"{B}/{rid}/entries/2026-10-10", "asha",
                          json={LPV: 33, "spend": "1515", "impressions": 5000, "reach": 4000})
    assert ok.status_code == 201
    assert ok.json()["data"]["entry"]["values"] == {LPV: 33, "spend": 151500, "impressions": 5000, "reach": 4000}, \
        "no leads asked for or kept"
    s = await series(w_, rid)
    assert s["metrics"][0] == LPV and s["totals"][LPV] == 33
    assert s["totals"]["cplpv"] == round(151500 / 33, 4), "cost per view = the cost per result"
    off = await w_["call"]("PUT", f"{B}/{rid}/entries/2026-10-11", "asha", json={"campaign_off": True})
    assert off.json()["data"]["entry"]["values"] == {LPV: 0, "spend": 0, "impressions": 0, "reach": 0}


async def test_traffic_ad_can_still_count_form_leads(world):
    w_ = world
    rid = (await make(w_, result_metric=LPV, extra_metrics=["leads"])).json()["data"]["id"]
    assert (await one(w_, rid))["metrics"] == [LPV, "spend", "leads"]
    assert (await put(w_, rid, "2026-10-10", **{LPV: 200}, leads=4, spend="400")).status_code == 201
    t = (await series(w_, rid))["totals"]
    assert t["cplpv"] == 200 and t["cpl"] == 10000, "₹2 a view, ₹100 a lead"


async def test_bad_values(world):
    w_ = world
    assert (await make(w_, result_metric="clicks")).status_code == 422
    assert (await make(w_, result_metric="")).status_code == 422
    assert (await make(w_, extra_metrics=["leads"])).json()["data"]["metrics"] == ["leads", "spend"], \
        "leads as an extra of a lead ad is just the result"


# ── Changing the result ──────────────────────────────────────────────────────

async def test_switch_a_lead_ad_to_views(world):
    w_ = world
    rid = await rid_of(w_, extra_metrics=[LPV, "clicks"])
    await put(w_, rid, "2026-10-10", leads=33, spend="1515", clicks=40, **{LPV: 30})
    r = await w_["call"]("PATCH", f"{B}/{rid}", "lead", json={"result_metric": LPV})
    assert r.status_code == 200, r.text
    d = r.json()["data"]
    assert d["result_metric"] == LPV and d["metrics"] == [LPV, "spend", "clicks"], "views move to the top"
    doc = await w_["db"][ar.REPORTS].find_one({"_id": ObjectId(rid)})
    assert doc["extra_metrics"] == ["clicks"]
    row = await w_["db"][ar.ENTRIES].find_one({"report_id": rid, "date": "2026-10-10"})
    assert row["values"]["leads"] == 33, "days already typed are never rewritten"
    assert (await put(w_, rid, "2026-10-11", clicks=5, **{LPV: 3})).status_code == 201, "leads no longer asked"
    assert (await one(w_, rid))["sparkline"][-4] == 30, "the card's trend follows views"
    back = await w_["call"]("PATCH", f"{B}/{rid}", "lead", json={"result_metric": "leads", "extra_metrics": [LPV, "clicks"]})
    assert back.json()["data"]["metrics"] == ["leads", "spend", "clicks", LPV]


async def test_patching_extras_never_duplicates_the_result(world):
    w_ = world
    rid = (await make(w_, result_metric=LPV)).json()["data"]["id"]
    r = await w_["call"]("PATCH", f"{B}/{rid}", "lead", json={"extra_metrics": [LPV, "reach"]})
    assert r.json()["data"]["metrics"] == [LPV, "spend", "reach"]


async def test_switch_rules(world):
    w_ = world
    rid = await rid_of(w_)
    assert (await w_["call"]("PATCH", f"{B}/{rid}", "asha", json={"result_metric": LPV})).status_code == 403
    assert (await w_["call"]("PATCH", f"{B}/{rid}", "out", json={"result_metric": LPV})).status_code == 404
    assert (await w_["call"]("PATCH", f"{B}/{rid}", "lead", json={"result_metric": "leads"})).status_code == 200, "no change"
    acc = (await make_account(w_)).json()["data"]["id"]
    assert (await w_["call"]("PATCH", f"{B}/{acc}", "lead", json={"result_metric": LPV})).status_code == 422
    assert (await w_["call"]("PATCH", f"{B}/{rid}", "lead", json={"action": "end"})).status_code == 200
    assert (await w_["call"]("PATCH", f"{B}/{rid}", "lead", json={"result_metric": LPV})).status_code == 409


# ── Accounts ─────────────────────────────────────────────────────────────────

async def test_account_of_traffic_and_lead_ads(world):
    w_, s = world, world["s"]
    acc = (await make_account(w_)).json()["data"]["id"]
    t1 = await rid_of(w_, name="Traffic", account_id=acc, result_metric=LPV)
    await put(w_, t1, "2026-10-10", spend="400", **{LPV: 200})
    a = await one(w_, acc)
    assert a["result_metric"] == LPV and a["metrics"] == [LPV, "spend"], "only traffic ads: the account is after views"
    l1 = await rid_of(w_, name="Leads", account_id=acc, assignees=[s["mira"]])
    await put(w_, l1, "2026-10-10", who="mira", spend="600", leads=6)
    a = await one(w_, acc)
    assert a["result_metric"] == "leads" and a["metrics"] == ["leads", "spend", LPV]
    d = await series(w_, acc, hi="2026-10-10")
    assert d["totals"]["cpl"] == 10000 and d["totals"]["cplpv"] == 200, "each cost from its own ads"
    br = {x["name"]: x for x in d["breakdown"]}
    assert br["Traffic"]["result_metric"] == LPV and br["Leads"]["result_metric"] == "leads"


# ── "Ad not performing" ──────────────────────────────────────────────────────

async def test_flagging_a_traffic_ad_talks_about_views(w):
    db = w["db"]
    await db[ar.REPORTS].update_one({"_id": ObjectId(w["R"])}, {"$set": {"result_metric": LPV}})
    async for e in db[ar.ENTRIES].find({"report_id": w["R"]}):
        await db[ar.ENTRIES].update_one({"_id": e["_id"]}, {"$set": {f"values.{LPV}": e["values"]["leads"] * 10}})
    d = (await w["call"]("GET", f"/api/v1/ad-reports/{w['R']}/flag-draft", "asha")).json()["data"]
    labels = {x["key"]: x["label"] for x in d["reasons"]}
    assert labels["high_cpl"] == "High cost per landing page view" and labels["few_leads"] == "Too few landing page views"
    snap = d["snapshot"]
    assert snap["result"] == LPV and snap["metrics"][0] == LPV
    assert snap["totals"][LPV] == 140 and snap["totals"]["cplpv"] == 500, "₹700 over 140 views"
    assert snap["sparkline"][-1] == 20, "the trend is views"
    r = await w["call"]("POST", f"/api/v1/ad-reports/{w['R']}/flags", "asha", json=flag_body(w))
    assert r.status_code == 201, r.text
    got = {x["key"]: x["label"] for x in r.json()["data"]["reasons"]}
    assert got["high_cpl"] == "High cost per landing page view"
    import asyncio
    await asyncio.sleep(0.2)                                   # the bell is sent in the background
    bell = await db["notifications"].find_one({"type": fl.NOTIF_FLAGGED})
    assert bell and "high cost per landing page view, too few landing page views" in bell["message"], bell


async def test_lead_ad_flags_read_as_before(w):
    d = (await w["call"]("GET", f"/api/v1/ad-reports/{w['R']}/flag-draft", "asha")).json()["data"]
    labels = {x["key"]: x["label"] for x in d["reasons"]}
    assert labels["high_cpl"] == "High cost per lead" and d["snapshot"]["result"] == "leads"
