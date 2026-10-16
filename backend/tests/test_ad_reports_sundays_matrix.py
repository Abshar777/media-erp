"""
Ads skip Sundays — the QA pass (2026-10-16).

1. Role matrix: every role switching Sundays on three kinds of ad (a leader's
   ad, an employee's own ad, an ad in an account someone looks after); refused
   attempts change nothing.
2. Create: the value sent is stored; omitted = skip; every creator path.
3. The chart's "Sunday — optional" mark only on days the ad runs.
4. Model-based: an account with three ads, random days passing, entries,
   switching, pausing / resuming, end dates and ending — after every step each
   ad's missing days, chip, chart marks and reminder, and the account's day
   marks, are compared with a plain calendar model (no shared code).

Organisation: see test_ad_reports_selfserve_matrix (T1 Media: lead + asha,
mira, multi, kofi, coordm; T2 Design: lead2 + multi, zane; T3 Ops: kofi + omar).
"""
import random
from datetime import date, datetime, timedelta

import pytest
from bson import ObjectId

from app.services import ad_report_service as ar
from app.utils.timezone import IST
from tests.test_ad_reports_selfserve_matrix import B, ELEVATED, ROLE, START, WED, org  # noqa: F401

SUNDAY = 6


def at(d: date, hh: int, mm: int = 0) -> datetime:
    return datetime(d.year, d.month, d.day, hh, mm, tzinfo=IST)


def days(lo: date, hi: date):
    return [lo + timedelta(days=i) for i in range((hi - lo).days + 1)]


async def three_ads(o):
    c, s, t1 = o["call"], o["s"], o["T"]["T1"]
    leader_ad = (await c("POST", B, "lead", json={"name": "Leader ad", "team_ids": [t1], "start_date": START,
                                                 "assignees": [s["asha"]]})).json()["data"]["id"]
    own_ad = (await c("POST", B, "asha", json={"name": "Asha's own", "team_ids": [t1], "start_date": START})).json()["data"]["id"]
    acc = (await c("POST", B, "lead", json={"kind": "account", "name": "Kept", "team_ids": [t1],
                                           "assignees": [s["mira"]]})).json()["data"]["id"]
    kept_ad = (await c("POST", B, "lead", json={"name": "In Mira's account", "team_ids": [t1], "start_date": START,
                                               "account_id": acc, "assignees": [s["asha"]]})).json()["data"]["id"]
    return {"leader": leader_ad, "own": own_ad, "kept": kept_ad, "account": acc}


ALLOWED = {
    "leader": {"lead"} | ELEVATED,
    "own": {"asha", "lead"} | ELEVATED,          # the employee who made it runs it
    "kept": {"mira", "lead"} | ELEVATED,         # the account's keeper runs its ads
}


# ── 1. Role matrix ───────────────────────────────────────────────────────────

@pytest.mark.parametrize("which", ["leader", "own", "kept"])
@pytest.mark.parametrize("role", list(ROLE))
async def test_who_can_switch_sundays(org, role, which):
    o = org
    ads = await three_ads(o)
    rid = ads[which]
    before = await o["db"][ar.REPORTS].find_one({"_id": ObjectId(rid)})
    r = await o["call"]("PATCH", f"{B}/{rid}", role, json={"skip_sundays": False})
    after = await o["db"][ar.REPORTS].find_one({"_id": ObjectId(rid)})
    if role in ALLOWED[which]:
        assert r.status_code == 200, (role, which, r.text[:160])
        assert after["skip_sundays"] is False and after["sundays_owed_from"] == WED.isoformat()
        back = await o["call"]("PATCH", f"{B}/{rid}", role, json={"skip_sundays": True})
        assert back.status_code == 200 and back.json()["data"]["skip_sundays"] is True
    else:
        assert r.status_code in (403, 404), (role, which, r.status_code)
        assert after == before, "a refused switch changes nothing"


# ── 2. Create ────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("who", ["lead", "asha", "sa", "coordm", "multi"])
async def test_every_creator_gets_the_value_they_send(org, who):
    o, s, t1 = org, org["s"], org["T"]["T1"]
    for sent, want in ((None, True), (True, True), (False, False)):
        body = {"name": f"{who} {sent}", "team_ids": [t1], "start_date": START, "assignees": [s[who]]}
        if sent is not None:
            body["skip_sundays"] = sent
        r = await o["call"]("POST", B, who, json=body)
        assert r.status_code == 201, (who, r.text[:160])
        d = r.json()["data"]
        assert d["skip_sundays"] is want, (who, sent)
        assert ("2026-10-11" in d["missing"]) is (not want)
    acc = await o["call"]("POST", B, "lead", json={"kind": "account", "name": "A", "team_ids": [t1], "skip_sundays": False})
    assert acc.status_code == 201 and acc.json()["data"]["skip_sundays"] is False, "an account has no days — ignored"
    doc = await o["db"][ar.REPORTS].find_one({"_id": ObjectId(acc.json()["data"]["id"])})
    assert "skip_sundays" not in doc


