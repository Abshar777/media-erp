"""
Landing page views — the QA pass (2026-10-21).

1. Role matrix: every role turning it on, and typing it, on three kinds of ad
   (a leader's ad, an employee's own ad, an ad in an account someone looks
   after). Refused attempts change nothing.
2. Fuzz: random day entries (good and bad values) — the answer is what the rules
   say, nothing is stored on a refusal.
3. Model-based: random campaigns where extras are switched on and off mid-way,
   days are typed, corrected and marked "didn't run" — totals and every ratio
   (per lead, CTR, CPM, CPC, per landing page view) by day / week / month, for
   the ad and for an account holding two ads, compared with a plain calculator.
"""
import random
from datetime import date, timedelta

import pytest
from bson import ObjectId

from app.services import ad_report_service as ar
from tests.test_ad_reports_selfserve_matrix import B, ELEVATED, ROLE, START, org  # noqa: F401
from tests.test_ad_reports_sundays_matrix import three_ads

LPV = "landing_page_views"
EXTRAS = ["impressions", "reach", "clicks", LPV]
RUNS = {"leader": {"lead"} | ELEVATED, "own": {"asha", "lead"} | ELEVATED, "kept": {"mira", "lead"} | ELEVATED}
# Typing numbers: anyone who runs it, plus the ad's own people (asha is on all three).
ENTERS = {k: v | {"asha"} for k, v in RUNS.items()}


# ── 1. Role matrix ───────────────────────────────────────────────────────────

@pytest.mark.parametrize("which", ["leader", "own", "kept"])
@pytest.mark.parametrize("role", list(ROLE))
async def test_who_can_turn_it_on_and_type_it(org, role, which):
    o, c = org, org["call"]
    rid = (await three_ads(o))[which]
    before = await o["db"][ar.REPORTS].find_one({"_id": ObjectId(rid)})
    r = await c("PATCH", f"{B}/{rid}", role, json={"extra_metrics": [LPV]})
    if role in RUNS[which]:
        assert r.status_code == 200 and LPV in r.json()["data"]["metrics"], (role, which, r.text[:150])
    else:
        assert r.status_code in (403, 404), (role, which, r.status_code)
        assert await o["db"][ar.REPORTS].find_one({"_id": ObjectId(rid)}) == before
        await c("PATCH", f"{B}/{rid}", "lead", json={"extra_metrics": [LPV]})
    r = await c("PUT", f"{B}/{rid}/entries/2026-10-12", role, json={"leads": 2, "spend": "50", LPV: 40})
    rows = await o["db"][ar.ENTRIES].find({"report_id": rid}).to_list(5)
    if role in ENTERS[which]:
        assert r.status_code == 201, (role, which, r.text[:150])
        assert rows[0]["values"][LPV] == 40
    else:
        assert r.status_code in (403, 404), (role, which, r.status_code)
        assert rows == []


# ── 2. Fuzz the day's numbers ────────────────────────────────────────────────

def expected(metrics, body):
    """(ok, values) by the written rules."""
    if body.get("campaign_off"):
        return True, {m: 0 for m in metrics}
    out = {}
    for m in metrics:
        v = body.get(m)
        if m == "spend":
            if v is None:
                return False, None
            out[m] = round(float(v) * 100)
            continue
        if v is None or v < 0 or v > ar.MAX_COUNT:
            return False, None
        out[m] = v
    imp = out.get("impressions")
    if imp is not None and any(out.get(k, 0) > imp for k in ("reach", "clicks", LPV)):
        return False, None
    return True, out


@pytest.mark.parametrize("seed", range(4))
async def test_fuzzed_entries_follow_the_rules(org, seed):
    rnd = random.Random(seed)
    o, c, db = org, org["call"], org["db"]
    day = date(2026, 9, 20)
    for i in range(40):
        extras = [m for m in EXTRAS if rnd.random() < 0.5]
        metrics = ["leads", "spend"] + extras
        rid = (await c("POST", B, "lead", json={"name": f"F{i}", "team_ids": [o["T"]["T1"]], "start_date": "2026-09-01",
                                               "assignees": [o["s"]["asha"]], "extra_metrics": extras})).json()["data"]["id"]
        body = {"campaign_off": rnd.random() < 0.1}
        for m in metrics:
            roll = rnd.random()
            if roll < 0.06:
                continue                                  # missing
            if m == "spend":
                body[m] = f"{rnd.randint(0, 5000)}.{rnd.randint(0, 99):02d}"
            else:
                body[m] = rnd.choice([-1, 0, ar.MAX_COUNT + 1]) if roll < 0.12 else rnd.randint(0, 3000)
        if rnd.random() < 0.3:
            body[rnd.choice([m for m in EXTRAS if m not in extras] or ["leads"])] = rnd.randint(0, 99)   # an untracked one
        ok, values = expected(metrics, body)
        r = await c("PUT", f"{B}/{rid}/entries/{day.isoformat()}", "asha", json=body)
        row = await db[ar.ENTRIES].find_one({"report_id": rid})
        if ok:
            assert r.status_code == 201, (seed, i, body, r.text[:200])
            assert row["values"] == values, (seed, i, body, row["values"], values)
        else:
            assert r.status_code == 422, (seed, i, body, r.status_code)
            assert row is None


