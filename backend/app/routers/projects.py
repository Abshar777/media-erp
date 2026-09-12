"""
Projects / Kanban router.

Visibility rules:
  - Super admin (role="admin"):  sees ALL tasks
  - Team leader:                 sees all tasks in their teams
  - Regular member:              sees only tasks assigned to them

Endpoints
---------
  GET    /api/v1/projects          — list tasks (visibility-filtered)
  POST   /api/v1/projects          — create task
  PUT    /api/v1/projects/{id}     — update task / move column
  DELETE /api/v1/projects/{id}     — delete task
"""

import math

from fastapi import APIRouter, Depends, Query
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.database import get_db
from app.middleware.auth import get_current_user
from app.schemas.project import CreateTaskRequest, UpdateTaskRequest
from app.services.project_service import (
    create_task,
    delete_task,
    list_tasks,
    update_task,
)
from app.utils.response import error_response, success_response

router = APIRouter(prefix="/api/v1/projects", tags=["projects"])


async def _fire_notifications(
    db,
    task: dict,
    event: str,
    actor_id: str,
    actor_name: str,
) -> None:
    """
    Create notifications for the right recipients based on a task event.

    Events
    ------
    created          → team leaders get team_task_assigned; assigned employee gets task_assigned
    assigned         → assigned employee gets task_assigned
    started          → team leaders get task_started
    break            → team leaders get task_break
    pending_review   → team leaders + admins/coordinator/super-admin get pending_review
    approved         → assigned employee + elevated roles get task_approved
    reedit           → assigned employee + elevated roles get task_reedit
    """
    from bson import ObjectId
    from app.services.notification_service import push_notification
    from app.services import whatsapp_service as wa

    assigned_to   = task.get("assigned_to") or ""
    assigned_name = task.get("assigned_to_name") or "Someone"
    team_id       = task.get("team_id") or ""
    task_id       = task.get("id") or str(task.get("_id", ""))
    task_title    = task.get("title") or "Task"
    reedit_reason = task.get("reedit_reason") or ""
    due_date      = task.get("due_date") or "Not set"
    meta          = {"task_id": task_id, "task_title": task_title, "team_id": team_id}

    # Fetch assigned user's WhatsApp phone (optional — skipped if not set)
    assigned_phone = ""
    if assigned_to and ObjectId.is_valid(assigned_to):
        _u = await db["users"].find_one({"_id": ObjectId(assigned_to)}, {"whatsapp_phone": 1})
        if _u:
            assigned_phone = _u.get("whatsapp_phone") or ""

    # ── 1. Notify assigned employee ───────────────────────────────────────────
    if event in ("created", "assigned") and assigned_to and assigned_to != actor_id:
        await push_notification(
            db, assigned_to, "task_assigned",
            "New task assigned to you",
            f'"{task_title}" has been assigned to you.',
            meta,
        )
        if assigned_phone:
            try:
                await wa.notify_task_assigned(assigned_phone, assigned_name, task_title, due_date)
            except Exception as _wa_err:
                print(f"[WA] task_assigned fire failed: {_wa_err}", flush=True)

    elif event == "pending_review" and assigned_to and assigned_to != actor_id:
        # Leader submitted the task on the employee's behalf — tell them
        await push_notification(
            db, assigned_to, "pending_review",
            "Your task is now in review",
            f'"{task_title}" has been submitted for review.',
            meta,
        )

    elif event == "approved" and assigned_to:
        await push_notification(
            db, assigned_to, "task_approved",
            "Task approved ✓",
            f'Your task "{task_title}" has been approved!',
            meta,
        )
        if assigned_phone:
            try:
                await wa.notify_task_approved(assigned_phone, assigned_name, task_title, actor_name)
            except Exception as _wa_err:
                print(f"[WA] task_approved fire failed: {_wa_err}", flush=True)

    elif event == "reedit" and assigned_to:
        suffix = f" Reason: {reedit_reason}" if reedit_reason else ""
        await push_notification(
            db, assigned_to, "task_reedit",
            "Task sent back for revision",
            f'"{task_title}" needs revision.{suffix}',
            meta,
        )
        if assigned_phone:
            try:
                await wa.notify_task_reedit(assigned_phone, assigned_name, task_title, actor_name, reedit_reason)
            except Exception as _wa_err:
                print(f"[WA] task_reedit fire failed: {_wa_err}", flush=True)

    # ── 2. Notify team leader(s) ──────────────────────────────────────────────
    leader_ids: list[str] = []
    team_member_ids: list[str] = []
    if team_id and ObjectId.is_valid(team_id):
        team_doc = await db["teams"].find_one({"_id": ObjectId(team_id)})
        if team_doc:
            team_member_ids = [m["user_id"] for m in team_doc.get("members", [])]
            leader_ids = [
                m["user_id"]
                for m in team_doc.get("members", [])
                if m.get("role") == "leader" and m["user_id"] != actor_id
            ]

    leader_notif = {
        "created":        ("team_task_assigned", "New task in your team",
                           f'A new task "{task_title}" was added to your team.'),
        "started":        ("task_started", "Employee started a task",
                           f'{assigned_name} started working on "{task_title}".'),
        "break":          ("task_break", "Employee took a break",
                           f'{assigned_name} paused work on "{task_title}".'),
        "pending_review": ("pending_review", "Task ready for review",
                           f'{assigned_name} submitted "{task_title}" for your review.'),
    }
    if event in leader_notif:
        ntype, ntitle, nmsg = leader_notif[event]
        for lid in leader_ids:
            await push_notification(db, lid, ntype, ntitle, nmsg, meta)

    # A named approver may be an ordinary member, so they are not in leader_ids
    # and would otherwise never hear that work is waiting on them.
    if event == "pending_review":
        approver_id = task.get("approver_id") or ""
        if approver_id and approver_id != actor_id and approver_id not in leader_ids:
            await push_notification(
                db, approver_id, "pending_review", "Task awaiting your approval",
                f'{assigned_name} submitted "{task_title}" for your approval.', meta,
            )

    # ── 3. Notify elevated roles (Admin, Coordinator, Super Admin) ────────────
    # "created" — new task in any team (so admins can see it in Assign Work)
    # "pending_review" / "approved" / "reedit" — workflow oversight
    if event in ("created", "pending_review", "approved", "reedit"):
        elevated_roles = await db["roles"].find({
            "is_system_role": True,
            "role_name": {"$in": ["Admin", "Coordinator", "Super Admin"]},
        }).to_list(20)
        role_id_strs = [str(r["_id"]) for r in elevated_roles]
        # Map role_id → role_name so we can scope Coordinators to their own teams.
        role_name_by_id = {str(r["_id"]): r.get("role_name", "") for r in elevated_roles}
        if role_id_strs:
            elevated_users = await db["users"].find(
                {"role_id": {"$in": role_id_strs}, "is_active": {"$ne": False}}
            ).to_list(200)

            elevated_notif = {
                "created":        ("team_task_assigned", "New task assigned to a team",
                                   f'A new task "{task_title}" is waiting to be assigned.'),
                "pending_review": ("pending_review", "Task awaiting review",
                                   f'{assigned_name} submitted "{task_title}" for review.'),
                "approved":       ("task_approved", "Task approved",
                                   f'"{task_title}" was approved by {actor_name}.'),
                "reedit":         ("task_reedit", "Task sent for revision",
                                   f'"{task_title}" was sent back for revision by {actor_name}.'),
            }
            ntype, ntitle, nmsg = elevated_notif[event]
            for u in elevated_users:
                uid = str(u["_id"])
                if uid in (actor_id, assigned_to) or uid in leader_ids:
                    continue  # avoid duplicate / self-notify
                # Coordinators only oversee the teams they belong to; Admin and
                # Super Admin stay global (company-wide oversight).
                if role_name_by_id.get(u.get("role_id", "")) == "Coordinator" and uid not in team_member_ids:
                    continue
                await push_notification(db, uid, ntype, ntitle, nmsg, meta)


