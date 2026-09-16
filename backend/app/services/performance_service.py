"""
Performance reporting — who finishes work quickly, and where it sits waiting.

Three questions, one pass over the task history:

  members    how long a person takes to finish a task, on average
  approvers  how long a submitted task waits before someone signs it off
  verifiers  how long a named verifier sits on a task before responding

Everything is derived from `history` and `verifications` on the task itself,
so no extra bookkeeping is needed and the numbers can be recomputed for any
date range after the fact.

One subtlety worth knowing before reading the code: a *verification* also
writes a history row whose `to_status` is "pending_review" (the task is still
awaiting review after someone signs). Pairing on `to_status` would therefore
treat every sign-off as a fresh submission and collapse the measured waits to
near zero. Submissions are matched on `action == "pending_review"` instead —
the action says what happened, the status only says where it landed.
"""
from collections import defaultdict
from datetime import datetime, timezone, timedelta
from statistics import mean, median
from typing import Any

from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorDatabase

SUBMIT_ACTION = "pending_review"
APPROVE_ACTION = "approved"
REEDIT_ACTION = "reedit"

# A single task tells you nothing about a person's pace, so anyone below this
# is still listed (hiding people would misrepresent the team) but is left out
# of the ranking and flagged, so a one-off fluke can't top the table.
MIN_SAMPLE_FOR_RANK = 3


def _aware(dt: datetime | None) -> datetime | None:
    """Mongo hands back naive UTC; comparisons need a tz to avoid TypeError."""
    if not isinstance(dt, datetime):
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _submissions(task: dict) -> list[datetime]:
    """Every moment this task was actually submitted for review, in order."""
    out = [
        _aware(h.get("timestamp"))
        for h in (task.get("history") or [])
        if h.get("action") == SUBMIT_ACTION
    ]
    return sorted(d for d in out if d)


def _submission_before(subs: list[datetime], when: datetime) -> datetime | None:
    """
    The submission this event belongs to — the most recent one at or before it.

    A task can go round more than once (submitted, sent back to reedit, worked
    on, submitted again). Pairing an approval with the *first* submission would
    charge the approver for the days the work spent back with its author.
    """
    prior = [s for s in subs if s <= when]
    return prior[-1] if prior else None


class _Stat:
    """Running samples for one person, kept until we format the response."""

    __slots__ = ("samples", "extra")

    def __init__(self) -> None:
        self.samples: list[float] = []
        self.extra: dict[str, Any] = defaultdict(int)

    def add(self, seconds: float) -> None:
        # Clock skew between app servers can produce a negative interval; it is
        # noise, not a negative wait, and averaging it in would flatter someone.
        if seconds >= 0:
            self.samples.append(seconds)


def _summarise(stat: _Stat, count_key: str) -> dict:
    s = stat.samples
    return {
        count_key: len(s),
        "avg_seconds": round(mean(s)) if s else None,
        "median_seconds": round(median(s)) if s else None,
        "worst_seconds": round(max(s)) if s else None,
        **dict(stat.extra),
    }


def _rank(rows: list[dict], key: str, sample_key: str) -> list[dict]:
    """
    Fastest first. Anyone without enough history, or with nothing measurable,
    is sorted to the bottom and given no rank rather than a flattering one.
    """
    def sort_key(r: dict):
        v = r.get(key)
        thin = r.get(sample_key, 0) < MIN_SAMPLE_FOR_RANK
        return (v is None, thin, v if v is not None else 0)

    rows.sort(key=sort_key)
    n = 0
    for r in rows:
        if r.get(key) is not None and r.get(sample_key, 0) >= MIN_SAMPLE_FOR_RANK:
            n += 1
            r["rank"] = n
            r["ranked"] = True
        else:
            r["rank"] = None
            r["ranked"] = False
    return rows