# ── 3. The chart's Sunday mark ───────────────────────────────────────────────

async def test_sunday_mark_only_while_the_ad_runs(org):
    o, s, t1, c = org, org["s"], org["T"]["T1"], org["call"]
    o["clock"].today = date(2026, 10, 28)
    ended = (await c("POST", B, "lead", json={"name": "Ends Sat 17", "team_ids": [t1], "start_date": "2026-10-05",
                                             "end_date": "2026-10-17", "assignees": [s["asha"]]})).json()["data"]["id"]
    pts = {p["key"]: p for p in (await c("GET", f"{B}/{ended}/series?from=2026-10-01&to=2026-10-27", "lead")).json()["data"]["points"]}
    assert pts["2026-10-11"]["rest"] == ["2026-10-11"], "inside its run: marked"
    assert pts["2026-10-04"]["rest"] == [], "before it started: not marked"
    assert pts["2026-10-18"]["rest"] == [] and pts["2026-10-25"]["rest"] == [], "after its end: not marked"
    o["clock"].today = date(2026, 10, 17)
    paused = (await c("POST", B, "lead", json={"name": "Paused", "team_ids": [t1], "start_date": "2026-10-05",
                                              "assignees": [s["asha"]]})).json()["data"]["id"]
    assert (await c("PATCH", f"{B}/{paused}", "lead", json={"action": "pause"})).status_code == 200
    o["clock"].today = date(2026, 10, 27)
    pts = {p["key"]: p for p in (await c("GET", f"{B}/{paused}/series?from=2026-10-05&to=2026-10-26", "lead")).json()["data"]["points"]}
    assert pts["2026-10-11"]["rest"] == ["2026-10-11"]
    assert pts["2026-10-18"]["rest"] == [] and pts["2026-10-25"]["rest"] == [], "paused: not marked"


# ── 4. Model-based ───────────────────────────────────────────────────────────

class AdModel:
    def __init__(self, start: date, skip: bool, end: date | None):
        self.start, self.skip, self.end = start, skip, end
        self.owed_from: date | None = None
        self.pauses: list[list] = []                    # [from, to or None]
        self.status = "active"
        self.entered: set[date] = set()

    def paused_on(self, d):
        return any(f <= d and (t is None or d <= t) for f, t in self.pauses)

    def runs_on(self, d):
        return self.start <= d and (self.end is None or d <= self.end) and not self.paused_on(d)

    def free_sunday(self, d):
        return d.weekday() == SUNDAY and (self.skip or (self.owed_from is not None and d < self.owed_from))

    def owes(self, d):
        return self.runs_on(d) and not self.free_sunday(d)

    def missing(self, today):
        return [d for d in days(self.start, today - timedelta(days=1)) if self.owes(d) and d not in self.entered]

    def chip(self, today, hh):
        if self.status in ("ended", "paused"):
            return self.status
        if self.start >= today:
            return "not_started"
        miss = self.missing(today)
        if not miss:
            return "updated"
        if len(miss) == 1 and hh < 17:
            d = miss[0] + timedelta(days=1)
            while d < today and self.free_sunday(d):
                d += timedelta(days=1)
            if d == today:
                return "due"
        return "missing"


