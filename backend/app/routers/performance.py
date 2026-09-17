"""
Performance report — time to finish, time to approve, time to verify.

  GET /api/v1/performance   — one report, broken down team by team

Who may read it: this ranks named colleagues against each other, so it is
management information rather than something the whole company browses.
Elevated roles see every team; a team leader sees only the teams they lead.
Anyone else is refused — they can still see their own work on the board.
"""
from fastapi import APIRouter, Depends, Query
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.database import get_db
from app.middleware.auth import get_current_user
from app.services.performance_service import (
    build_performance_report,
    list_performance_tasks,
)
from app.utils.response import error_response, success_response

router = APIRouter(prefix="/api/v1/performance", tags=["performance"])

_ELEVATED = {"Super Admin", "Admin", "Coordinator"}


async def _visible_team_ids(db: AsyncIOMotorDatabase, user: dict) -> list[str] | None:
    """
    None means "every team". A list restricts the report to those teams.
    An empty list means the caller leads nothing and may see nothing.
    """
    role_name = (user.get("_role") or {}).get("role_name", "")
    if role_name in _ELEVATED:
        return None
    uid = str(user["_id"])
    led = await db["teams"].find(
        {"members": {"$elemMatch": {"user_id": uid, "role": "leader"}}}, {"_id": 1}
    ).to_list(200)
    return [str(t["_id"]) for t in led]


@router.get("")
async def performance(
    team_id: str = Query(default=""),
    date_from: str = Query(default=""),
    date_to: str = Query(default=""),
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    allowed = await _visible_team_ids(db, current_user)

    if allowed is not None and not allowed:
        return error_response(
            "This report is for team leaders and admins. Ask yours for a copy.",
            status_code=403,
        )

    if team_id:
        # Narrowing to one team must never widen what you can see.
        if allowed is not None and team_id not in allowed:
            return error_response("You don't lead that team.", status_code=403)
        team_ids = [team_id]
    else:
        team_ids = allowed

    data = await build_performance_report(db, team_ids, date_from, date_to)
    data["scope"] = "all" if allowed is None else "led"
    return success_response(data=data, message="Performance report ready")


@router.get("/tasks")
async def performance_tasks(
    user_id: str = Query(...),
    role: str = Query(..., pattern="^(member|approver|verifier)$"),
    team_id: str = Query(default=""),
    date_from: str = Query(default=""),
    date_to: str = Query(default=""),
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """
    The tasks behind one row of the report — what a number is actually made of.

    Scoped exactly like the report itself: narrowing to a team you don't lead
    must not become a way to read another team's work.
    """
    allowed = await _visible_team_ids(db, current_user)
    if allowed is not None and not allowed:
        return error_response(
            "This report is for team leaders and admins. Ask yours for a copy.",
            status_code=403,
        )
    if team_id:
        if allowed is not None and team_id not in allowed:
            return error_response("You don't lead that team.", status_code=403)
        team_ids = [team_id]
    else:
        team_ids = allowed

    rows = await list_performance_tasks(
        db, team_ids, user_id, role, date_from, date_to
    )
    return success_response(data={"items": rows, "total": len(rows)},
                            message="Tasks retrieved")
