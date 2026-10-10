"""
Task projects — the optional "Project" picker on tasks, and managing its list.
Rules live in services/task_project_service.py.

Everyone signed in reads the active list. Admin roles and team leaders manage it: add, rename
(tasks follow the new name), archive ("delete" — tasks keep their project) and
restore, change platform / group, and order it.
"""
from typing import Literal, Optional

from fastapi import APIRouter, Depends, Query
from motor.motor_asyncio import AsyncIOMotorDatabase
from pydantic import BaseModel, StrictInt

from app.database import get_db
from app.middleware.auth import get_current_user
from app.services import task_project_service as tps
from app.utils.response import error_response, success_response

router = APIRouter(prefix="/api/v1/task-projects", tags=["task-projects"])

Platform = Literal["meta", "google", "snapchat", "other"]
ADMIN_ONLY = "Only an admin or a team leader can change the project list."


class ProjectCreate(BaseModel):
    name: str
    platform: Platform = "meta"
    group: Optional[StrictInt] = None    # None = the last group (strict: JSON true must not become 1)


class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    platform: Optional[Platform] = None
    group: Optional[StrictInt] = None
    active: Optional[bool] = None        # false = archived ("deleted"), true = restored


class ProjectOrder(BaseModel):
    ids: list[str]


def _err(e: tps.ProjectError):
    return error_response(e.message, status_code=e.status_code)


@router.get("")
async def list_task_projects(
    manage: bool = Query(default=False),
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """Active projects in display order. `manage=1` (admin roles): archived too, with task counts."""
    if manage:
        if not await tps.can_manage(db, current_user):
            return error_response(ADMIN_ONLY, status_code=403)
        return success_response(data=await tps.list_for_manager(db), message="Projects retrieved")
    return success_response(data=await tps.list_active(db), message="Projects retrieved")


@router.post("", status_code=201)
async def create_task_project(
    body: ProjectCreate,
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    if not await tps.can_manage(db, current_user):
        return error_response(ADMIN_ONLY, status_code=403)
    try:
        data = await tps.create(db, current_user, body.name, body.platform, body.group)
    except tps.ProjectError as e:
        return _err(e)
    return success_response(data=data, message=f"“{data['name']}” added", status_code=201)


# Registered before "/{project_id}" so "order" is never read as an id.
@router.put("/order")
async def reorder_task_projects(
    body: ProjectOrder,
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    if not await tps.can_manage(db, current_user):
        return error_response(ADMIN_ONLY, status_code=403)
    try:
        await tps.reorder(db, body.ids)
    except tps.ProjectError as e:
        return _err(e)
    return success_response(data=await tps.list_for_manager(db), message="Order saved")


@router.patch("/{project_id}")
async def update_task_project(
    project_id: str,
    body: ProjectUpdate,
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    if not await tps.can_manage(db, current_user):
        return error_response(ADMIN_ONLY, status_code=403)
    try:
        data = await tps.update(db, current_user, project_id, body.model_dump(exclude_none=True))
    except tps.ProjectError as e:
        return _err(e)
    msg = ("Restored" if body.active else "Deleted") if body.active is not None and len(body.model_dump(exclude_none=True)) == 1 else "Project updated"
    return success_response(data=data, message=msg)


@router.delete("/{project_id}")
async def archive_task_project(
    project_id: str,
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """'Delete' = archive: hidden from the picker; tasks keep their project; restorable."""
    if not await tps.can_manage(db, current_user):
        return error_response(ADMIN_ONLY, status_code=403)
    try:
        data = await tps.update(db, current_user, project_id, {"active": False})
    except tps.ProjectError as e:
        return _err(e)
    return success_response(data=data, message=f"“{data['name']}” deleted")