async def build_performance_report(
    db: AsyncIOMotorDatabase,
    team_ids: list[str] | None,
    date_from: str = "",
    date_to: str = "",
) -> dict:
    """
    Build the whole report. `team_ids` of None means every team (elevated
    roles); a list restricts it to those teams (what a team leader may see).
    """
    now = datetime.now(timezone.utc)

    query: dict[str, Any] = {}
    if team_ids is not None:
        query["team_id"] = {"$in": team_ids}

    # The window is applied to the *event*, not the task, so a task created in
    # January still counts toward March if that is when it was approved.
    start = _parse_day(date_from)
    end = _parse_day(date_to, end_of_day=True)
    if start or end:
        rng: dict[str, Any] = {}
        if start:
            rng["$gte"] = start
        if end:
            rng["$lte"] = end
        # Cheap pre-filter; per-event filtering still happens below. Tasks whose
        # history is entirely outside the window can be skipped outright.
        query["updated_at"] = rng

    def in_window(dt: datetime) -> bool:
        if start and dt < start:
            return False
        if end and dt > end:
            return False
        return True

    members: dict[tuple[str, str], _Stat] = defaultdict(_Stat)
    approvers: dict[tuple[str, str], _Stat] = defaultdict(_Stat)
    verifiers: dict[tuple[str, str], _Stat] = defaultdict(_Stat)
    seen_users: set[str] = set()
    seen_teams: set[str] = set()

    projection = {
        "team_id": 1, "assigned_to": 1, "status": 1, "timing": 1,
        "history": 1, "verifications": 1, "due_date": 1, "created_at": 1,
    }
    cursor = db["project_tasks"].find(query, projection)

    async for task in cursor:
        team_id = task.get("team_id") or ""
        seen_teams.add(team_id)
        subs = _submissions(task)

        # ── The person doing the work ────────────────────────────────────────
        assignee = task.get("assigned_to") or ""
        if assignee:
            seen_users.add(assignee)
            m = members[(assignee, team_id)]
            done_at = _last_action(task, APPROVE_ACTION)
            if task.get("status") == "approved" and done_at and in_window(done_at):
                tracked = (task.get("timing") or {}).get("total_seconds")
                if tracked:
                    m.add(float(tracked))
                m.extra["completed"] += 1
                first_start = _first_action(task, "started")
                if first_start:
                    m.extra["turnaround_total"] += int((done_at - first_start).total_seconds())
                    m.extra["turnaround_n"] += 1
                due = _parse_day(task.get("due_date") or "", end_of_day=True)
                if due:
                    m.extra["on_time" if done_at <= due else "late"] += 1
            # Work sent back is the clearest signal of quality, so it is counted
            # against the person who did it regardless of when it finished.
            for h in task.get("history") or []:
                ts = _aware(h.get("timestamp"))
                if h.get("action") == REEDIT_ACTION and ts and in_window(ts):
                    m.extra["reedits"] += 1

        # ── The person approving ─────────────────────────────────────────────
        for h in task.get("history") or []:
            if h.get("action") != APPROVE_ACTION:
                continue
            ts = _aware(h.get("timestamp"))
            actor = h.get("actor_id") or ""
            if not ts or not actor or not in_window(ts):
                continue
            submitted = _submission_before(subs, ts)
            if not submitted:
                continue  # approved without ever being submitted — nothing to measure
            seen_users.add(actor)
            a = approvers[(actor, team_id)]
            a.add((ts - submitted).total_seconds())
            a.extra["approvals"] += 1

        # ── The people verifying ─────────────────────────────────────────────
        for v in task.get("verifications") or []:
            uid = v.get("user_id") or ""
            if not uid:
                continue
            at = _aware(v.get("at"))
            if at:
                if not in_window(at):
                    continue
                submitted = _submission_before(subs, at)
                if not submitted:
                    continue
                seen_users.add(uid)
                s = verifiers[(uid, team_id)]
                s.add((at - submitted).total_seconds())
                s.extra["signed_off"] += 1
                if v.get("status") == "rejected":
                    s.extra["rejected"] += 1
            elif task.get("status") == "pending_review" and subs:
                # Still sitting with them. This HAS to count: measuring only
                # completed sign-offs would rank someone who never responds as
                # the fastest verifier in the company.
                seen_users.add(uid)
                s = verifiers[(uid, team_id)]
                s.add((now - subs[-1]).total_seconds())
                s.extra["still_waiting"] += 1

    names = await _names(db, seen_users)
    team_names = await _team_names(db, seen_teams)

    teams = []
    for team_id in sorted(seen_teams, key=lambda t: team_names.get(t, "").lower()):
        member_rows = [
            row for row in (
                _member_row(uid, names, st)
                for (uid, tid), st in members.items() if tid == team_id
            ) if row
        ]
        approver_rows = [
            {"user_id": uid, "name": names.get(uid, "Unknown"),
             **_summarise(st, "approvals")}
            for (uid, tid), st in approvers.items() if tid == team_id
        ]
        verifier_rows = [
            {"user_id": uid, "name": names.get(uid, "Unknown"),
             **_summarise(st, "verifications")}
            for (uid, tid), st in verifiers.items() if tid == team_id
        ]
        if not (member_rows or approver_rows or verifier_rows):
            continue
        teams.append({
            "team_id": team_id,
            "team_name": team_names.get(team_id) or ("No team" if not team_id else "Deleted team"),
            "members":   _rank(member_rows,   "avg_seconds", "completed"),
            "approvers": _rank(approver_rows, "avg_seconds", "approvals"),
            "verifiers": _rank(verifier_rows, "avg_seconds", "verifications"),
        })

    return {"teams": teams, "generated_at": now.isoformat(), "min_sample": MIN_SAMPLE_FOR_RANK}


