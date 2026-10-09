"""Task projects — the optional "Project" picker in Add Task (see services/task_project_service.py)."""
from fastapi import APIRouter, Depends
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.database import get_db
from app.middleware.auth import get_current_user
from app.services import task_project_service as tps
from app.utils.response import success_response

router = APIRouter(prefix="/api/v1/task-projects", tags=["task-projects"])


@router.get("")
async def list_task_projects(
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """Every active project, in display order (group, then order). Any signed-in user."""
    return success_response(data=await tps.list_active(db), message="Projects retrieved")
