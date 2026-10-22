"""
Ad Reports — "Landing page views" (2026-10-20).

An optional extra like Impressions / Reach / Link clicks. When an ad tracks it,
each day's numbers include it, and "Per landing page view" (amount spent ÷
landing page views) is calculated — total ÷ total, over only the days that
recorded both, exactly like CPC.
"""
import pytest

from app.services import ad_report_service as ar
from tests.test_ad_reports import B, make, make_account, put, rid_of, world  # noqa: F401

LPV = "landing_page_views"


async def series(w, rid, lo="2026-10-10", hi="2026-10-13"):
    r = await w["call"]("GET", f"{B}/{rid}/series?from={lo}&to={hi}", "lead")
    assert r.status_code == 200, r.text
    return r.json()["data"]


def test_the_maths():
    t = ar.computed({"spend": 50000, LPV: 200})
    assert t["cplpv"] == 250, "₹500 over 200 views = ₹2.50 a view (paise)"
    assert ar.computed({"spend": 50000})["cplpv"] is None
    assert ar.computed({"spend": 50000, LPV: 0})["cplpv"] is None, "no division by zero"
    assert ar.EXTRA_METRICS.index(LPV) == ar.EXTRA_METRICS.index("clicks") + 1, "shown after Link clicks"


async def test_create_and_track(world):
    w = world
    r = await make(w, extra_metrics=[LPV])
    assert r.status_code == 201, r.text
    d = r.json()["data"]
    assert d["metrics"] == ["leads", "spend", LPV] and d["extra_metrics"] == [LPV]
    both = (await make(w, name="All", extra_metrics=[LPV, "clicks", "impressions", "reach"])).json()["data"]
    assert both["metrics"] == ["leads", "spend", "impressions", "reach", "clicks", LPV], "Meta's order, whatever was sent"
    assert (await make(w, name="Typo", extra_metrics=["landing_page_view"])).status_code == 422


async def test_entry_rules(world):
    w = world
    rid = await rid_of(w, extra_metrics=[LPV])
    assert (await put(w, rid, "2026-10-10")).status_code == 422, "required once tracked"
    assert (await put(w, rid, "2026-10-10", landing_page_views=-1)).status_code == 422
    assert (await put(w, rid, "2026-10-10", landing_page_views=10_000_000_001)).status_code == 422
    r = await put(w, rid, "2026-10-10", landing_page_views=120)
    assert r.status_code == 201 and r.json()["data"]["entry"]["values"][LPV] == 120
    off = await w["call"]("PUT", f"{B}/{rid}/entries/2026-10-11", "asha", json={"campaign_off": True})
    assert off.json()["data"]["entry"]["values"] == {"leads": 0, "spend": 0, LPV: 0}
    plain = await rid_of(w, name="Plain")
    r = await put(w, plain, "2026-10-10", landing_page_views=99)
    assert r.status_code == 201 and LPV not in r.json()["data"]["entry"]["values"], "ignored when not tracked"


async def test_never_more_than_impressions_but_may_exceed_link_clicks(world):
    w = world
    rid = await rid_of(w, extra_metrics=["impressions", "clicks", LPV])
    bad = await put(w, rid, "2026-10-10", impressions=100, clicks=10, landing_page_views=101)
    assert bad.status_code == 422 and "Landing page views" in bad.json()["message"]
    # Meta counts them separately (a view can be attributed without a counted link click),
    # so more views than clicks is unusual but allowed.
    assert (await put(w, rid, "2026-10-10", impressions=100, clicks=10, landing_page_views=12)).status_code == 201
    solo = await rid_of(w, name="Solo", extra_metrics=[LPV])
    assert (await put(w, solo, "2026-10-10", landing_page_views=5_000)).status_code == 201, "no impressions to compare"


async def test_totals_and_cost_per_view(world):
    w = world
    rid = await rid_of(w, extra_metrics=[LPV])
    await put(w, rid, "2026-10-10", spend="300", landing_page_views=100)
    await put(w, rid, "2026-10-11", spend="200", landing_page_views=300)
    d = await series(w, rid)
    assert d["metrics"] == ["leads", "spend", LPV]
    assert d["totals"][LPV] == 400
    assert d["totals"]["cplpv"] == 125, "₹500 ÷ 400 views = ₹1.25 (total ÷ total, not the average of ₹3 and ₹0.67)"
    pts = {p["key"]: p for p in d["points"]}
    assert pts["2026-10-10"]["values"]["cplpv"] == 300 and pts["2026-10-11"]["values"][LPV] == 300
    wk = (await w["call"]("GET", f"{B}/{rid}/series?from=2026-10-05&to=2026-10-18&granularity=week", "lead")).json()["data"]
    assert wk["points"][0]["values"][LPV] == 400


async def test_switched_on_midway_uses_only_days_with_views(world):
    w = world
    rid = await rid_of(w)
    await put(w, rid, "2026-10-10", spend="900")                         # before it was tracked
    r = await w["call"]("PATCH", f"{B}/{rid}", "lead", json={"extra_metrics": [LPV]})
    assert r.status_code == 200 and LPV in r.json()["data"]["metrics"]
    await put(w, rid, "2026-10-11", spend="100", landing_page_views=50)
    d = await series(w, rid)
    assert d["totals"]["spend"] == 100000 and d["totals"][LPV] == 50
    assert d["totals"]["cplpv"] == 200, "₹100 ÷ 50 — the ₹900 day had no views and is left out"
    one = (await w["call"]("GET", f"{B}/{rid}/entries?from=2026-10-10&to=2026-10-11", "lead")).json()["data"]
    assert LPV not in {e["date"]: e for e in one}["2026-10-10"]["values"], "old days are never rewritten"


async def test_account_adds_up_views_from_the_ads_that_track_them(world):
    w, s = world, world["s"]
    acc = (await make_account(w)).json()["data"]["id"]
    a = await rid_of(w, name="With views", account_id=acc, extra_metrics=[LPV])
    b = await rid_of(w, name="Without", account_id=acc, assignees=[s["mira"]], extra_metrics=["clicks"])
    await put(w, a, "2026-10-10", spend="400", landing_page_views=200)
    await put(w, b, "2026-10-10", who="mira", spend="600", clicks=30)
    d = await series(w, acc, hi="2026-10-10")
    assert d["metrics"] == ["leads", "spend", "clicks", LPV], "union, in Meta's order"
    assert d["totals"][LPV] == 200 and d["totals"]["spend"] == 100000
    assert d["totals"]["cplpv"] == 200, "₹400 ÷ 200 — only the ad that tracks views"
    br = {x["name"]: x for x in d["breakdown"]}
    assert br["With views"]["totals"][LPV] == 200 and br["Without"]["totals"].get(LPV) is None


async def test_older_clients_keep_working(world):
    w = world
    rid = await rid_of(w, extra_metrics=["clicks"])
    r = await put(w, rid, "2026-10-10", clicks=10)                      # no landing_page_views key at all
    assert r.status_code == 201 and r.json()["data"]["entry"]["values"] == {"leads": 10, "spend": 100000, "clicks": 10}


@pytest.mark.parametrize("who,code", [("asha", 403), ("lead", 200), ("sa", 200), ("out", 404)])
async def test_who_can_turn_it_on(world, who, code):
    w = world
    rid = await rid_of(w)
    r = await w["call"]("PATCH", f"{B}/{rid}", who, json={"extra_metrics": [LPV]})
    assert r.status_code == code, (who, r.status_code)
