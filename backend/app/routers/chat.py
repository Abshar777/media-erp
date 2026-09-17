"""
Real-time chat — WebSocket + REST.

WebSocket: GET /api/v1/chat/ws?token=<access_token>

Client → server frames:
  {"type": "message", "to_user_id": "...", "content": "..."}
  {"type": "read",    "from_user_id": "..."}

Server → client frames:
  {"type": "message",      ...ChatMessage}
  {"type": "status",       "user_id": "...", "online": true|false}
  {"type": "online_users", "user_ids": ["..."]}
"""

import io
import json
import logging
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse
from bson import ObjectId
from bson.errors import InvalidId
from jose import JWTError

from app.database import get_db
from app.middleware.auth import get_current_user
from app.models.chat import message_to_dict
from app.services.chat_service import (
    get_messages as db_get_messages,
    save_message as db_save_message,
    mark_read as db_mark_read,
    unread_counts as db_unread_counts,
)
from app.services import group_chat_service as groups
from app.utils.jwt import decode_access_token
from app.utils.response import error_response, success_response
from app.utils.timezone import utc_iso

router = APIRouter(prefix="/api/v1/chat", tags=["chat"])
logger = logging.getLogger(__name__)


# ── Super Admin guard ─────────────────────────────────────────────────────────

def _is_super_admin(user: dict) -> bool:
    """True when the caller has the Super Admin system role."""
    role = user.get("_role") or {}
    return bool(role.get("is_system_role")) and role.get("role_name") == "Super Admin"


def _require_super_admin(current_user: dict = Depends(get_current_user)) -> dict:
    if not _is_super_admin(current_user):
        raise HTTPException(status_code=403, detail="Super Admin access required")
    return current_user


# ── WebSocket connection manager ──────────────────────────────────────────────

class ConnectionManager:
    """
    Tracks live WebSocket connections, keyed by user_id.

    A user may hold several at once — the app-wide notification socket plus the
    chat page's own, and one per browser tab. Keeping a set rather than a single
    socket means a second connection no longer silently evicts the first (which
    previously broke chat as soon as it was open in two tabs).
    """

    def __init__(self) -> None:
        self._conns: dict[str, set[WebSocket]] = {}

    async def connect(self, user_id: str, ws: WebSocket) -> None:
        await ws.accept()
        first = not self._conns.get(user_id)
        self._conns.setdefault(user_id, set()).add(ws)
        # Only announce presence on the user's first socket, so opening a second
        # tab doesn't flood everyone with redundant "online" frames.
        if first:
            await self._broadcast(
                {"type": "status", "user_id": user_id, "online": True},
                exclude=user_id,
            )

    def disconnect(self, user_id: str, ws: WebSocket | None = None) -> bool:
        """Drop one socket. Returns True when that was the user's last one."""
        conns = self._conns.get(user_id)
        if not conns:
            return False
        if ws is None:
            conns.clear()
        else:
            conns.discard(ws)
        if not conns:
            self._conns.pop(user_id, None)
            return True
        return False

    def is_online(self, user_id: str) -> bool:
        return bool(self._conns.get(user_id))

    def online_ids(self) -> list[str]:
        return [uid for uid, conns in self._conns.items() if conns]

    async def send(self, user_id: str, payload: dict) -> None:
        conns = self._conns.get(user_id)
        if not conns:
            return
        text = json.dumps(payload, default=str)
        for ws in list(conns):
            try:
                await ws.send_text(text)
            except Exception:
                self.disconnect(user_id, ws)

    async def _broadcast(self, payload: dict, exclude: str | None = None) -> None:
        text = json.dumps(payload, default=str)
        for uid, conns in list(self._conns.items()):
            if uid == exclude:
                continue
            for ws in list(conns):
                try:
                    await ws.send_text(text)
                except Exception:
                    self.disconnect(uid, ws)


manager = ConnectionManager()


async def _notify_mentions(
    db, mention_ids: list[str], actor_id: str, actor_name: str,
    content: str, where: str, meta_extra: dict | None = None,
) -> None:
    """
    Tell each @mentioned person, except the author mentioning themselves.

    Never raises: a chat message must still send if the notification write
    fails, so this is best-effort exactly like the DM push.
    """
    if not mention_ids:
        return
    from app.services.notification_service import push_notification
    preview = (content or "").strip()
    if len(preview) > 140:
        preview = preview[:137] + "…"
    for uid in {m for m in mention_ids if m and m != actor_id}:
        try:
            await push_notification(
                db, uid, "mention",
                f"{actor_name} mentioned you",
                f"{where}: {preview}" if preview else f"{actor_name} mentioned you in {where}",
                {"from_user_id": actor_id, "from_user_name": actor_name, **(meta_extra or {})},
            )
        except Exception as exc:
            logger.warning("mention notification failed: %s", exc)


