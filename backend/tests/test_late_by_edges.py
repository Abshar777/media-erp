"""
"Late by" — boundaries and properties.

Rule: Late by = hand-in − midnight IST after the due day, clock time, shown "1d 12h 43m"
(see tests/test_late_by.py). Here:
  • a boundary matrix (IST/UTC midnight, month/year ends, leap day, odd due-date
    strings, unordered or mixed-type history, very long delays), every value by hand;
  • properties that must hold for ANY task, checked on thousands of seeded random
    tasks: the exact formula, monotonicity, on-time ⇔ no Late by, PDF ⇔ Performance
    agreement, and that the printed text parses back to the number.
Pure functions only: no database needed.
"""
import random
import re
from datetime import date, datetime, timedelta, timezone

import pytest

from app.services import overview_report_service as svc
from app.services import performance_service as perf

IST = timezone(timedelta(hours=5, minutes=30))
UTC = timezone.utc


def ist(y, m, d, hh=0, mm=0, ss=0):
    return datetime(y, m, d, hh, mm, ss, tzinfo=IST)


def approved(due, submitted, approved_at=None, as_text=True):
    conv = (lambda d: d.astimezone(UTC).isoformat()) if as_text else (lambda d: d.astimezone(UTC).replace(tzinfo=None))
    approved_at = approved_at or submitted + timedelta(hours=3)
    return {"status": "approved", "due_date": due, "history": [
        {"action": "pending_review", "timestamp": conv(submitted)},
        {"action": "approved", "timestamp": conv(approved_at)}]}


def late(t, **kw):
    r = svc.task_timeline(t, **kw)
    return svc.fmt_late(r["late"]) if r["late"] is not None else None


# ── Boundary matrix (every value worked out by hand) ────────────────────────

@pytest.mark.parametrize("due, submitted, want", [
    # The IST / UTC midnight trap: 23:59 IST is 18:29 UTC the same date; 00:01 IST next day is
    # 18:31 UTC on the DUE date — a UTC-day rule would call it on time.
    ("2026-10-09", ist(2026, 10, 9, 23, 59), None),
    ("2026-10-09", ist(2026, 10, 10, 0, 1), "1m"),
    ("2026-10-09", ist(2026, 10, 10, 5, 29), "5h 29m"),      # 23:59 UTC on the 9th
    ("2026-10-09", ist(2026, 10, 10, 5, 31), "5h 31m"),
    # Month end, year end, leap day.
    ("2026-10-31", ist(2026, 11, 1, 9, 15), "9h 15m"),
    ("2026-12-31", ist(2027, 1, 2, 12, 43), "1d 12h 43m"),
    ("2028-02-28", ist(2028, 3, 1, 1, 0), "1d 1h 00m"),      # 29 Feb 2028 exists
    ("2027-02-28", ist(2027, 3, 1, 1, 0), "1h 00m"),         # 2027 has no 29 Feb
    # Long delays keep counting in days.
    ("2026-01-01", ist(2026, 12, 31, 18, 30), "363d 18h 30m"),
    # Early hand-in.
    ("2026-10-09", ist(2026, 10, 1, 10, 0), None),
])
def test_boundary_matrix(due, submitted, want):
    assert late(approved(due, submitted)) == want
    assert late(approved(due, submitted, as_text=False)) == want, "raw Mongo datetimes give the same"


@pytest.mark.parametrize("due_value, want", [
    ("2026-10-09", "1d 12h 43m"),
    ("2026-10-09T00:00:00", "1d 12h 43m"),          # stored with a time part
    ("2026-10-09T00:00:00.000Z", "1d 12h 43m"),
    ("", None), (None, None), ("09/10/2026", None), ("garbage", None),   # no usable due date → no Late by
])
def test_due_date_shapes(due_value, want):
    t = approved("x", ist(2026, 10, 11, 12, 43))
    t["due_date"] = due_value
    assert late(t) == want