@pytest.mark.parametrize("seed", range(30))
async def test_random_account_with_three_ads_matches_the_model(org, seed):
    rnd = random.Random(7000 + seed)
    o, c, s, t1, db = org, org["call"], org["s"], org["T"]["T1"], org["db"]
    o["clock"].today = date(2026, 10, 5) + timedelta(days=rnd.randint(0, 6))
    acc = (await c("POST", B, "lead", json={"kind": "account", "name": "Acc", "team_ids": [t1]})).json()["data"]["id"]
    ads: dict[str, AdModel] = {}
    for i in range(3):
        start = o["clock"].today - timedelta(days=rnd.randint(0, 9))
        skip = rnd.random() < 0.7
        end = start + timedelta(days=rnd.randint(5, 25)) if rnd.random() < 0.3 else None
        body = {"name": f"Ad {i}", "team_ids": [t1], "start_date": start.isoformat(), "account_id": acc,
                "assignees": [s["asha"]], "skip_sundays": skip, "end_date": end.isoformat() if end else None}
        r = await c("POST", B, "lead", json=body)
        assert r.status_code == 201, r.text
        ads[r.json()["data"]["id"]] = AdModel(start, skip, end)

    for step in range(30):
        today = o["clock"].today
        yesterday = today - timedelta(days=1)
        rid = rnd.choice(list(ads))
        m = ads[rid]
        op = rnd.choices(["day", "enter", "toggle", "pause", "resume", "end"], [5, 6, 2, 1, 1, 0.3])[0]
        if op == "day":
            o["clock"].today = today + timedelta(days=rnd.choice([1, 1, 1, 2]))
        elif op == "enter":
            d = today - timedelta(days=rnd.randint(1, 8))
            r = await c("PUT", f"{B}/{rid}/entries/{d.isoformat()}", "lead", json={"leads": 3, "spend": "100"})
            if d < m.start or (m.end and d > m.end):
                assert r.status_code == 422
            else:
                assert r.status_code in (200, 201), r.text
                m.entered.add(d)
        elif op == "toggle":
            new = not m.skip
            r = await c("PATCH", f"{B}/{rid}", "lead", json={"skip_sundays": new})
            if m.status == "ended":
                assert r.status_code == 409
            else:
                assert r.status_code == 200, r.text
                m.skip = new
                if not new:
                    m.owed_from = today
        elif op == "pause":
            r = await c("PATCH", f"{B}/{rid}", "lead", json={"action": "pause"})
            if m.status == "active":
                assert r.status_code == 200
                m.status = "paused"
                m.pauses.append([today, None])
            else:
                assert r.status_code == 409
        elif op == "resume":
            r = await c("PATCH", f"{B}/{rid}", "lead", json={"action": "resume"})
            if m.status == "paused":
                assert r.status_code == 200
                m.status = "active"
                if m.pauses[-1][0] > yesterday:
                    m.pauses.pop()
                else:
                    m.pauses[-1][1] = yesterday
            else:
                assert r.status_code == 409
        elif op == "end":
            r = await c("PATCH", f"{B}/{rid}", "lead", json={"action": "end"})
            if m.status == "ended":
                assert r.status_code == 409
            else:
                assert r.status_code == 200
                last = max(yesterday, m.start)
                if m.end is None or m.end > last:
                    m.end = last
                m.status = "ended"

        today = o["clock"].today
        await ar.auto_end(db, today)
        for k, x in ads.items():                       # auto-end: past its end with nothing owed
            if x.status == "active" and x.end and x.end < today and not x.missing(today):
                x.status = "ended"

        # ── compare ──
        lo, hi = min(x.start for x in ads.values()), today - timedelta(days=1)
        for k, x in ads.items():
            doc = await db[ar.REPORTS].find_one({"_id": ObjectId(k)})
            ctx = (seed, step, op, k[-4:], today, x.skip, x.owed_from)
            assert doc["status"] == x.status, ctx + (doc["status"],)
            got = await ar.missing_days(db, doc, today)
            want = [d.isoformat() for d in x.missing(today)]
            assert got == want, ctx + (got, want)
            for hh in (10, 18):
                assert ar.day_status(doc, got, at(today, hh)) == x.chip(today, hh), ctx + (hh,)
            if hi >= x.start:
                pts = (await c("GET", f"{B}/{k}/series?from={x.start.isoformat()}&to={hi.isoformat()}", "lead")).json()["data"]["points"]
                for p in pts:
                    d = date.fromisoformat(p["key"])
                    assert (p["missing"] == [p["key"]]) is (x.owes(d) and d not in x.entered), ctx + (p["key"], "missing")
                    want_rest = x.runs_on(d) and x.free_sunday(d) and d not in x.entered
                    assert (p["rest"] == [p["key"]]) is want_rest, ctx + (p["key"], "rest")
        if hi >= lo:
            pts = (await c("GET", f"{B}/{acc}/series?from={lo.isoformat()}&to={hi.isoformat()}", "lead")).json()["data"]["points"]
            for p in pts:
                d = date.fromisoformat(p["key"])
                miss = any(x.owes(d) and d not in x.entered for x in ads.values())
                any_row = any(d in x.entered for x in ads.values())
                rest = (not miss and not any_row and d.weekday() == SUNDAY
                        and any(x.runs_on(d) and x.free_sunday(d) for x in ads.values()))
                assert (p["missing"] == [p["key"]]) is miss, (seed, step, p["key"], "account missing")
                assert (p["rest"] == [p["key"]]) is rest, (seed, step, p["key"], "account rest")
        if today.weekday() != SUNDAY:                  # reminders: exactly the model's missing days
            await db[ar.REMINDERS].delete_many({})
            await db["notifications"].delete_many({})
            await ar.run_reminders(db, at(today, 12, 1), frozenset())
            bells = {b["metadata"]["report_id"]: b["metadata"]["missing"]
                     for b in await db["notifications"].find({"type": ar.NOTIF_DUE}).to_list(50)}
            for k, x in ads.items():
                want = [d.isoformat() for d in x.missing(today)] if x.status == "active" else []
                assert bells.get(k, []) == want, (seed, step, k[-4:], bells.get(k), want)