# ── WebSocket endpoint ────────────────────────────────────────────────────────

@router.websocket("/ws")
async def chat_ws(ws: WebSocket, token: str = Query(...)) -> None:
    """Authenticate via ?token=<jwt> (browsers cannot set WS headers)."""
    try:
        payload = decode_access_token(token)
        user_id: str = payload["sub"]
    except (JWTError, KeyError):
        await ws.close(code=4001)
        return

    await manager.connect(user_id, ws)
    await manager.send(user_id, {
        "type": "online_users",
        "user_ids": manager.online_ids(),
    })

    try:
        while True:
            raw = await ws.receive_text()
            try:
                data: dict = json.loads(raw)
            except json.JSONDecodeError:
                continue

            if data.get("type") == "message":
                to_id = str(data.get("to_user_id", "")).strip()
                content = str(data.get("content", "")).strip()
                attachments = data.get("attachments") or []
                task_ids = [str(t) for t in (data.get("task_ids") or []) if t]
                client_id = str(data.get("client_id", "")).strip()
                if not to_id or not (content or attachments or task_ids):
                    continue
                mention_ids = [str(m) for m in (data.get("mention_user_ids") or []) if m]
                from app.services.chat_service import build_reply_snapshot
                reply_to = await build_reply_snapshot(
                    str(data.get("reply_to_id", "")).strip(),
                    dm_pair=(user_id, to_id),
                )
                doc = await db_save_message(
                    user_id, to_id, content, attachments, task_ids, mention_ids,
                    reply_to=reply_to,
                )
                from app.services.chat_service import resolve_task_snapshots
                snapshots = await resolve_task_snapshots(task_ids)
                if mention_ids:
                    _db = get_db()
                    sender = await _db["users"].find_one({"_id": ObjectId(user_id)}, {"name": 1})
                    await _notify_mentions(
                        _db, mention_ids, user_id,
                        (sender or {}).get("name", "Someone"),
                        content, "in a direct message",
                    )
                envelope = {"type": "message", **message_to_dict(doc), "tasks": snapshots, "client_id": client_id}
                await manager.send(user_id, envelope)
                await manager.send(to_id, envelope)

            elif data.get("type") == "group_message":
                gid = str(data.get("group_id", "")).strip()
                content = str(data.get("content", "")).strip()
                attachments = data.get("attachments") or []
                task_ids = [str(t) for t in (data.get("task_ids") or []) if t]
                client_id = str(data.get("client_id", "")).strip()
                if not gid or not (content or attachments or task_ids):
                    continue
                db = get_db()
                member_ids = await groups.group_member_ids(db, gid)
                if user_id not in member_ids and not await groups.is_elevated(db, user_id):
                    continue  # not a member and not elevated — ignore
                # Resolve sender name
                sender_name = "Unknown"
                try:
                    sender = await db["users"].find_one({"_id": ObjectId(user_id)}, {"name": 1})
                    if sender:
                        sender_name = sender.get("name", "Unknown")
                except (InvalidId, Exception):
                    pass
                mention_ids = [str(m) for m in (data.get("mention_user_ids") or []) if m]
                from app.services.chat_service import build_reply_snapshot
                reply_to = await build_reply_snapshot(
                    str(data.get("reply_to_id", "")).strip(), group_id=gid,
                )
                doc = await groups.save_group_message(
                    db, gid, user_id, sender_name, content,
                    attachments=attachments, task_ids=task_ids,
                    mention_user_ids=mention_ids, reply_to=reply_to,
                )
                if mention_ids:
                    group_doc = await groups.get_group(db, gid)
                    await _notify_mentions(
                        db, mention_ids, user_id, sender_name, content,
                        f"in {(group_doc or {}).get('name', 'a group')}",
                        {"group_id": gid},
                    )
                from app.services.chat_service import resolve_task_snapshots
                snapshots = await resolve_task_snapshots(task_ids)
                envelope = {"type": "group_message", **groups.group_message_to_dict(doc), "tasks": snapshots, "client_id": client_id}
                for mid in set(member_ids) | {user_id}:
                    await manager.send(mid, envelope)

            elif data.get("type") == "read":
                from_id = str(data.get("from_user_id", "")).strip()
                if from_id:
                    await db_mark_read(from_id, user_id)
                    # Tell the original sender their messages were read → live ✓✓
                    await manager.send(from_id, {"type": "read", "by": user_id})

    except WebSocketDisconnect:
        pass
    finally:
        was_last = manager.disconnect(user_id, ws)
        if was_last:
            await manager._broadcast({
                "type": "status", "user_id": user_id, "online": False
            })