def test_history_order_and_extra_rows_do_not_matter():
    sub, appr = ist(2026, 10, 11, 12, 43), ist(2026, 10, 12, 9, 0)
    base = approved("2026-10-09", sub, appr)
    shuffled = dict(base, history=list(reversed(base["history"])) + [
        {"action": "verified", "timestamp": ist(2026, 10, 11, 20, 0).isoformat()},     # not a submission
        {"action": "comment", "timestamp": None},                                     # no time: ignored
        {"action": "started", "timestamp": "not a date"}])                            # unreadable: ignored
    assert late(base) == late(shuffled) == "1d 12h 43m"


def test_no_due_date_or_still_early_never_shows_late():
    assert svc.task_timeline({"status": "pending", "history": []})["late"] is None
    now = ist(2026, 10, 9, 23, 0)
    assert svc.task_timeline({"status": "pending", "due_date": "2026-10-09"}, now=now)["late"] is None


# ── Properties on random tasks ──────────────────────────────────────────────

def _random_task(rng):
    due = date(2026, 1, 1) + timedelta(days=rng.randint(0, 364))
    sub = datetime.combine(due, datetime.min.time(), tzinfo=IST) + timedelta(minutes=rng.randint(-5 * 1440, 40 * 1440))
    return due, sub


@pytest.mark.parametrize("seed", [1, 2, 3])
def test_exact_formula_and_on_time(seed):
    rng = random.Random(seed)
    for _ in range(1500):
        due, sub = _random_task(rng)
        t = approved(due.isoformat(), sub, as_text=rng.random() < 0.5)
        r = svc.task_timeline(t)
        deadline = datetime.combine(due + timedelta(days=1), datetime.min.time(), tzinfo=IST)
        if sub < deadline:
            assert r["late"] is None, (due, sub)
        else:
            assert r["late"] == (sub - deadline).total_seconds(), (due, sub)
        # The PDF and Performance agree on late vs on time.
        appr = datetime.fromisoformat(t["history"][1]["timestamp"]) if isinstance(t["history"][1]["timestamp"], str) \
            else t["history"][1]["timestamp"].replace(tzinfo=UTC)
        perf_late = perf.handed_in_at(t, appr) > perf.due_day_end(t)
        assert (r["late"] is not None) == perf_late, (due, sub)


@pytest.mark.parametrize("seed", [4, 5])
def test_later_hand_in_is_never_less_late(seed):
    rng = random.Random(seed)
    for _ in range(1000):
        due, sub = _random_task(rng)
        a = svc.task_timeline(approved(due.isoformat(), sub))["late"] or 0
        b = svc.task_timeline(approved(due.isoformat(), sub + timedelta(minutes=rng.randint(1, 5000))))["late"] or 0
        assert b >= a


@pytest.mark.parametrize("seed", [6])
def test_printed_text_reads_back_to_the_number(seed):
    rng = random.Random(seed)
    for _ in range(3000):
        secs = rng.randint(0, 400 * 86400)
        text = svc.fmt_late(secs)
        if secs < 60:
            assert text == "<1m"
            continue
        m = re.fullmatch(r"(?:(\d+)d )?(?:(\d+)h )?(\d+)m", text)
        assert m, text
        d, h, mi = (int(x or 0) for x in m.groups())
        assert d * 86400 + h * 3600 + mi * 60 == (secs // 60) * 60, (secs, text)   # minutes rounded down
        assert h < 24 and mi < 60


def test_under_a_minute_and_the_exact_midnight_instant():
    assert {svc.fmt_late(s) for s in range(0, 60)} == {"<1m"}
    # 00:00:00 after the due day is the first late instant (Performance agrees).
    t = approved("2026-10-09", ist(2026, 10, 10, 0, 0, 0))
    assert late(t) == "<1m"
    assert late(approved("2026-10-09", ist(2026, 10, 9, 23, 59, 59))) is None
