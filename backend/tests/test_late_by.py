"""
"Late by" (Overview PDF task table) and "On time" (Performance report).

The rule (agreed 2026-10-13): Late by = when the work was HANDED IN (submitted
for approval) − the END of the due day (midnight IST after it), in plain clock
time — every hour counts, nights and Sundays included — shown as "1d 12h 43m".
  Due 9 Oct, submitted 11 Oct 12:43 → 1d 12h 43m.  Submitted any time on 9 Oct → On time.
It is the assignee's lateness: time the work sat with a leader (a submission
until it was sent back for a reedit) is not counted, and the approval time never
matters. Performance's "On time" uses the same deadline and hand-in.

The dated cases are the rows of a real exported report (Sharanya, Oct 2026).
Every expected value is worked out by hand in the comment beside it.
Pure functions only: no database needed.
"""
import re
from datetime import date, datetime, timedelta, timezone

from app.services import overview_report_service as svc
from app.services import performance_service as perf

IST = timezone(timedelta(hours=5, minutes=30))
NOW = datetime(2026, 10, 13, 12, 33, tzinfo=IST)          # when the reported PDF was downloaded


def at(y, m, d, hh, mm, ss=0):
    """An IST wall-clock time, stored as Mongo would (ISO, UTC)."""
    return datetime(y, m, d, hh, mm, ss, tzinfo=IST).astimezone(timezone.utc).isoformat()


def task(status, due, *history, **extra):
    return {"status": status, "due_date": due,
            "history": [{"action": a, "timestamp": ts} for a, ts in history], **extra}


def late(r):
    return svc.fmt_late(r["late"]) if r["late"] is not None else None


def pdf_text(rows):
    from tests.test_overview_pdf import pdf_strings
    return pdf_strings(svc.build_pdf(tasks=rows, heading="x", scope_line="", period_label="All time",
                                     generated_by="Lena", team_names={}, today=date(2026, 10, 13)))


# ── The rule, exactly as specified ──────────────────────────────────────────

def test_the_agreed_example():
    # Assigned 8 Oct, due 9 Oct, submitted 11 Oct 12:43 → 10 Oct 00:00 → 11 Oct 12:43 = 1d 12h 43m.
    r = svc.task_timeline(task("approved", "2026-10-09",
                               ("assigned", at(2026, 10, 8, 10, 0)),
                               ("pending_review", at(2026, 10, 11, 12, 43)),
                               ("approved", at(2026, 10, 11, 18, 0))))
    assert late(r) == "1d 12h 43m" and not r["late_open"]


def test_anything_on_the_due_day_is_on_time():
    for hh, mm in ((0, 1), (9, 0), (15, 0), (23, 59)):
        r = svc.task_timeline(task("approved", "2026-10-09", ("pending_review", at(2026, 10, 9, hh, mm)),
                                   ("approved", at(2026, 10, 12, 10, 0))))
        assert r["late"] is None, (hh, mm)
    # One minute into the next day is late.
    r = svc.task_timeline(task("approved", "2026-10-09", ("pending_review", at(2026, 10, 10, 0, 1)),
                               ("approved", at(2026, 10, 10, 9, 0))))
    assert late(r) == "1m"


def test_format():
    assert [svc.fmt_late(s) for s in (None, 0, 30, 60, 43 * 60, 12 * 3600 + 5 * 60, 86400,
                                      (2 * 24 + 12) * 3600 + 43 * 60 + 59)] == \
        ["—", "<1m", "<1m", "1m", "43m", "12h 05m", "1d 0h 00m", "2d 12h 43m"]


def test_clock_time_counts_nights_sundays_and_holidays():
    # Due Sat 10 Oct, submitted Mon 12 Oct 09:00: 11 Oct (Sunday) 00:00 → 12 Oct 09:00 = 1d 9h 00m.
    t = task("approved", "2026-10-10", ("pending_review", at(2026, 10, 12, 9, 0)), ("approved", at(2026, 10, 12, 10, 0)))
    assert late(svc.task_timeline(t)) == "1d 9h 00m"
    # A company holiday on the 11th changes nothing.
    assert late(svc.task_timeline(t, holidays=frozenset({date(2026, 10, 11)}))) == "1d 9h 00m"
    # 00:30 the night after the due day = 30m.
    r = svc.task_timeline(task("approved", "2026-10-07", ("pending_review", at(2026, 10, 8, 0, 30)),
                               ("approved", at(2026, 10, 8, 12, 0))))
    assert late(r) == "30m"


