"""
Working time — elapsed seconds that actually fell inside a shift.

Wall-clock gaps flatter nobody fairly. A task submitted at 8pm Saturday and
approved at 11:30am Monday looks like a 39-hour wait, but the approver was
only at their desk for the last half hour of it. Measuring in working time
makes the performance report answer "how long did this sit with someone who
could have acted on it", which is the question people actually ask of it.

The shift is 11:00–20:30 IST, Monday to Saturday. Sundays are off, and any
date listed in the `company_holidays` collection is too — a document per day,
`{"date": "2026-01-26"}`, optionally with a `name`. The collection is optional;
with none present the calendar is simply Sundays-off.
"""
from datetime import date, datetime, time, timedelta, timezone

from app.utils.timezone import IST

SHIFT_START = time(11, 0)
SHIFT_END = time(20, 30)

# Python's weekday(): Monday is 0, Sunday is 6.
WEEKLY_OFF = {6}

SHIFT_SECONDS_PER_DAY = (
    (SHIFT_END.hour * 3600 + SHIFT_END.minute * 60)
    - (SHIFT_START.hour * 3600 + SHIFT_START.minute * 60)
)

# A guard against a corrupt timestamp turning one measurement into a
# multi-thousand-iteration loop. Nothing legitimate spans two years.
MAX_SPAN_DAYS = 730


def _ist(dt: datetime) -> datetime:
    """Mongo hands back naive UTC; every shift decision is made in IST."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(IST)


def is_working_day(day: date, holidays: frozenset[date] = frozenset()) -> bool:
    return day.weekday() not in WEEKLY_OFF and day not in holidays


def working_seconds(
    start: datetime | None,
    end: datetime | None,
    holidays: frozenset[date] = frozenset(),
) -> float:
    """
    Seconds between two instants that fell inside a working shift.

    Returns 0.0 for a missing or inverted range rather than raising: this runs
    over historical data where a clock skew or a half-written row should cost
    one measurement, not the whole report.
    """
    if not start or not end:
        return 0.0
    s, e = _ist(start), _ist(end)
    if e <= s:
        return 0.0
    if (e.date() - s.date()).days > MAX_SPAN_DAYS:
        return 0.0

    total = 0.0
    day = s.date()
    last = e.date()
    while day <= last:
        if is_working_day(day, holidays):
            shift_open = datetime.combine(day, SHIFT_START, tzinfo=IST)
            shift_close = datetime.combine(day, SHIFT_END, tzinfo=IST)
            lo = max(s, shift_open)
            hi = min(e, shift_close)
            if hi > lo:
                total += (hi - lo).total_seconds()
        day += timedelta(days=1)
    return total


def working_seconds_of_intervals(
    intervals: list[dict],
    holidays: frozenset[date] = frozenset(),
) -> float:
    """
    Sum a task timer's intervals, counting only shift time.

    A timer left running overnight would otherwise report the hours someone
    spent asleep as hours spent on the task.
    """
    total = 0.0
    for iv in intervals or []:
        if not isinstance(iv, dict):
            continue
        total += working_seconds(iv.get("started_at"), iv.get("ended_at"), holidays)
    return total


async def load_holidays(db) -> frozenset[date]:
    """
    Non-working dates from the optional `company_holidays` collection.

    Never raises: a missing collection or a malformed row should leave the
    calendar at Sundays-off, not break the report that asked for it.
    """
    try:
        rows = await db["company_holidays"].find({}, {"date": 1}).to_list(2000)
    except Exception:
        return frozenset()
    out: set[date] = set()
    for r in rows:
        raw = r.get("date")
        if isinstance(raw, datetime):
            out.add(_ist(raw).date())
        elif isinstance(raw, str):
            try:
                out.add(datetime.strptime(raw[:10], "%Y-%m-%d").date())
            except ValueError:
                continue
    return frozenset(out)