# ── REST endpoints ────────────────────────────────────────────────────────────

@router.get("/users")
async def list_chat_users(current_user: dict = Depends(get_current_user)):
    """Return all active users except the caller, with live online status."""
    db = get_db()
    # Exclude self by ObjectId (already an ObjectId in the middleware-returned doc)
    cursor = db["users"].find(
        {"_id": {"$ne": current_user["_id"]}},
        {"hashed_password": 0},
    )
    docs = await cursor.to_list(500)

    result = []
    for d in docs:
        # Include user if is_active is True (or missing — legacy users default to active)
        # Also include if status is "active" or missing (belt-and-suspenders)
        is_active = d.get("is_active", True)
        status = d.get("status", "active")
        if not is_active or status == "inactive":
            continue
        result.append({
            "id": str(d["_id"]),
            "name": d.get("name", ""),
            "email": d.get("email", ""),
            "designation": d.get("designation", ""),
            "status": status,
            "online": manager.is_online(str(d["_id"])),
        })
    return result


@router.get("/messages/{other_id}")
async def get_messages(
    other_id: str,
    limit: int = Query(50, le=100),
    before_id: str | None = Query(None),
    current_user: dict = Depends(get_current_user),
):
    docs = await db_get_messages(
        str(current_user["_id"]), other_id, limit, before_id
    )
    from app.services.chat_service import attach_task_snapshots
    return await attach_task_snapshots([message_to_dict(d) for d in docs])


@router.put("/messages/{other_id}/read")
async def mark_read_endpoint(
    other_id: str,
    current_user: dict = Depends(get_current_user),
):
    await db_mark_read(other_id, str(current_user["_id"]))
    return {"ok": True}


@router.get("/unread")
async def get_unread_counts(current_user: dict = Depends(get_current_user)):
    return await db_unread_counts(str(current_user["_id"]))


# ── Group chat endpoints ──────────────────────────────────────────────────────

@router.get("/groups")
async def list_groups(current_user: dict = Depends(get_current_user)):
    """List team chat groups the caller belongs to (auto-provisions per team).

    Elevated roles (Super Admin / Admin / Coordinator) see every team group.
    """
    db = get_db()
    role_name = (current_user.get("_role") or {}).get("role_name", "")
    include_all = role_name in ("Super Admin", "Admin", "Coordinator")
    return await groups.list_groups_for_user(db, str(current_user["_id"]), include_all=include_all)


@router.get("/groups/{group_id}/messages")
async def get_group_messages_endpoint(
    group_id: str,
    limit: int = Query(50, le=100),
    before_id: str | None = Query(None),
    current_user: dict = Depends(get_current_user),
):
    db = get_db()
    uid = str(current_user["_id"])
    role_name = (current_user.get("_role") or {}).get("role_name", "")
    members = await groups.group_member_ids(db, group_id)
    if uid not in members and role_name not in ("Super Admin", "Admin", "Coordinator"):
        raise HTTPException(status_code=403, detail="Not a member of this group")
    docs = await groups.get_group_messages(db, group_id, limit, before_id)
    from app.services.chat_service import attach_task_snapshots
    return await attach_task_snapshots([groups.group_message_to_dict(d) for d in docs])


async def _resolve_report_group(db, group_id: str, current_user: dict) -> tuple[dict, dict]:
    """
    Shared lookup + access check for the report endpoints below. Allowed for
    Super Admin/Admin/Coordinator and the team's leader.
    """
    group = await groups.get_group(db, group_id)
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")

    team = None
    if ObjectId.is_valid(group.get("team_id", "")):
        team = await db["teams"].find_one({"_id": ObjectId(group["team_id"])})
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")

    uid = str(current_user["_id"])
    role_name = (current_user.get("_role") or {}).get("role_name", "")
    is_leader = any(
        m.get("user_id") == uid and m.get("role") == "leader"
        for m in team.get("members", [])
    )
    if role_name not in ("Super Admin", "Admin", "Coordinator") and not is_leader:
        raise HTTPException(status_code=403, detail="Leader or admin access required")

    return group, team


