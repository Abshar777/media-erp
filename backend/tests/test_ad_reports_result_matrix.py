"""
An ad's Result (leads / landing page views) — the QA pass (2026-10-22).

1. Role matrix: every role switching the result, and typing on a traffic ad,
   for three kinds of ad. Refused attempts change nothing.
2. Create fuzz: random result + extras (duplicates, the result itself, unknown
   names) — stored set-up is always clean, metrics always in Meta's order.
3. Model-based: random campaigns that switch result and extras mid-way while
   days are typed, corrected and marked "didn't run" — what each day asks for,
   what is stored, totals, every ratio, the card's trend, and an account
   mixing traffic and lead ads (its result, metrics and breakdown).
4. Flags: the frozen snapshot keeps its wording when the ad changes later; an
   older flag (no result in its snapshot) reads as leads.
"""
import random
from datetime import date, timedelta

import pytest
from bson import ObjectId

from app.services import ad_flag_service as fl
from app.services import ad_report_service as ar
from tests.test_ad_reports_lpv_matrix import calc
from tests.test_ad_reports_selfserve_matrix import B, ELEVATED, ROLE, org  # noqa: F401
from tests.test_ad_reports_sundays_matrix import three_ads

LPV = "landing_page_views"
ORDER = ["impressions", "reach", "clicks", LPV, "leads"]
RUNS = {"leader": {"lead"} | ELEVATED, "own": {"asha", "lead"} | ELEVATED, "kept": {"mira", "lead"} | ELEVATED}
ENTERS = {k: v | {"asha"} for k, v in RUNS.items()}


def model_metrics(result, extras):
    return [result, "spend"] + [m for m in ORDER if m in set(extras) and m != result]


# ── 1. Role matrix ───────────────────────────────────────────────────────────

@pytest.mark.parametrize("which", ["leader", "own", "kept"])
@pytest.mark.parametrize("role", list(ROLE))
async def test_who_can_switch_the_result_and_type_views(org, role, which):
    o, c = org, org["call"]
    rid = (await three_ads(o))[which]
    before = await o["db"][ar.REPORTS].find_one({"_id": ObjectId(rid)})
    r = await c("PATCH", f"{B}/{rid}", role, json={"result_metric": LPV})
    if role in RUNS[which]:
        assert r.status_code == 200 and r.json()["data"]["metrics"][0] == LPV, (role, which, r.text[:150])
    else:
        assert r.status_code in (403, 404), (role, which, r.status_code)
        assert await o["db"][ar.REPORTS].find_one({"_id": ObjectId(rid)}) == before
        await c("PATCH", f"{B}/{rid}", "lead", json={"result_metric": LPV})
    r = await c("PUT", f"{B}/{rid}/entries/2026-10-12", role, json={LPV: 25, "spend": "75"})
    rows = await o["db"][ar.ENTRIES].find({"report_id": rid}).to_list(5)
    if role in ENTERS[which]:
        assert r.status_code == 201, (role, which, r.text[:150])
        assert rows[0]["values"] == {LPV: 25, "spend": 7500}
    else:
        assert r.status_code in (403, 404), (role, which, r.status_code)
        assert rows == []


# ── 2. Create fuzz ───────────────────────────────────────────────────────────

@pytest.mark.parametrize("seed", range(3))
async def test_fuzzed_set_ups_are_stored_clean(org, seed):
    rnd = random.Random(seed)
    o, c = org, org["call"]
    for i in range(30):
        result = rnd.choice(["leads", LPV, None, "clicks", ""])
        extras = [rnd.choice(ORDER + ["bogus"]) for _ in range(rnd.randint(0, 6))]
        body = {"name": f"Z{i}", "team_ids": [o["T"]["T1"]], "start_date": "2026-10-05",
                "assignees": [o["s"]["asha"]], "extra_metrics": extras}
        if result is not None:
            body["result_metric"] = result
        r = await c("POST", B, "lead", json=body)
        if result in ("clicks", "") or "bogus" in extras:
            assert r.status_code == 422, (seed, i, body)
            continue
        assert r.status_code == 201, (seed, i, body, r.text[:150])
        res = result or "leads"
        d = r.json()["data"]
        assert d["result_metric"] == res and d["metrics"] == model_metrics(res, extras), (seed, i, d["metrics"])
        doc = await o["db"][ar.REPORTS].find_one({"_id": ObjectId(d["id"])})
        assert res not in doc["extra_metrics"] and len(doc["extra_metrics"]) == len(set(doc["extra_metrics"]))