# ── Sharanya's report ───────────────────────────────────────────────────────

def test_handed_in_on_the_due_day_but_approved_next_day_is_on_time():
    # Row 39: due 07 Oct, submitted 07 Oct 21:50, approved 08 Oct 13:04 → On time.
    r = svc.task_timeline(task("approved", "2026-10-07",
                               ("started", at(2026, 10, 7, 21, 50)),
                               ("pending_review", at(2026, 10, 7, 21, 50, 8)),
                               ("approved", at(2026, 10, 8, 13, 4))))
    assert r["late"] is None
    assert r["handed_in"].isoformat() == at(2026, 10, 7, 21, 50, 8)
    assert r["completed"].isoformat() == at(2026, 10, 8, 13, 4), "Completed is still the approval"


def test_late_work_is_measured_to_the_submission_not_the_approval():
    # Row 43: due 03 Oct, submitted 07 Oct 21:53 → 04 Oct 00:00 → 07 Oct 21:53 = 3d 21h 53m
    # (the 08 Oct 13:03 approval doesn't count).
    r = svc.task_timeline(task("approved", "2026-10-03",
                               ("pending_review", at(2026, 10, 7, 21, 53)),
                               ("approved", at(2026, 10, 8, 13, 3))))
    assert late(r) == "3d 21h 53m" and not r["late_open"]
    # Row 42: due 06 Oct, submitted 07 Oct 21:51 → 21h 51m.
    r = svc.task_timeline(task("approved", "2026-10-06",
                               ("pending_review", at(2026, 10, 7, 21, 51)),
                               ("approved", at(2026, 10, 8, 13, 3))))
    assert late(r) == "21h 51m"
    # Row 38: due 08 Oct, submitted 09 Oct 16:47 → 16h 47m.
    r = svc.task_timeline(task("approved", "2026-10-08",
                               ("pending_review", at(2026, 10, 9, 16, 47)),
                               ("approved", at(2026, 10, 9, 16, 54))))
    assert late(r) == "16h 47m"


def test_open_work_is_late_so_far():
    # Rows 32–37: due 10 Oct, not started, now 13 Oct 12:33 → 11 Oct 00:00 → 13 Oct 12:33 = 2d 12h 33m.
    r = svc.task_timeline(task("pending", "2026-10-10"), now=NOW)
    assert late(r) == "2d 12h 33m" and r["late_open"]
    # Row 44: due 03 Oct → 04 Oct 00:00 → 13 Oct 12:33 = 9d 12h 33m.
    assert late(svc.task_timeline(task("pending", "2026-10-03"), now=NOW)) == "9d 12h 33m"
    # Not yet due → nothing.
    assert svc.task_timeline(task("pending", "2026-10-13"), now=NOW)["late"] is None


def test_awaiting_approval_is_late_only_up_to_the_submission():
    # Due 08, submitted 09 Oct 14:00, still waiting → 14h 00m, fixed (not "so far").
    r = svc.task_timeline(task("pending_review", "2026-10-08", ("pending_review", at(2026, 10, 9, 14, 0))), now=NOW)
    assert late(r) == "14h 00m" and not r["late_open"]
    # Submitted on the due day, still waiting → not late.
    r = svc.task_timeline(task("pending_review", "2026-10-12", ("pending_review", at(2026, 10, 12, 18, 0))), now=NOW)
    assert r["late"] is None and r["handed_in"] is not None
    # On time, sent back, resubmitted 09 Oct 14:00 and waiting → the LATEST submission: 14h 00m.
    r = svc.task_timeline(task("pending_review", "2026-10-08",
                               ("pending_review", at(2026, 10, 8, 12, 0)),
                               ("reedit", at(2026, 10, 8, 15, 0)),
                               ("pending_review", at(2026, 10, 9, 14, 0))), now=NOW)
    assert late(r) == "14h 00m" and r["handed_in"].isoformat() == at(2026, 10, 9, 14, 0)


# ── Reedits: time with the leader isn't the assignee's ──────────────────────