async def _resolve_visibility(current_user: dict, team_id: str, db: AsyncIOMotorDatabase):
    """
    Return (visibility, uid, leader_team_ids).

    visibility levels
    -----------------
    "all"          → no restriction (Super Admin / Admin / Coordinator)
    "team"         → all tasks in one specific team (Team Leader of that team)
    "leader_teams" → tasks in every team the caller leads (Team Leader, no team_id filter)
    "own"          → only tasks assigned to uid (Employee / member)

    leader_team_ids is set only when visibility == "leader_teams".
    """
    from bson import ObjectId
    from bson.errors import InvalidId

    uid       = str(current_user["_id"])
    role_doc  = current_user.get("_role") or {}
    role_name = role_doc.get("role_name", "")

    # ── Elevated roles see everything ─────────────────────────────────────────
    if role_name in ("Super Admin", "Admin", "Coordinator"):
        return "all", uid, None

    # ── Team Leader — scoped to teams they lead ───────────────────────────────
    if role_name == "Team Leader":
        if team_id:
            # Specific team requested — check whether they lead it
            try:
                team = await db["teams"].find_one({"_id": ObjectId(team_id)})
            except (InvalidId, Exception):
                team = None
            if team:
                for m in team.get("members", []):
                    if m["user_id"] == uid:
                        if m["role"] == "leader":
                            return "team", uid, None    # sees all tasks in that team
                        else:
                            return "own", uid, None     # member → own tasks only
            return "own", uid, None
        else:
            # No team filter — collect all teams where they are leader
            leader_teams = await db["teams"].find(
                {"members": {"$elemMatch": {"user_id": uid, "role": "leader"}}}
            ).to_list(500)
            if leader_teams:
                ids = [str(t["_id"]) for t in leader_teams]
                return "leader_teams", uid, ids
            return "own", uid, None

    # ── Employee / other — own tasks only ─────────────────────────────────────
    return "own", uid, None


