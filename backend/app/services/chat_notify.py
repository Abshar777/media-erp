"""
Chat DM notifications for task events.

Sends real chat DMs (from the acting user) so recipients get the update in their
inbox with a live task reference chip they can click through:

  assign   → DM the assignee and the task creator
  complete → DM the team leader(s) and the task creator

These run alongside the existing bell/WhatsApp notifications and never raise —
a chat-DM failure must not break the task operation.
"""
import logging

from bson import ObjectId

from app.models.chat import message_to_dict
from app.services.chat_service import save_message, resolve_task_snapshots

logger = logging.getLogger(__name__)


async def _team_leader_ids(db, team_id: str) -> list[str]:
    if not team_id or not ObjectId.is_valid(team_id):
        return []
    team = await db["teams"].find_one({"_id": ObjectId(team_id)}, {"members": 1})
    if not team:
        return []
    return [m["user_id"] for m in team.get("members", []) if m.get("role") == "leader"]


async def _send_dm(db, actor_id: str, to_id: str, content: str, task_id: str) -> None:
    """Persist a DM from actor→recipient with a task reference, and push if online."""
    if not to_id or to_id == actor_id:
        return
    # Pass our own handle: the repeating-task scheduler calls this from its own
    # thread and event loop, where the global client raises "attached to a
    # different loop" — which used to cut the DM loop short after one message.
    doc = await save_message(actor_id, to_id, content, task_ids=[task_id] if task_id else None, db=db)
    try:
        # Lazy import to avoid a circular import with the chat router
        from app.routers.chat import manager
        snapshots = await resolve_task_snapshots([task_id], db=db) if task_id else []
        envelope = {"type": "message", **message_to_dict(doc), "tasks": snapshots}
        await manager.send(to_id, envelope)
        await manager.send(actor_id, envelope)  # echo into the sender's thread too
    except Exception as exc:
        logger.warning("Chat DM push failed (persisted ok): %s", exc)


async def dm_task_assigned(db, task: dict, actor_id: str, actor_name: str) -> None:
    """On assignment: DM the assignee and the task creator."""
    try:
        task_id = task.get("id") or str(task.get("_id", ""))
        title = task.get("title", "Task")
        assignee = task.get("assigned_to") or ""
        assignee_name = task.get("assigned_to_name") or "the assignee"
        creator = task.get("created_by") or ""

        recipients: dict[str, str] = {}
        if assignee:
            recipients[assignee] = f'📋 You have been assigned a task: "{title}".'
        if creator and creator != assignee:
            recipients[creator] = f'📋 "{title}" was assigned to {assignee_name}.'

        for to_id, content in recipients.items():
            await _send_dm(db, actor_id, to_id, content, task_id)
    except Exception as exc:
        logger.warning("dm_task_assigned failed: %s", exc)


async def dm_task_completed(db, task: dict, actor_id: str, actor_name: str) -> None:
    """On completion (approved): DM the team leader(s) and the task creator."""
    try:
        task_id = task.get("id") or str(task.get("_id", ""))
        title = task.get("title", "Task")
        assignee_name = task.get("assigned_to_name") or "the assignee"
        creator = task.get("created_by") or ""
        team_id = task.get("team_id") or ""

        recipient_ids = set(await _team_leader_ids(db, team_id))
        if creator:
            recipient_ids.add(creator)

        content = f'✅ Task completed: "{title}" by {assignee_name}.'
        for to_id in recipient_ids:
            await _send_dm(db, actor_id, to_id, content, task_id)
    except Exception as exc:
        logger.warning("dm_task_completed failed: %s", exc)