# ── 3. Model-based maths ─────────────────────────────────────────────────────

def calc(rows, metrics):
    """Plain calculator: totals of tracked numbers; each ratio over days that recorded both parts."""
    out = {m: sum(r.get(m, 0) for r in rows) for m in metrics} if rows else {m: None for m in metrics}

    def ratio(a, b, k=1):
        both = [r for r in rows if a in r and b in r]
        num, den = sum(r[a] for r in both), sum(r[b] for r in both)
        return round(num * k / den, 4) if both and den else None
    out.update(cpl=ratio("spend", "leads"), ctr=ratio("clicks", "impressions", 100),
               cpm=ratio("spend", "impressions", 1000), cpc=ratio("spend", "clicks"), cplpv=ratio("spend", LPV))
    return out


def week_key(d: date):
    return (d - timedelta(days=d.weekday())).isoformat()


@pytest.mark.parametrize("seed", range(20))
async def test_random_campaigns_add_up(org, seed):
    rnd = random.Random(900 + seed)
    o, c = org, org["call"]
    t1 = o["T"]["T1"]
    acc = (await c("POST", B, "lead", json={"kind": "account", "name": "Acc", "team_ids": [t1]})).json()["data"]["id"]
    ads, metrics_now, stored = [], {}, {}
    for i in range(2):
        extras = [m for m in EXTRAS if rnd.random() < 0.5]
        rid = (await c("POST", B, "lead", json={"name": f"Ad {i}", "team_ids": [t1], "start_date": "2026-09-01",
                                               "account_id": acc, "assignees": [o["s"]["asha"]],
                                               "extra_metrics": extras})).json()["data"]["id"]
        ads.append(rid)
        metrics_now[rid] = ["leads", "spend"] + [m for m in EXTRAS if m in extras]
        stored[rid] = {}
    for step in range(35):
        rid = rnd.choice(ads)
        if rnd.random() < 0.2:                                      # switch extras on / off mid-campaign
            extras = [m for m in EXTRAS if rnd.random() < 0.5]
            r = await c("PATCH", f"{B}/{rid}", "lead", json={"extra_metrics": extras})
            assert r.status_code == 200
            metrics_now[rid] = ["leads", "spend"] + [m for m in EXTRAS if m in extras]
            continue
        d = date(2026, 9, 1) + timedelta(days=rnd.randint(0, 40))
        if rnd.random() < 0.1:
            body, vals = {"campaign_off": True}, {m: 0 for m in metrics_now[rid]}
        else:
            imp = rnd.randint(500, 50000)
            gen = {"leads": rnd.randint(0, 60), "spend": rnd.randint(0, 900000), "impressions": imp,
                   "reach": rnd.randint(0, imp), "clicks": rnd.randint(0, imp // 20), LPV: rnd.randint(0, imp // 25)}
            vals = {m: gen[m] for m in metrics_now[rid]}
            body = {m: (f"{v // 100}.{v % 100:02d}" if m == "spend" else v) for m, v in vals.items()}
            body["campaign_off"] = False
        r = await c("PUT", f"{B}/{rid}/entries/{d.isoformat()}", "lead", json=body)
        assert r.status_code in (200, 201), (seed, step, r.text[:200])
        stored[rid][d.isoformat()] = vals                           # a correction replaces the day

    lo, hi = date(2026, 9, 1), date(2026, 10, 11)          # every typed day (1 Sep + 0..40)
    for rid in ads:
        days = stored[rid]
        for gran in ("day", "week", "month"):
            s = (await c("GET", f"{B}/{rid}/series?from={lo.isoformat()}&to={hi.isoformat()}&granularity={gran}", "lead")).json()["data"]
            assert s["metrics"] == metrics_now[rid]
            want = calc(list(days.values()), metrics_now[rid])
            for k, v in want.items():
                assert s["totals"].get(k) == v, (seed, rid[-4:], gran, k, s["totals"].get(k), v)
            for p in s["points"]:
                if gran == "day":
                    in_b = [v for d_, v in days.items() if d_ == p["key"]]
                elif gran == "week":
                    in_b = [v for d_, v in days.items() if week_key(date.fromisoformat(d_)) == p["key"]]
                else:
                    in_b = [v for d_, v in days.items() if d_[:7] == p["key"][:7]]
                if not in_b:
                    assert p["values"] is None
                    continue
                pw = calc(in_b, metrics_now[rid])
                for k in ("leads", "spend", LPV, "cplpv", "cpc"):
                    if k in pw:
                        assert p["values"].get(k) == pw[k], (seed, rid[-4:], gran, p["key"], k)
    s = (await c("GET", f"{B}/{acc}/series?from={lo.isoformat()}&to={hi.isoformat()}", "lead")).json()["data"]
    union = ["leads", "spend"] + [m for m in EXTRAS if any(m in metrics_now[x] for x in ads)]
    assert s["metrics"] == union
    all_days = [v for x in ads for v in stored[x].values()]
    want = calc(all_days, union)
    for k, v in want.items():
        assert s["totals"].get(k) == v, (seed, "account", k, s["totals"].get(k), v)
