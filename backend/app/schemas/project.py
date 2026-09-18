from typing import Optional
from pydantic import BaseModel


class Attachment(BaseModel):
    url: str
    key: str
    filename: str
    size: int = 0
    content_type: str = "application/octet-stream"
    backend: str = "local"


class CreateTaskRequest(BaseModel):
    title: str
    description: Optional[str] = ""
    priority: str = "medium"          # low | medium | high
    status: str = "pending"           # pending | upcoming | currently_working | updation_needed
    assigned_to: Optional[str] = ""   # user_id (preferred) or legacy free-text name
    assigned_to_name: Optional[str] = ""  # denormalized display name
    due_date: Optional[str] = None    # ISO date string YYYY-MM-DD
    team_id: Optional[str] = None     # optional team association
    attachments: Optional[list[Attachment]] = None
    # Named approver — may be any member of the team, not only a leader.
    # Setting it requires leader/admin rights (see workflow.can_assign_to_others).
    approver_id: Optional[str] = None
    approver_name: Optional[str] = None


class UpdateTaskRequest(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    priority: Optional[str] = None
    status: Optional[str] = None
    assigned_to: Optional[str] = None
    assigned_to_name: Optional[str] = None
    due_date: Optional[str] = None
    team_id: Optional[str] = None
    attachments: Optional[list[Attachment]] = None
    reedit_reason: Optional[str] = None       # why a review was sent back to reedit
    destination_team_id: Optional[str] = None # route a copy to this team on approve
    next_leader_id: Optional[str] = None      # assign the routed copy to this leader
    next_leader_name: Optional[str] = None
    approver_id: Optional[str] = None         # who may approve THIS task
    approver_name: Optional[str] = None
    next_approver_id: Optional[str] = None    # who may approve the ROUTED COPY
    next_approver_name: Optional[str] = None
    # ── Peer transfer ─────────────────────────────────────────────────────────
    # An employee handing their own task to a teammate. Distinct from
    # assigned_to, which stays a leader/admin action (can_assign_to_others).
    transfer_to_id: Optional[str] = None
    transfer_to_name: Optional[str] = None
    transfer_reason: Optional[str] = None
    # ── Verification ──────────────────────────────────────────────────────────
    # Who must sign the work off before it can be approved. Named as individual
    # users and/or whole teams; a team is expanded to its members at the moment
    # the task enters pending_review, so the roster is current when it matters.
    verify_users: Optional[list[str]] = None
    verify_teams: Optional[list[str]] = None
    verify_instructions: Optional[str] = None
    caption: Optional[str] = None             # submission note added when sending to pending_review
    # Screenshots attached at submission. Kept apart from `attachments` so the
    # approver sees what was handed in for review, not a pile mixing the task's
    # own working files with the evidence for this round.
    submission_attachments: Optional[list[Attachment]] = None