def _member_row(uid: str, names: dict, st: _Stat) -> dict | None:
    """None when this person has nothing to show in the window — an empty row
    is worse than no row, since it reads as "finished nothing" rather than
    "wasn't working here then"."""
    e = st.extra
    if not (st.samples or e.get("completed") or e.get("reedits")):
        return None
    row = {"user_id": uid, "name": names.get(uid, "Unknown"), **_summarise(st, "measured")}
    tn = e.get("turnaround_n", 0)
    row["avg_turnaround_seconds"] = round(e["turnaround_total"] / tn) if tn else None
    on_time, late = e.get("on_time", 0), e.get("late", 0)
    row["on_time_rate"] = round(on_time * 100 / (on_time + late)) if (on_time + late) else None
    # Accumulators, not results — they exist to produce the two fields above.
    for k in ("turnaround_total", "turnaround_n", "on_time", "late"):
        row.pop(k, None)
    return row


def _first_action(task: dict, action: str) -> datetime | None:
    stamps = sorted(
        d for d in (_aware(h.get("timestamp")) for h in (task.get("history") or [])
                    if h.get("action") == action) if d
    )
    return stamps[0] if stamps else None


def _last_action(task: dict, action: str) -> datetime | None:
    stamps = sorted(
        d for d in (_aware(h.get("timestamp")) for h in (task.get("history") or [])
                    if h.get("action") == action) if d
    )
    return stamps[-1] if stamps else None


def _parse_day(value: str, end_of_day: bool = False) -> datetime | None:
    if not value:
        return None
    try:
        d = datetime.strptime(value[:10], "%Y-%m-%d").replace(tzinfo=timezone.utc)
    except ValueError:
        return None
    return d + timedelta(days=1) - timedelta(microseconds=1) if end_of_day else d


async def _names(db: AsyncIOMotorDatabase, user_ids: set[str]) -> dict[str, str]:
    valid = [ObjectId(u) for u in user_ids if ObjectId.is_valid(u)]
    if not valid:
        return {}
    rows = await db["users"].find(
        {"_id": {"$in": valid}}, {"name": 1, "email": 1}
    ).to_list(1000)
    return {str(r["_id"]): (r.get("name") or r.get("email") or "Unknown") for r in rows}


async def _team_names(db: AsyncIOMotorDatabase, team_ids: set[str]) -> dict[str, str]:
    valid = [ObjectId(t) for t in team_ids if ObjectId.is_valid(t)]
    if not valid:
        return {}
    rows = await db["teams"].find({"_id": {"$in": valid}}, {"name": 1}).to_list(500)
    return {str(r["_id"]): r.get("name", "") for r in rows}
