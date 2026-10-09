"""
Task factory — the one path every new task is born through.

`raise_task` holds what used to live inline in `POST /projects` (add_task):
required-field checks, assignment and approver rules, the default verifier,
the insert, notifications and the chat DM. It was moved here, unchanged, so
that the other ways a task comes into being use exactly the same rules:

  • POST /projects            — one task, one person (the original path)
  • POST /projects/batch      — one task fanned out to several people
  • the repeating-task scheduler, spawning each copy of a series

If any of them built tasks on their own, an auto-created task could quietly
skip a rule a hand-made one follows. Keep task-creation rules HERE.
"""
from motor.motor_asyncio import AsyncIOMotorDatabase


class TaskRaiseError(Exception):
    """A request that must not create a task. Carries the HTTP status to answer with."""

    def __init__(self, message: str, status_code: int = 422):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


async def raise_task(db: AsyncIOMotorDatabase, data: dict, current_user: dict) -> dict:
    """
    Validate, create, and announce one task on behalf of `current_user`.

    `data` is the CreateTaskRequest payload as a dict (it is modified in place).
    Returns the serialized task. Raises TaskRaiseError when the task is refused.
    """
    from bson import ObjectId

    from app.routers.projects import _fire_notifications
    from app.services import workflow
    from app.services.project_service import create_task

    data["created_by"] = str(current_user["_id"])
    data["actor_name"] = current_user.get("name", "")
    data["status"] = "pending"  # new work always enters the workflow at Pending

    # ── Required fields ───────────────────────────────────────────────────────
    # A task is only actionable when someone owns it, in a team, by a date.
    # Enforced here (not just in the UI) so the API can't create orphan work.
    if not (data.get("title") or "").strip():
        raise TaskRaiseError("Task name is required.", 422)
    # A team is the home board a leader reviews, so raising work for someone
    # else still needs one. Work you take on yourself does not: requiring a team
    # meant an employee on no team could not create a single task, and nobody
    # could jot down their own to-do without filing it under someone's board.
    if not (data.get("team_id") or "").strip():
        if (data.get("assigned_to") or "").strip() != str(current_user["_id"]):
            raise TaskRaiseError("Please select a team.", 422)
    if not (data.get("due_date") or "").strip():
        raise TaskRaiseError("Please set a due date.", 422)

    # Any member of the team may raise work for a colleague, same as an admin or
    # coordinator. The approver gate below stays stricter on purpose.
    if not await workflow.can_assign_task(current_user, data.get("team_id"), db):
        data["assigned_to"] = str(current_user["_id"])
        data["assigned_to_name"] = current_user.get("name", "")

    assignee = (data.get("assigned_to") or "").strip()
    if not assignee:
        raise TaskRaiseError("Please assign this task to someone.", 422)

    # The assignee no longer has to belong to the chosen team — work is raised
    # across team lines. They still see it: "own" visibility matches on
    # assigned_to, not on team. The team remains the task's home board, which is
    # what the team's leader reviews.
    #
    # Still verified to exist, so a bad id can't create a task nobody holds.
    if ObjectId.is_valid(data["team_id"]):
        team = await db["teams"].find_one({"_id": ObjectId(data["team_id"])}, {"members": 1})
        if not team:
            raise TaskRaiseError("That team no longer exists.", 422)
    if not ObjectId.is_valid(assignee) or not await db["users"].find_one(
        {"_id": ObjectId(assignee)}, {"_id": 1}
    ):
        raise TaskRaiseError("That user no longer exists.", 422)

    # ── Named approver ────────────────────────────────────────────────────────
    # Designating an approver grants approval rights, so it is a leader/admin
    # action. A member creating their own task must never be able to name
    # themselves approver — that would let them approve their own work.
    approver_id = (data.get("approver_id") or "").strip()
    if approver_id:
        if not await workflow.can_assign_to_others(current_user, data.get("team_id"), db):
            raise TaskRaiseError("Only a team leader can choose who approves a task.", 403)
        if not await workflow.is_team_member(db, data["team_id"], approver_id):
            raise TaskRaiseError(
                "The approver must be a leader or member of the selected team.", 422
            )
        data["approver_id"] = approver_id
    else:
        data.pop("approver_id", None)
        data.pop("approver_name", None)

    # ── Project (optional) — which ad account the work is for ─────────────────
    # The name is looked up here, never taken from the request, and stored with
    # the id so the task still reads right if the project is renamed later.
    from app.services import task_project_service as tps
    try:
        project = await tps.resolve(db, data.pop("project_id", None))
    except tps.ProjectError as exc:
        raise TaskRaiseError(exc.message, exc.status_code)
    data.pop("project_name", None)
    if project:
        data["project_id"], data["project_name"] = str(project["_id"]), project.get("name", "")

    # ── Whoever raised the work checks the result ─────────────────────────────
    # Unless they said otherwise, the creator is named a verifier, so nothing
    # they asked for is approved without them having seen what came back.
    #
    # Skipped when they could approve it themselves: a leader who raises work
    # for their own team already signs it off at the end, and asking them to
    # verify first only makes them sign the same task twice.
    #
    # Raising work for yourself needs no special case — resolve_verifiers drops
    # the assignee when the list is expanded, because signing off your own work
    # is the thing verification exists to prevent.
    # `is None` rather than falsy: an empty list is somebody saying "nobody",
    # which is a decision and not the absence of one. Treating the two alike
    # made the default impossible to remove.
    if data.get("verify_users") is None and data.get("verify_teams") is None:
        creator_may_approve = await workflow.can_approve(
            current_user,
            {
                "team_id": data.get("team_id"),
                "assigned_to": assignee,
                "approver_id": data.get("approver_id", ""),
            },
            db,
        )
        if not creator_may_approve:
            data["verify_users"] = [str(current_user["_id"])]

    task = await create_task(db, data)

    await _fire_notifications(
        db, task, "created",
        str(current_user["_id"]),
        current_user.get("name", ""),
    )

    # Chat DM: notify the assignee + creator when work is assigned on creation
    if task.get("assigned_to"):
        from app.services import chat_notify
        await chat_notify.dm_task_assigned(
            db, task, str(current_user["_id"]), current_user.get("name", "")
        )

    return task
