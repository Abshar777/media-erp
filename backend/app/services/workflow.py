"""
Project task workflow state machine.

Fixed columns:  pending -> started -> (break) -> pending_review -> approved
                                         \-> reedit <-/  (leader sends back)

Rules:
  - pending        -> started
  - started        -> break | pending_review
  - break          -> started
  - reedit         -> started               (member picks the rework back up)
  - pending_review -> approved | reedit      (leader/admin only — approve or send to reedit)
  - approved       -> (terminal)

  - Only ONE task per assignee may be in "started"; moving a task into started
    bumps that assignee's other started task to "break".
  - Nothing returns to "pending" — that is only the entry point for new work.
    A leader rejecting a review sends it to "reedit", not "pending".
"""
from datetime import datetime, timezone

from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorDatabase

ALLOWED_TRANSITIONS: dict[str, set[str]] = {
    "pending":        {"started", "reedit"},   # leader can return a routed task to reedit
    "started":        {"break", "pending_review"},
    "break":          {"started"},
    "reedit":         {"started"},
    "pending_review": {"approved", "reedit"},
    "approved":       set(),
}

# Transitions out of pending_review (approve / send-to-rework) are leader-only.
LEADER_ONLY_FROM = {"pending_review"}


def is_allowed(current: str, target: str) -> bool:
    if current == target:
        return True
    return target in ALLOWED_TRANSITIONS.get(current, set())


def transition_error(current: str, target: str) -> str:
    labels = {
        "pending": "Pending", "started": "Started", "break": "Break",
        "reedit": "Reedit", "pending_review": "Pending Review", "approved": "Approved",
    }
    c = labels.get(current, current)
    t = labels.get(target, target)
    if target == "pending":
        return (f"Can't move {c} to Pending. Pending is only for brand-new work — "
                f"a leader rejecting a review sends it to Reedit instead.")
    if target == "approved" and current != "pending_review":
        return "Tasks can only be Approved from Pending Review (a leader approves them)."
    if target == "reedit" and current not in ("pending_review", "pending"):
        return "A task only goes to Reedit from Pending Review or when a leader returns a routed task."
    return f"Invalid move: {c} -> {t}."


async def can_approve(current_user: dict, task: dict, db: AsyncIOMotorDatabase) -> bool:
    """
    True if the user may approve / rework a pending_review task.

    Allowed for: Super Admin / Admin / Coordinator, the task's named approver,
    or a leader of the task's team.

    A named approver is *additive* — leaders keep their rights on the task. If
    the approver goes away or leaves the team, the task must still be
    approvable by someone, or it strands in pending_review with no way out.
    """
    role_doc  = current_user.get("_role") or {}
    role_name = role_doc.get("role_name", "")
    if role_name in ("Super Admin", "Admin", "Coordinator"):
        return True
    uid = str(current_user["_id"])
    # Named approver — deliberately may be an ordinary member, not just a leader.
    if task.get("approver_id") and task.get("approver_id") == uid:
        return True
    team_id = task.get("team_id")
    if not team_id:
        return True  # personal (non-team) task — no leader gate
    try:
        team = await db["teams"].find_one({"_id": ObjectId(team_id)})
    except Exception:
        team = None
    if not team:
        return False
    return any(
        m.get("user_id") == uid and m.get("role") == "leader"
        for m in team.get("members", [])
    )


async def can_assign_to_others(current_user: dict, team_id, db: AsyncIOMotorDatabase) -> bool:
    """
    True if the user may assign a task to someone else.
    Allowed for: Super Admin / Admin / Coordinator, or the leader of the given team.
    Regular members (and anyone on a personal/no-team task) may only self-assign.
    """
    role_doc  = current_user.get("_role") or {}
    role_name = role_doc.get("role_name", "")
    if role_name in ("Super Admin", "Admin", "Coordinator"):
        return True
    if not team_id:
        return False
    try:
        team = await db["teams"].find_one({"_id": ObjectId(team_id)})
    except Exception:
        team = None
    if not team:
        return False
    uid = str(current_user["_id"])
    return any(
        m.get("user_id") == uid and m.get("role") == "leader"
        for m in team.get("members", [])
    )


async def is_team_member(db: AsyncIOMotorDatabase, team_id, user_id: str) -> bool:
    """
    True when user_id is on the team's member list (leader or member).

    Used to keep a task's named approver inside its own team — otherwise any
    user id could be written into approver_id and gain approval rights on a
    team they have nothing to do with.
    """
    if not team_id or not user_id:
        return False
    try:
        team = await db["teams"].find_one({"_id": ObjectId(team_id)}, {"members": 1})
    except Exception:
        return False
    if not team:
        return False
    return any(m.get("user_id") == user_id for m in team.get("members", []))


def apply_timing(
    current_status: str,
    new_status: str,
    timing: dict | None,
    now: datetime,
) -> dict:
    """
    Return an updated timing dict for a status transition.

    intervals: list of {started_at, ended_at} — ended_at is None while running.
    total_seconds: set only when the task reaches 'approved'.
    """
    timing = timing or {"intervals": [], "total_seconds": None}
    intervals = [dict(iv) for iv in timing.get("intervals", [])]

    if new_status == "started":
        intervals.append({"started_at": now, "ended_at": None})

    elif new_status in ("break", "pending_review", "reedit"):
        # Pause — close the most recent open interval
        for i in reversed(range(len(intervals))):
            if intervals[i].get("ended_at") is None:
                intervals[i]["ended_at"] = now
                break

    elif new_status == "approved":
        # End — close open interval then sum all
        for i in reversed(range(len(intervals))):
            if intervals[i].get("ended_at") is None:
                intervals[i]["ended_at"] = now
                break
        total = 0
        for iv in intervals:
            s, e = iv.get("started_at"), iv.get("ended_at")
            if s and e:
                total += int((e - s).total_seconds())
        return {"intervals": intervals, "total_seconds": total}

    return {"intervals": intervals, "total_seconds": timing.get("total_seconds")}


async def bump_other_started(db: AsyncIOMotorDatabase, task: dict) -> None:
    """
    Enforce "one started task per person": move the assignee's OTHER started
    task(s) to break and pause their timers.

    Scoped strictly to the **assignee**. It previously fell back to the whole
    TEAM when a task had no assignee — so starting one unassigned task silently
    knocked every other in-progress task in that team into Break, and people
    watched tasks vanish from the Started column. An unassigned task belongs to
    nobody, so there is no per-person rule to enforce: do nothing.
    """
    assignee = (task.get("assigned_to") or "").strip()
    if not assignee:
        return  # unassigned work has no owner — never bump anyone else's tasks

    q: dict = {
        "status": "started",
        "_id": {"$ne": task["_id"]},
        "assigned_to": assignee,
    }

    now = datetime.now(timezone.utc)
    bumped = await db["project_tasks"].find(q).to_list(200)
    for t in bumped:
        timing = apply_timing("started", "break", t.get("timing"), now)
        await db["project_tasks"].update_one(
            {"_id": t["_id"]},
            {"$set": {"status": "break", "updated_at": now, "timing": timing}},
        )