@router.post("/groups/{group_id}/report/send-now")
async def send_group_report_now(
    group_id: str,
    period: Literal["daily", "weekly", "monthly"] = Query("daily"),
    current_user: dict = Depends(get_current_user),
):
    """
    Post the team's report (daily/weekly/monthly activity window) into the
    group immediately. Allowed for Super Admin/Admin/Coordinator and the
    team's leader.
    """
    db = get_db()
    group, team = await _resolve_report_group(db, group_id, current_user)

    await groups.post_daily_report(db, group, team, period=period)
    docs = await groups.get_group_messages(db, group_id, 1)
    posted = groups.group_message_to_dict(docs[-1]) if docs else None

    # Push live to any online members
    for mid in group.get("members", []):
        if posted:
            await manager.send(mid, {"type": "group_message", **posted})

    return {"ok": True, "message": posted}


@router.get("/groups/{group_id}/report/export/pdf")
async def export_group_report_pdf(
    group_id: str,
    period: Literal["daily", "weekly", "monthly"] = Query("monthly"),
    current_user: dict = Depends(get_current_user),
):
    """
    Download the team's report (default: monthly) as a PDF, without posting
    it into the chat. Same access rule as send-now.
    """
    db = get_db()
    group, team = await _resolve_report_group(db, group_id, current_user)

    pdf_bytes = await groups.build_group_report_pdf(db, team, period)
    safe_name = (team.get("name") or "team").strip().lower().replace(" ", "_")
    filename = f"{safe_name}_{period}_report.pdf"
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ── Super Admin monitor endpoints ─────────────────────────────────────────────

@router.get("/admin/conversations")
async def admin_list_conversations(
    _: dict = Depends(_require_super_admin),
):
    """
    Return all unique conversation pairs with last-message preview.
    Super Admin only.
    """
    db = get_db()

    # Group messages by the canonical (sorted) pair key so each chat appears once
    pipeline = [
        {"$sort": {"created_at": -1}},
        {
            "$addFields": {
                "pair_key": {
                    "$cond": [
                        {"$lt": ["$from_user_id", "$to_user_id"]},
                        {"$concat": ["$from_user_id", "___", "$to_user_id"]},
                        {"$concat": ["$to_user_id", "___", "$from_user_id"]},
                    ]
                }
            }
        },
        {
            "$group": {
                "_id": "$pair_key",
                "last_msg": {"$first": "$$ROOT"},
                "msg_count": {"$sum": 1},
            }
        },
        {"$sort": {"last_msg.created_at": -1}},
        {"$limit": 300},
    ]
    pairs = await db["messages"].aggregate(pipeline).to_list(300)

    # Collect all distinct user IDs so we can batch-fetch names
    uid_strings: set[str] = set()
    for p in pairs:
        parts = p["_id"].split("___")
        if len(parts) == 2:
            uid_strings.update(parts)

    valid_oids = []
    for s in uid_strings:
        try:
            valid_oids.append(ObjectId(s))
        except (InvalidId, Exception):
            pass

    user_docs = await db["users"].find(
        {"_id": {"$in": valid_oids}},
        {"name": 1, "email": 1},
    ).to_list(500)
    users_map = {str(d["_id"]): d.get("name") or d.get("email", "Unknown") for d in user_docs}

    result = []
    for p in pairs:
        parts = p["_id"].split("___")
        if len(parts) != 2:
            continue
        id_a, id_b = parts
        last = p["last_msg"]
        created = last.get("created_at")
        result.append({
            "user_a_id":   id_a,
            "user_a_name": users_map.get(id_a, "Unknown"),
            "user_b_id":   id_b,
            "user_b_name": users_map.get(id_b, "Unknown"),
            "last_message":  last.get("content", ""),
            "last_sender_id": last.get("from_user_id", ""),
            "last_at":       utc_iso(created),
            "msg_count":     p["msg_count"],
        })
    return result


@router.get("/admin/messages/{user_a_id}/{user_b_id}")
async def admin_get_messages(
    user_a_id: str,
    user_b_id: str,
    limit: int = Query(100, le=200),
    _: dict = Depends(_require_super_admin),
):
    """
    Retrieve the full message thread between any two users.
    Super Admin only.  Polled every few seconds for live monitoring.
    """
    docs = await db_get_messages(user_a_id, user_b_id, limit)
    return [message_to_dict(d) for d in docs]


# ── Per-message actions: delete, info, group read receipts ───────────────────

async def _load_message(db, message_id: str) -> dict | None:
    if not ObjectId.is_valid(message_id):
        return None
    return await db["messages"].find_one({"_id": ObjectId(message_id)})


async def _may_see_message(db, doc: dict, user: dict) -> bool:
    """Can this person read the message at all? Gates both info and delete."""
    uid = str(user["_id"])
    if _is_super_admin(user):
        return True
    gid = doc.get("group_id")
    if gid:
        return uid in await groups.group_member_ids(db, gid) or await groups.is_elevated(db, uid)
    return uid in {doc.get("from_user_id"), doc.get("to_user_id")}


