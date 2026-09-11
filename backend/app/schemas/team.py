from typing import Optional
from pydantic import BaseModel


class CreateTeamRequest(BaseModel):
    name: str
    description: Optional[str] = ""
    color: Optional[str] = "#6366f1"   # indigo default
    status: Optional[str] = "active"   # active | inactive
    leader_ids: list[str] = []         # users to add as Team Leaders
    member_ids: list[str] = []         # users to add as Team Members


class UpdateTeamRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    color: Optional[str] = None
    status: Optional[str] = None
    # Full membership replacement. Omit both to leave membership untouched;
    # sending them reconciles the roster in one atomic write, subject to the
    # same rules the per-member endpoints enforce.
    leader_ids: Optional[list[str]] = None
    member_ids: Optional[list[str]] = None


class AddMemberRequest(BaseModel):
    user_id: str
    role: str = "member"   # "member" | "leader"


class UpdateMemberRoleRequest(BaseModel):
    role: str              # "member" | "leader"