@router.get("")
async def get_tasks(
    search: str = Query(default=""),
    status: str = Query(default=""),
    priority: str = Query(default=""),
    date_filter: str = Query(default=""),
    date_from: str = Query(default=""),
    date_to: str = Query(default=""),
    team_id: str = Query(default=""),
    member_id: str = Query(default=""),
    # Pagination (mirrors /users). limit=0 keeps the legacy "return everything
    # up to the safety ceiling" behaviour so existing callers are unaffected.
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=0, ge=0, le=500),
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    visibility, uid, leader_team_ids = await _resolve_visibility(current_user, team_id, db)

    # Member filter — only allowed for elevated roles or team leaders.
    # A regular member is locked to their own tasks regardless of this param.
    if member_id and visibility in ("all", "team", "leader_teams"):
        visibility       = "own"   # reuse own-filter logic
        uid              = member_id
        leader_team_ids  = None    # clear team scope

    tasks, total = await list_tasks(
        db,
        search=search,
        status=status,
        priority=priority,
        date_filter=date_filter,
        date_from=date_from,
        date_to=date_to,
        team_id=team_id,
        visibility=visibility,
        user_id=uid,
        leader_team_ids=leader_team_ids or [],
        page=page,
        limit=limit,
    )

    # `data` stays a plain array so existing callers keep working; pagination
    # lives in `meta`. With limit=0 this degrades to "everything up to the
    # ceiling", which is the pre-pagination behaviour.
    if limit and limit > 0:
        pages = max(1, math.ceil(total / limit))
        has_more = page < pages
    else:
        pages, has_more = 1, total > len(tasks)

    return success_response(
        data=tasks,
        message=(
            f"Showing {len(tasks)} of {total} tasks" if has_more or total > len(tasks)
            else "Tasks retrieved"
        ),
        meta={
            "total": total,
            "returned": len(tasks),
            "page": page,
            "limit": limit,
            "pages": pages,
            "has_more": has_more,
            # true when the caller is NOT paging and we still had to cut the list
            "truncated": (not limit) and total > len(tasks),
        },
    )