@router.delete("/messages/{message_id}")
async def delete_message(
    message_id: str,
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db),
):
    """
    Withdraw a message.

    Only its author, or a Super Admin. Deleting for yourself alone is
    deliberately not offered: a thread that reads differently for each person
    is worse than one that plainly shows something was withdrawn.
    """
    doc = await _load_message(db, message_id)
    if not doc:
        return error_response("That message no longer exists.", status_code=404)

    uid = str(current_user["_id"])
    if doc.get("from_user_id") != uid and not _is_super_admin(current_user):
        return error_response("You can only delete your own messages.", status_code=403)
    if doc.get("deleted_at"):
        return success_response(data={"id": message_id}, message="Already deleted")

    from app.services.chat_service import soft_delete_message
    updated = await soft_delete_message(
        db, doc, uid, current_user.get("name", "")
    )

    # Tell everyone who can see it, so it disappears without a reload.
    gid = doc.get("group_id")
    if gid:
        envelope = {"type": "group_message_deleted", "id": message_id, "group_id": gid}
        for mid in set(await groups.group_member_ids(db, gid)) | {uid}:
            await manager.send(mid, envelope)
    else:
        envelope = {"type": "message_deleted", "id": message_id}
        for mid in {doc.get("from_user_id", ""), doc.get("to_user_id", "")} - {""}:
            await manager.send(mid, envelope)

    return success_response(data={"id": message_id}, message="Message deleted")


@router.get("/messages/{message_id}/info")
async def message_info(
    message_id: str,
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db),
):
    """
    Who has seen this message.

    For a direct message that is the one recipient. For a group it is derived
    from each member's read high-water mark (see chat_service.mark_group_read)
    rather than a per-message receipt, so it stays one row per member however
    long the group runs.
    """
    doc = await _load_message(db, message_id)
    if not doc:
        return error_response("That message no longer exists.", status_code=404)
    if not await _may_see_message(db, doc, current_user):
        return error_response("You don't have access to that message.", status_code=403)

    sent_at = utc_iso(doc.get("created_at"))
    sender_id = doc.get("from_user_id", "")
    gid = doc.get("group_id")

    if not gid:
        other = doc.get("to_user_id", "")
        name = ""
        if ObjectId.is_valid(other):
            u = await db["users"].find_one({"_id": ObjectId(other)}, {"name": 1})
            name = (u or {}).get("name", "")
        seen = bool(doc.get("read"))
        return success_response(data={
            "kind": "direct",
            "sent_at": sent_at,
            "seen": [{"user_id": other, "name": name,
                      "at": utc_iso(doc.get("read_at"))}] if seen else [],
            "not_seen": [] if seen else [{"user_id": other, "name": name}],
            "total_recipients": 1,
        })

    member_ids = [m for m in await groups.group_member_ids(db, gid) if m != sender_id]
    valid = [ObjectId(m) for m in member_ids if ObjectId.is_valid(m)]
    users = await db["users"].find({"_id": {"$in": valid}}, {"name": 1}).to_list(1000)
    names = {str(u["_id"]): u.get("name", "") for u in users}

    reads = await db["chat_group_reads"].find(
        {"group_id": gid, "user_id": {"$in": member_ids}}
    ).to_list(1000)
    read_at = {r["user_id"]: r.get("last_read_at") for r in reads}

    created = doc.get("created_at")
    seen, not_seen = [], []
    for mid in member_ids:
        at = read_at.get(mid)
        if created and at and at >= created:
            seen.append({"user_id": mid, "name": names.get(mid, ""), "at": utc_iso(at)})
        else:
            not_seen.append({"user_id": mid, "name": names.get(mid, "")})

    seen.sort(key=lambda r: r["at"] or "")
    return success_response(data={
        "kind": "group",
        "sent_at": sent_at,
        "seen": seen,
        "not_seen": not_seen,
        "total_recipients": len(member_ids),
    })


@router.put("/groups/{group_id}/read")
async def mark_group_read_endpoint(
    group_id: str,
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db),
):
    """Called when the group is opened — moves this reader's high-water mark."""
    uid = str(current_user["_id"])
    if uid not in await groups.group_member_ids(db, group_id) and not await groups.is_elevated(db, uid):
        return error_response("You don't have access to that group.", status_code=403)
    from app.services.chat_service import mark_group_read
    await mark_group_read(db, group_id, uid)
    return success_response(data={"group_id": group_id}, message="Marked read")