def test_time_in_review_before_a_reedit_is_not_the_assignees():
    # Due Mon 5, handed in on time 5 Oct 15:00, left in review until Thu 8 15:00, sent back,
    # fixed by 15:30. 6 Oct 00:00 → 8 Oct 15:30 = 2d 15h 30m, minus 6 Oct 00:00 → 8 Oct 15:00
    # with the leader (2d 15h 00m) = 30m.
    r = svc.task_timeline(task("approved", "2026-10-05",
                               ("pending_review", at(2026, 10, 5, 15, 0)),
                               ("reedit", at(2026, 10, 8, 15, 0)),
                               ("pending_review", at(2026, 10, 8, 15, 30)),
                               ("approved", at(2026, 10, 8, 16, 0))))
    assert late(r) == "30m"
    # Performance still calls it late: the accepted hand-in came after the due day.
    t = task("approved", "2026-10-05", ("pending_review", at(2026, 10, 5, 15, 0)),
             ("reedit", at(2026, 10, 8, 15, 0)), ("pending_review", at(2026, 10, 8, 15, 30)))
    assert perf.handed_in_at(t, datetime.fromisoformat(at(2026, 10, 8, 16, 0))) > perf.due_day_end(t)


def test_after_a_reedit_the_resubmission_counts():
    # Due 5; submitted 5 Oct 15:00 (on time), sent back 6 Oct 12:00, resubmitted 7 Oct 12:00,
    # approved 13:00. 6 Oct 00:00 → 7 Oct 12:00 = 1d 12h, minus 6 Oct 00:00 → 12:00 with the
    # leader (12h) = 1d 0h 00m.
    r = svc.task_timeline(task("approved", "2026-10-05",
                               ("pending_review", at(2026, 10, 5, 15, 0)),
                               ("reedit", at(2026, 10, 6, 12, 0)),
                               ("pending_review", at(2026, 10, 7, 12, 0)),
                               ("approved", at(2026, 10, 7, 13, 0))))
    assert late(r) == "1d 0h 00m" and r["handed_in"].isoformat() == at(2026, 10, 7, 12, 0)


def test_sent_back_after_the_due_day_counts_so_far():
    # Due 10, submitted 10 Oct 12:00 (on time), sent back 12 Oct 11:30, open at 13 Oct 12:33.
    # 11 Oct 00:00 → 13 Oct 12:33 = 2d 12h 33m, minus 11 Oct 00:00 → 12 Oct 11:30 (1d 11h 30m) = 1d 1h 03m.
    r = svc.task_timeline(task("reedit", "2026-10-10",
                               ("pending_review", at(2026, 10, 10, 12, 0)),
                               ("reedit", at(2026, 10, 12, 11, 30))), now=NOW)
    assert late(r) == "1d 1h 03m" and r["late_open"]


# ── Fallbacks and data shapes ───────────────────────────────────────────────

def test_no_submission_recorded_falls_back_to_the_approval():
    # Older tasks approved straight away: due 03, approved 08 Oct 13:03 → 4d 13h 03m.
    r = svc.task_timeline(task("approved", "2026-10-03", ("approved", at(2026, 10, 8, 13, 3))))
    assert late(r) == "4d 13h 03m" and r["handed_in"].isoformat() == at(2026, 10, 8, 13, 3)


def test_awaiting_approval_without_a_submission_row_stops_at_its_last_update():
    # Moved to review by an old status migration: due 03, last update 05 Oct 12:00 → 1d 12h 00m.
    r = svc.task_timeline({"status": "pending_review", "due_date": "2026-10-03", "history": [],
                           "updated_at": at(2026, 10, 5, 12, 0)}, now=NOW)
    assert late(r) == "1d 12h 00m" and not r["late_open"]
    # With a timer stop (05 Oct 11:45) recorded, that is the hand-in → 1d 11h 45m.
    r = svc.task_timeline({"status": "pending_review", "due_date": "2026-10-03", "history": [],
                           "updated_at": at(2026, 10, 9, 12, 0),
                           "timing": {"intervals": [{"started_at": at(2026, 10, 5, 11, 0),
                                                     "ended_at": at(2026, 10, 5, 11, 45)}]}}, now=NOW)
    assert late(r) == "1d 11h 45m" and not r["late_open"]