# ── 3. Model-based ───────────────────────────────────────────────────────────

@pytest.mark.parametrize("seed", range(20))
async def test_random_campaigns_switching_result(org, seed):
    rnd = random.Random(4200 + seed)
    o, c, db = org, org["call"], org["db"]
    t1 = o["T"]["T1"]
    acc = (await c("POST", B, "lead", json={"kind": "account", "name": "Acc", "team_ids": [t1]})).json()["data"]["id"]
    ads, setup, stored = [], {}, {}
    for i in range(2):
        res = rnd.choice(["leads", LPV])
        extras = [m for m in ORDER if rnd.random() < 0.4]
        rid = (await c("POST", B, "lead", json={"name": f"Ad {i}", "team_ids": [t1], "start_date": "2026-09-01",
                                               "account_id": acc, "assignees": [o["s"]["asha"]],
                                               "result_metric": res, "extra_metrics": extras})).json()["data"]["id"]
        ads.append(rid)
        setup[rid] = [res, [m for m in extras if m != res]]
        stored[rid] = {}
    for step in range(35):
        rid = rnd.choice(ads)
        res, extras = setup[rid]
        metrics = model_metrics(res, extras)
        roll = rnd.random()
        if roll < 0.15:                                             # switch the result (sometimes extras too)
            new = LPV if res == "leads" else "leads"
            body = {"result_metric": new}
            if rnd.random() < 0.5:
                body["extra_metrics"] = [m for m in ORDER if rnd.random() < 0.4]
            r = await c("PATCH", f"{B}/{rid}", "lead", json=body)
            assert r.status_code == 200, r.text
            new_extras = body.get("extra_metrics", extras)
            setup[rid] = [new, [m for m in dict.fromkeys(new_extras) if m != new]]
            assert r.json()["data"]["metrics"] == model_metrics(*setup[rid]), (seed, step)
            continue
        if roll < 0.25:                                             # extras only
            ex = [m for m in ORDER if rnd.random() < 0.4]
            r = await c("PATCH", f"{B}/{rid}", "lead", json={"extra_metrics": ex})
            setup[rid] = [res, [m for m in dict.fromkeys(ex) if m != res]]
            assert r.json()["data"]["metrics"] == model_metrics(*setup[rid])
            continue
        d = date(2026, 9, 1) + timedelta(days=rnd.randint(0, 40))
        if rnd.random() < 0.1:
            body, vals = {"campaign_off": True}, {m: 0 for m in metrics}
        else:
            imp = rnd.randint(500, 50000)
            gen = {"leads": rnd.randint(0, 60), "spend": rnd.randint(0, 900000), "impressions": imp,
                   "reach": rnd.randint(0, imp), "clicks": rnd.randint(0, imp // 20), LPV: rnd.randint(0, imp // 25)}
            vals = {m: gen[m] for m in metrics}
            body = {m: (f"{v // 100}.{v % 100:02d}" if m == "spend" else v) for m, v in vals.items()}
            body["campaign_off"] = False
            if rnd.random() < 0.3:                                  # the wrong result sent along: ignored
                wrong = "leads" if res == LPV else LPV
                if wrong not in metrics:
                    body[wrong] = 999
            if rnd.random() < 0.1:                                  # the result left out: refused
                body.pop(res)
                r = await c("PUT", f"{B}/{rid}/entries/{d.isoformat()}", "lead", json=body)
                assert r.status_code == 422, (seed, step, "result missing")
                continue
        r = await c("PUT", f"{B}/{rid}/entries/{d.isoformat()}", "lead", json=body)
        assert r.status_code in (200, 201), (seed, step, r.text[:200])
        assert r.json()["data"]["entry"]["values"] == vals, (seed, step, r.json()["data"]["entry"]["values"], vals)
        stored[rid][d.isoformat()] = vals

    lo, hi = "2026-09-01", "2026-10-11"
    for rid in ads:
        metrics = model_metrics(*setup[rid])
        s = (await c("GET", f"{B}/{rid}/series?from={lo}&to={hi}", "lead")).json()["data"]
        assert s["metrics"] == metrics
        want = calc(list(stored[rid].values()), metrics)
        for k, v in want.items():
            assert s["totals"].get(k) == v, (seed, rid[-4:], k, s["totals"].get(k), v)
        one = (await c("GET", f"{B}/{rid}", "lead")).json()["data"]
        assert one["result_metric"] == setup[rid][0]
        today = date(2026, 10, 14)
        spark_days = [(today - timedelta(days=14) + timedelta(days=i)).isoformat() for i in range(14)]
        assert one["sparkline"] == [stored[rid].get(dd, {}).get(setup[rid][0]) for dd in spark_days], \
            (seed, "the card's trend is the current result")
    a = (await c("GET", f"{B}/{acc}", "lead")).json()["data"]
    want_res = LPV if all(setup[x][0] == LPV for x in ads) else "leads"
    tracked = {m for x in ads for m in model_metrics(*setup[x])}
    assert a["result_metric"] == want_res and a["metrics"] == [want_res, "spend"] + [m for m in ORDER if m in tracked and m != want_res]
    s = (await c("GET", f"{B}/{acc}/series?from={lo}&to={hi}", "lead")).json()["data"]
    want = calc([v for x in ads for v in stored[x].values()], a["metrics"])
    for k, v in want.items():
        assert s["totals"].get(k) == v, (seed, "account", k)
    assert {b["id"]: b["result_metric"] for b in s["breakdown"]} == {x: setup[x][0] for x in ads}


# ── 4. Flags keep their wording ──────────────────────────────────────────────

async def test_flag_wording_is_frozen_with_its_snapshot(org):
    o, c, db = org, org["call"], org["db"]
    rid = (await three_ads(o))["leader"]
    await c("PATCH", f"{B}/{rid}", "lead", json={"result_metric": LPV})
    for k in range(1, 8):
        await c("PUT", f"{B}/{rid}/entries/{(date(2026, 10, 14) - timedelta(days=k)).isoformat()}", "asha",
                json={LPV: 10, "spend": "50"})
    draft = (await c("GET", f"/api/v1/ad-reports/{rid}/flag-draft", "asha")).json()["data"]
    assert draft["snapshot"]["result"] == LPV
    to = next(t for t in draft["recipients"] for l in t["leaders"] if l["name"] == "Kofi")
    r = await c("POST", f"/api/v1/ad-reports/{rid}/flags", "asha",
                json={"recipient_id": o["s"]["kofi"], "recipient_team_id": to["team_id"], "reasons": ["high_cpl"], "note": ""})
    assert r.status_code == 201, r.text
    fid = r.json()["data"]["id"]
    await c("PATCH", f"{B}/{rid}", "lead", json={"result_metric": "leads"})       # the ad changes afterwards
    got = (await c("GET", f"/api/v1/ad-flags/{fid}", "kofi")).json()["data"]
    assert got["reasons"] == [{"key": "high_cpl", "label": "High cost per landing page view"}], "as it was when flagged"
    await db[fl.FLAGS].update_one({"_id": ObjectId(fid)}, {"$unset": {"snapshot.result": ""}})   # an older flag
    got = (await c("GET", f"/api/v1/ad-flags/{fid}", "kofi")).json()["data"]
    assert got["reasons"][0]["label"] == "High cost per lead"