@router.post("", status_code=201)
async def add_task(
    body: CreateTaskRequest,
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    from app.services import workflow
    from bson import ObjectId

    data = body.model_dump()
    data["created_by"] = str(current_user["_id"])
    data["actor_name"] = current_user.get("name", "")
    data["status"] = "pending"  # new work always enters the workflow at Pending

    # ── Required fields ───────────────────────────────────────────────────────
    # A task is only actionable when someone owns it, in a team, by a date.
    # Enforced here (not just in the UI) so the API can't create orphan work.
    if not (data.get("title") or "").strip():
        return error_response("Task name is required.", status_code=422)
    if not (data.get("team_id") or "").strip():
        return error_response("Please select a team.", status_code=422)
    if not (data.get("due_date") or "").strip():
        return error_response("Please set a due date.", status_code=422)

    # Any member of the team may raise work for a colleague, same as an admin or
    # coordinator. The approver gate below stays stricter on purpose.
    if not await workflow.can_assign_task(current_user, data.get("team_id"), db):
        data["assigned_to"] = str(current_user["_id"])
        data["assigned_to_name"] = current_user.get("name", "")

    assignee = (data.get("assigned_to") or "").strip()
    if not assignee:
        return error_response("Please assign this task to someone.", status_code=422)

    # The assignee no longer has to belong to the chosen team — work is raised
    # across team lines. They still see it: "own" visibility matches on
    # assigned_to, not on team. The team remains the task's home board, which is
    # what the team's leader reviews.
    #
    # Still verified to exist, so a bad id can't create a task nobody holds.
    if ObjectId.is_valid(data["team_id"]):
        team = await db["teams"].find_one({"_id": ObjectId(data["team_id"])}, {"members": 1})
        if not team:
            return error_response("That team no longer exists.", status_code=422)
    if not ObjectId.is_valid(assignee) or not await db["users"].find_one(
        {"_id": ObjectId(assignee)}, {"_id": 1}
    ):
        return error_response("That user no longer exists.", status_code=422)

    # ── Named approver ────────────────────────────────────────────────────────
    # Designating an approver grants approval rights, so it is a leader/admin
    # action. A member creating their own task must never be able to name
    # themselves approver — that would let them approve their own work.
    approver_id = (data.get("approver_id") or "").strip()
    if approver_id:
        if not await workflow.can_assign_to_others(current_user, data.get("team_id"), db):
            return error_response(
                "Only a team leader can choose who approves a task.", status_code=403
            )
        if not await workflow.is_team_member(db, data["team_id"], approver_id):
            return error_response(
                "The approver must be a leader or member of the selected team.",
                status_code=422,
            )
        data["approver_id"] = approver_id
    else:
        data.pop("approver_id", None)
        data.pop("approver_name", None)

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

    return success_response(data=task, message="Task created", status_code=201)


@router.get("/leader/queue")
async def leader_queue(
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """
    Leader Desk feed (team leaders + admins):
      - review:   pending_review tasks from teams the user leads
      - incoming: new (pending) **unassigned** work in those teams — the
                  "Assign Work" queue, i.e. work still waiting to be distributed
      - teams:    the led teams with their members (for the assign dropdown)
    """
    from bson import ObjectId
    from app.services.project_service import _serialize

    uid = str(current_user["_id"])
    role_doc   = current_user.get("_role") or {}
    role_name  = role_doc.get("role_name", "")
    # SA / Admin / Coordinator see all teams' queues; Team Leaders see only their led teams
    is_elevated = role_name in ("Super Admin", "Admin", "Coordinator")

    if is_elevated:
        teams = await db["teams"].find({}).to_list(500)
    else:
        teams = await db["teams"].find(
            {"members": {"$elemMatch": {"user_id": uid, "role": "leader"}}}
        ).to_list(500)

    if not teams:
        return success_response(
            data={"is_leader": is_elevated, "review": [], "incoming": [], "reedit": [], "teams": []},
            message="Leader queue",
        )

    team_ids = [str(t["_id"]) for t in teams]

    # Resolve member names for the assign dropdown
    member_ids = {m["user_id"] for t in teams for m in t.get("members", [])}
    valid = [ObjectId(i) for i in member_ids if ObjectId.is_valid(i)]
    users = await db["users"].find({"_id": {"$in": valid}}, {"name": 1, "email": 1}).to_list(1000)
    name_map = {str(u["_id"]): (u.get("name") or u.get("email", "")) for u in users}

    teams_out = [{
        "id": str(t["_id"]),
        "name": t.get("name", ""),
        "color": t.get("color", "#6366f1"),
        "members": [
            {"id": m["user_id"], "name": name_map.get(m["user_id"], ""), "role": m.get("role", "member")}
            for m in t.get("members", [])
        ],
    } for t in teams]

    review = await db["project_tasks"].find(
        {"status": "pending_review", "team_id": {"$in": team_ids}}
    ).sort("updated_at", -1).to_list(500)

    # Only work that is still UNASSIGNED belongs in the "Assign Work" queue.
    # Once a leader assigns a task — including to themselves — it is distributed
    # and leaves this queue, showing up on the assignee's board instead.
    # (Previously this also matched `assigned_to == uid`, which trapped a
    #  leader's self-assigned work here forever and made self-assign look broken.)
    incoming = await db["project_tasks"].find({
        "status": "pending",
        "team_id": {"$in": team_ids},
        "assigned_to": {"$in": ["", None]},
    }).sort("created_at", -1).to_list(500)

    # Reedit desk — tasks returned for revision that now live in one of this
    # leader's teams. When a leader routes a task to another team and that team
    # sends it back to reedit, it is returned to the routing leader's team (see
    # edit_task), so it surfaces here for the leader who originally routed it.
    reedit = await db["project_tasks"].find(
        {"status": "reedit", "team_id": {"$in": team_ids}}
    ).sort("updated_at", -1).to_list(500)

    return success_response(
        data={
            "is_leader": True,
            "review":   [_serialize(t) for t in review],
            "incoming": [_serialize(t) for t in incoming],
            "reedit":   [_serialize(t) for t in reedit],
            "teams":    teams_out,
        },
        message="Leader queue",
    )



@router.get("/{task_id}")
async def get_task_detail(
    task_id: str,
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """
    Full detail for a single task (used by the detail modal, incl. from chat
    task references). Visible to elevated roles, the assignee, the creator, or
    any member of the task's team.
    """
    from bson import ObjectId
    from bson.errors import InvalidId
    from app.services.project_service import _serialize

    try:
        oid = ObjectId(task_id)
    except InvalidId:
        return error_response("Invalid task ID", status_code=422)
    doc = await db["project_tasks"].find_one({"_id": oid})
    if not doc:
        return error_response("Task not found", status_code=404)

    uid = str(current_user["_id"])
    role_name = (current_user.get("_role") or {}).get("role_name", "")
    allowed = role_name in ("Super Admin", "Admin", "Coordinator")
    if not allowed and uid in (doc.get("assigned_to", ""), doc.get("created_by", "")):
        allowed = True
    if not allowed and doc.get("team_id") and ObjectId.is_valid(doc["team_id"]):
        team = await db["teams"].find_one({"_id": ObjectId(doc["team_id"])}, {"members": 1})
        if team and any(m.get("user_id") == uid for m in team.get("members", [])):
            allowed = True
    if not allowed:
        return error_response("You don't have access to this task", status_code=403)

    # Aggregate the full routing-chain history (across every team the task
    # passed through) plus a compact team-flow summary.
    from app.services.project_service import get_chain_history
    merged_history, team_flow = await get_chain_history(db, doc)
    out = _serialize(doc)
    out["history"] = merged_history
    out["team_flow"] = team_flow
    return success_response(data=out, message="Task retrieved")


@router.put("/{task_id}")
async def edit_task(
    task_id: str,
    body: UpdateTaskRequest,
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    from bson import ObjectId
    from bson.errors import InvalidId
    from app.services import workflow

    updates = body.model_dump(exclude_none=True)
    new_status = updates.get("status")
    destination_team_id = updates.pop("destination_team_id", None)
    next_leader_id   = updates.pop("next_leader_id", None)
    next_leader_name = updates.pop("next_leader_name", None)
    next_approver_id   = updates.pop("next_approver_id", None)
    next_approver_name = updates.pop("next_approver_name", None)
    transfer_to_id   = updates.pop("transfer_to_id", None)
    transfer_to_name = updates.pop("transfer_to_name", None)
    transfer_reason  = (updates.pop("transfer_reason", "") or "").strip()

    try:
        oid = ObjectId(task_id)
    except InvalidId:
        return error_response("Invalid task ID", status_code=422)
    current = await db["project_tasks"].find_one({"_id": oid})
    if not current:
        return error_response("Task not found", status_code=404)
    cur_status = current.get("status", "pending")

    # Enforce the workflow state machine on any status change
    if new_status and new_status != cur_status:
        if not workflow.is_allowed(cur_status, new_status):
            return error_response(workflow.transition_error(cur_status, new_status), status_code=400)
        # Approve / send-to-reedit (leaving pending_review) is leader/admin only
        if cur_status in workflow.LEADER_ONLY_FROM:
            if not await workflow.can_approve(current_user, current, db):
                return error_response(
                    "Only a team leader can approve a task or send it to reedit.",
                    status_code=403,
                )
        # Sending to reedit requires a reason
        if new_status == "reedit":
            if not (updates.get("reedit_reason") or "").strip():
                return error_response("Please add a reason for sending this task to reedit.", status_code=400)
        else:
            # leaving/entering any other state clears a stale reedit reason
            updates.setdefault("reedit_reason", "")
        # "one started task per person" — bump the assignee's other started task
        if new_status == "started":
            await workflow.bump_other_started(db, current)

        # Apply timing update for this transition
        from datetime import datetime, timezone as tz
        updates["timing"] = workflow.apply_timing(
            cur_status, new_status, current.get("timing"), datetime.now(tz.utc)
        )

    # Reassigning is open to anyone on the task's team.
    if "assigned_to" in updates and updates["assigned_to"] != current.get("assigned_to"):
        if not await workflow.can_assign_task(current_user, current.get("team_id"), db):
            return error_response(
                "You must be a member of this task's team to assign it.", status_code=403
            )

    # Changing who approves a task grants approval rights, so it is gated the
    # same way. Note can_assign_to_others deliberately does NOT include the
    # named approver, so an approver cannot re-point approval at someone else
    # (or keep it on themselves after a leader revokes it).
    if "approver_id" in updates and (updates.get("approver_id") or "") != (current.get("approver_id") or ""):
        if not await workflow.can_assign_to_others(current_user, current.get("team_id"), db):
            return error_response(
                "Only a team leader can choose who approves a task.", status_code=403
            )
        new_approver = (updates.get("approver_id") or "").strip()
        if new_approver:
            if not await workflow.is_team_member(db, current.get("team_id"), new_approver):
                return error_response(
                    "The approver must be a leader or member of this task's team.",
                    status_code=422,
                )
            updates["approver_id"] = new_approver
        else:
            # Clearing the approver falls back to leader-only approval.
            updates["approver_id"] = ""
            updates["approver_name"] = ""

    # ── Reedit return-to-origin ────────────────────────────────────────────────
    # When a leader sends a *routed* task back to reedit, it returns to the
    # leader (and team) that routed it, appearing in their Leader Desk › Reedit.
    # Only a leader/admin of the current team may return it.
    if new_status == "reedit" and current.get("origin_team_id"):
        origin_team_id = current.get("origin_team_id") or ""
        if origin_team_id and origin_team_id != current.get("team_id"):
            if not await workflow.can_approve(current_user, current, db):
                return error_response(
                    "Only a team leader can send a task back to reedit.",
                    status_code=403,
                )
            from bson import ObjectId as _OID
            returning_team_name = ""
            if current.get("team_id") and _OID.is_valid(current["team_id"]):
                _rt = await db["teams"].find_one({"_id": _OID(current["team_id"])}, {"name": 1})
                returning_team_name = (_rt or {}).get("name", "")
            # Send it home: origin team, unassigned so that leader can redistribute.
            updates["team_id"] = origin_team_id
            updates["assigned_to"] = ""
            updates["assigned_to_name"] = ""
            updates["former_team_name"] = returning_team_name
            updates["former_assigned_to_name"] = (
                current.get("assigned_to_name", "") or current.get("assigned_to", "")
            )

    # ── Peer transfer ─────────────────────────────────────────────────────────
    # Handing your own work to a teammate. Allowed from ANY status: a handover
    # is about who does the work, not where the task sits in the workflow, so
    # it does not touch `status` and never bypasses the state machine above.
    transfer_from_id = ""
    transfer_from_name = ""
    # actor_* are assigned further down for the notification block; the history
    # write below needs them here.
    actor_id   = str(current_user["_id"])
    actor_name = current_user.get("name", "")
    if transfer_to_id:
        if not await workflow.can_transfer_own_task(current_user, current, db):
            return error_response(
                "You can only transfer a task that is assigned to you.", status_code=403
            )
        if not transfer_reason:
            return error_response(
                "Please add a reason for transferring this task.", status_code=400
            )
        if transfer_to_id == current.get("assigned_to"):
            return error_response(
                "This task is already assigned to that person.", status_code=400
            )
        if not ObjectId.is_valid(transfer_to_id):
            return error_response("Invalid user ID", status_code=422)
        # Keep the work inside its team — otherwise a transfer becomes a way to
        # push a task onto someone who can't even see the board it lives on.
        if current.get("team_id") and not await workflow.is_team_member(
            db, current.get("team_id"), transfer_to_id
        ):
            return error_response(
                "You can only transfer to a member of this task's team.", status_code=422
            )
        target = await db["users"].find_one({"_id": ObjectId(transfer_to_id)}, {"name": 1})
        if not target:
            return error_response("That user no longer exists.", status_code=422)

        transfer_from_id = current.get("assigned_to", "") or ""
        transfer_from_name = current.get("assigned_to_name", "") or transfer_from_id
        resolved_name = transfer_to_name or target.get("name", "")

        from datetime import datetime, timezone as _tz
        updates["assigned_to"] = transfer_to_id
        updates["assigned_to_name"] = resolved_name
        updates["transfer_reason"] = transfer_reason
        await db["project_tasks"].update_one(
            {"_id": oid},
            {"$push": {"history": {
                "action":      "transferred",
                "actor_id":    actor_id,
                "actor_name":  actor_name,
                "timestamp":   datetime.now(_tz.utc),
                "from_status": cur_status,
                "to_status":   cur_status,
                "note":        (
                    f"Transferred from {transfer_from_name or 'unassigned'} "
                    f"to {resolved_name} — {transfer_reason}"
                ),
                "team_id":     current.get("team_id", ""),
            }}},
        )

    task = await update_task(db, task_id, updates)
    if not task:
        return error_response("Task not found", status_code=404)

    # Tell both sides. Fired after the write so neither is told about a change
    # that failed to land.
    if transfer_to_id:
        title = task.get("title", "Task")
        meta = {
            "task_id": task_id,
            "task_title": title,
            "team_id": current.get("team_id", ""),
        }
        from app.services.notification_service import push_notification
        try:
            await push_notification(
                db, transfer_to_id, "task_transferred",
                "A task was transferred to you",
                f'{actor_name} transferred "{title}" to you — {transfer_reason}',
                meta,
            )
            # Both sides get a record, including whoever initiated it — the
            # point is that a handover is documented for each party, not just
            # that the recipient is alerted.
            if transfer_from_id:
                you_did_it = transfer_from_id == actor_id
                await push_notification(
                    db, transfer_from_id, "task_transferred",
                    "You transferred a task" if you_did_it
                    else "A task was transferred away from you",
                    (
                        f'You transferred "{title}" to {updates["assigned_to_name"]} '
                        f'— {transfer_reason}'
                        if you_did_it else
                        f'{actor_name} transferred "{title}" to '
                        f'{updates["assigned_to_name"]} — {transfer_reason}'
                    ),
                    meta,
                )
        except Exception as exc:
            # Never fail the transfer itself over a notification.
            print(f"[transfer] notification failed: {exc}", flush=True)

    # ── Append audit history (tagged with the team the action happened in) ──────
    # `current` still holds the pre-update team, so a reedit that returns a task
    # to its origin team is correctly attributed to the team that raised it.
    from datetime import datetime as _dtm, timezone as _tz
    acting_team_id = current.get("team_id") or ""
    acting_team_name = ""
    if acting_team_id and ObjectId.is_valid(acting_team_id):
        _t = await db["teams"].find_one({"_id": ObjectId(acting_team_id)}, {"name": 1})
        acting_team_name = (_t or {}).get("name", "")
    _hist: list[dict] = []
    if new_status and new_status != cur_status:
        _hist.append({
            "action":      new_status,
            "actor_id":    actor_id,
            "actor_name":  actor_name,
            "timestamp":   _dtm.now(_tz.utc),
            "from_status": cur_status,
            "to_status":   new_status,
            "note":        (updates.get("reedit_reason") or None) if new_status == "reedit" else None,
            "team_id":     acting_team_id,
            "team_name":   acting_team_name,
        })
    if (
        "assigned_to" in updates
        and updates["assigned_to"]
        and updates["assigned_to"] != current.get("assigned_to")
    ):
        _hist.append({
            "action":      "assigned",
            "actor_id":    actor_id,
            "actor_name":  actor_name,
            "timestamp":   _dtm.now(_tz.utc),
            "from_status": None,
            "to_status":   None,
            "note":        f"Assigned to {updates.get('assigned_to_name') or updates['assigned_to']}",
            "team_id":     acting_team_id,
            "team_name":   acting_team_name,
        })
    if _hist:
        await db["project_tasks"].update_one(
            {"_id": oid}, {"$push": {"history": {"$each": _hist}}}
        )

    # ── Fire notifications for status transition ───────────────────────────────
    _notif_event_map = {
        "started":        "started",
        "break":          "break",
        "pending_review": "pending_review",
        "approved":       "approved",
        "reedit":         "reedit",
    }
    if new_status and new_status != cur_status and new_status in _notif_event_map:
        await _fire_notifications(
            db, task, _notif_event_map[new_status],
            str(current_user["_id"]),
            current_user.get("name", ""),
        )
    # Re-assignment to a different person (skip when clearing the assignee)
    if (
        "assigned_to" in updates
        and updates["assigned_to"]
        and updates["assigned_to"] != current.get("assigned_to")
    ):
        await _fire_notifications(
            db, task, "assigned",
            str(current_user["_id"]),
            current_user.get("name", ""),
        )
        from app.services import chat_notify
        await chat_notify.dm_task_assigned(
            db, task, str(current_user["_id"]), current_user.get("name", "")
        )

    # Chat DM: notify team leader(s) + creator when a task is completed (approved)
    if new_status == "approved" and cur_status != "approved":
        from app.services import chat_notify
        await chat_notify.dm_task_completed(
            db, task, str(current_user["_id"]), current_user.get("name", "")
        )

    # ── Destination routing (only on approve) ─────────────────────────────────
    if new_status == "approved" and destination_team_id:
        from datetime import datetime, timezone as tz
        from bson import ObjectId
        now = datetime.now(tz.utc)
        # Look up the former + destination team names for provenance / history.
        former_team_name = ""
        if task.get("team_id"):
            try:
                former_team_doc = await db["teams"].find_one({"_id": ObjectId(task["team_id"])})
                if former_team_doc:
                    former_team_name = former_team_doc.get("name", "")
            except Exception:
                pass
        dest_team_name = ""
        if ObjectId.is_valid(destination_team_id):
            _dt_doc = await db["teams"].find_one({"_id": ObjectId(destination_team_id)}, {"name": 1})
            dest_team_name = (_dt_doc or {}).get("name", "")

        # Record the hand-off on the SOURCE task so its history shows the exit.
        await db["project_tasks"].update_one(
            {"_id": oid},
            {"$push": {"history": {
                "action":      "routed",
                "actor_id":    actor_id,
                "actor_name":  actor_name,
                "timestamp":   now,
                "from_status": "approved",
                "to_status":   None,
                "note":        f"Routed to {dest_team_name}" if dest_team_name else "Routed to another team",
                "team_id":     task.get("team_id", ""),
                "team_name":   former_team_name,
            }}},
        )

        # The whole routing chain shares one root, so the full cross-team history
        # can be aggregated regardless of which copy is opened.
        # The routed approver must belong to the DESTINATION team, else approval
        # rights would be handed to someone outside it.
        if next_approver_id and not await workflow.is_team_member(
            db, destination_team_id, next_approver_id
        ):
            next_approver_id, next_approver_name = None, None

        root_task_id = str(current.get("root_task_id") or current["_id"])
        _received_note = f"Received from {former_team_name}" if former_team_name else "Received via routing"
        if next_leader_name:
            _received_note += f" · assigned to {next_leader_name}"
        routed_result = await db["project_tasks"].insert_one({
            "title": task["title"],
            "description": task.get("description", ""),
            "priority": task.get("priority", "medium"),
            "status": "pending",
            "assigned_to": next_leader_id or "",
            "assigned_to_name": next_leader_name or "",
            # Who may approve the routed copy once it comes back for review.
            # Validated below against the destination team's member list.
            "approver_id": next_approver_id or "",
            "approver_name": next_approver_name or "",
            "due_date": None,
            "team_id": destination_team_id,
            "attachments": task.get("attachments", []),
            "caption": task.get("caption", ""),
            "created_by": task.get("created_by", ""),
            "created_at": now,
            "updated_at": now,
            "timing": {"intervals": [], "total_seconds": None},
            # Provenance: who worked on this in the originating team
            "former_assigned_to_name": task.get("assigned_to_name", "") or task.get("assigned_to", ""),
            "former_team_name": former_team_name,
            # Routing provenance — so a reedit from the destination team can be
            # returned to the leader (and team) that routed it here.
            "routed_by_id": str(current_user["_id"]),
            "routed_by_name": current_user.get("name", ""),
            "origin_team_id": task.get("team_id", ""),
            # Chain linkage for full-history aggregation.
            "root_task_id": root_task_id,
            "parent_task_id": task_id,
            # Seed the copy's own history with the hand-off it received.
            "history": [{
                "action":      "received",
                "actor_id":    actor_id,
                "actor_name":  actor_name,
                "timestamp":   now,
                "from_status": None,
                "to_status":   "pending",
                "note":        _received_note,
                "team_id":     destination_team_id,
                "team_name":   dest_team_name,
            }],
        })
        # Notify the destination team's leaders + elevated roles about the new task
        # If assigned to a specific leader, also send them a task_assigned notification
        from app.services.project_service import _serialize
        routed_task = await db["project_tasks"].find_one({"_id": routed_result.inserted_id})
        if routed_task:
            await _fire_notifications(
                db, _serialize(routed_task), "created",
                str(current_user["_id"]),
                current_user.get("name", ""),
            )
            if next_leader_id:
                from app.services.notification_service import push_notification
                await push_notification(
                    db, next_leader_id, "task_assigned",
                    "Task assigned to you",
                    f'"{task["title"]}" has been approved and assigned to you.',
                    {"task_id": str(routed_result.inserted_id), "task_title": task["title"]},
                )

    return success_response(data=task, message="Task updated")


@router.delete("/{task_id}", status_code=204)
async def remove_task(
    task_id: str,
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    deleted = await delete_task(db, task_id)
    if not deleted:
        return error_response("Task not found", status_code=404)
    return None