def test_raw_mongo_datetimes_and_odd_strings():
    naive = lambda *a: datetime(*a, tzinfo=IST).astimezone(timezone.utc).replace(tzinfo=None)
    r = svc.task_timeline({"status": "approved", "due_date": "2026-10-07", "history": [
        {"action": "pending_review", "timestamp": naive(2026, 10, 8, 2, 0)},
        {"action": "approved", "timestamp": naive(2026, 10, 8, 13, 4)}]})
    assert late(r) == "2h 00m", "raw Mongo (naive UTC) history"
    assert perf._aware("2026-10-07T16:20:00Z").tzinfo is not None
    assert perf._aware("not a date") is None and perf._aware("") is None and perf._aware(None) is None


# ── The rendered PDF ────────────────────────────────────────────────────────

def test_rendered_pdf_cells():
    rows = [
        {"id": "1", "title": "Handed in on the due day", "assigned_to_name": "Sharanya", "due_date": "2026-10-07",
         "status": "approved", "history": [{"action": "pending_review", "timestamp": at(2026, 10, 7, 21, 50)},
                                           {"action": "approved", "timestamp": at(2026, 10, 8, 13, 4)}]},
        {"id": "2", "title": "Handed in late", "assigned_to_name": "Sharanya", "due_date": "2026-10-03",
         "status": "approved", "history": [{"action": "pending_review", "timestamp": at(2026, 10, 7, 21, 53)},
                                           {"action": "approved", "timestamp": at(2026, 10, 8, 13, 3)}]},
        {"id": "3", "title": "Never started", "assigned_to_name": "Sharanya", "due_date": "2026-09-01",
         "status": "pending"},
    ]
    text = pdf_text(rows)
    assert "On time" in text and "3d 21h 53m" in text
    assert re.search(r"\d+d \d+h \d\dm so far", text), "open task: days, hours, minutes, so far"
    for gone in ("2h 04m", "30h 33m", "28h 30m", "days past due", "After hours"):
        assert gone not in text, gone
    assert "time from the end of the due day to when the work was handed in" in text


# ── Performance: On time ────────────────────────────────────────────────────

def test_performance_on_time_uses_the_handed_in_time():
    t = task("approved", "2026-10-07",
             ("pending_review", at(2026, 10, 7, 21, 50)),
             ("approved", at(2026, 10, 8, 13, 4)))
    approved = datetime.fromisoformat(at(2026, 10, 8, 13, 4))
    assert perf.handed_in_at(t, approved).isoformat() == at(2026, 10, 7, 21, 50)
    assert perf.handed_in_at(t, approved) <= perf.due_day_end(t), "on time"
    t2 = task("approved", "2026-10-07", ("approved", at(2026, 10, 8, 13, 4)))
    assert perf.handed_in_at(t2, approved) == approved


def test_performance_due_day_ends_at_midnight_ist_not_utc():
    # 02:00 IST on the 8th is 20:30 UTC on the 7th: late (due dates are IST days).
    t = task("approved", "2026-10-07")
    end = perf.due_day_end(t)
    assert end.astimezone(IST).strftime("%Y-%m-%d %H:%M") == "2026-10-07 23:59"
    assert datetime.fromisoformat(at(2026, 10, 8, 2, 0)) > end
    assert datetime.fromisoformat(at(2026, 10, 7, 23, 30)) <= end
    assert perf.due_day_end(task("approved", "")) is None and perf.due_day_end({"due_date": "bad"}) is None


def test_pdf_and_performance_agree_on_late_vs_on_time():
    # The same deadline everywhere: Late by is shown exactly when Performance says "late".
    cases = [at(2026, 10, 9, 23, 59), at(2026, 10, 10, 0, 1), at(2026, 10, 11, 12, 43), at(2026, 10, 8, 18, 0)]
    for sub in cases:
        t = task("approved", "2026-10-09", ("pending_review", sub), ("approved", at(2026, 10, 12, 9, 0)))
        is_late = svc.task_timeline(t)["late"] is not None
        perf_late = perf.handed_in_at(t, datetime.fromisoformat(at(2026, 10, 12, 9, 0))) > perf.due_day_end(t)
        assert is_late == perf_late, sub


def test_exactly_midnight_after_the_due_day_is_late_in_both():
    t = task("approved", "2026-10-09", ("pending_review", at(2026, 10, 10, 0, 0)), ("approved", at(2026, 10, 10, 9, 0)))
    assert late(svc.task_timeline(t)) == "<1m"
    assert perf.handed_in_at(t, datetime.fromisoformat(at(2026, 10, 10, 9, 0))) > perf.due_day_end(t)
