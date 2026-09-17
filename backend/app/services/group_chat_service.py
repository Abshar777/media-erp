"""
Group chat + daily-report scheduler.

One chat group is auto-provisioned per team (members = the team's members).
Groups are full two-way chats. In addition, a scheduler posts each team's
daily task report into its group every day at 21:00 IST (Asia/Kolkata).

Group messages live in the `messages` collection with a `group_id` field set
(and no `to_user_id`), so they never collide with 1:1 direct messages.
"""
import asyncio
import logging
from datetime import datetime, timedelta, timezone

from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.database import get_db

logger = logging.getLogger(__name__)

from app.utils.timezone import IST  # single source of truth for IST (UTC+05:30)
from app.utils.timezone import utc_iso
from app.utils.storage import canonicalize_attachments, sign_attachments
from app.models.chat import sign_reply

_POLL_INTERVAL_SEC = 60
_REPORT_HOUR_IST = 21  # 9 PM IST

# Sentinel sender id for automated report posts (display name is period-aware — see post_daily_report)
SYSTEM_SENDER_ID = "system"

_COMPLETED_STATUS = "approved"

# ── Daily individual-employee report email ────────────────────────────────────
# Fixed recipients who receive the nightly digest of every employee's report.
# Edit this list to change who gets the email (one combined digest, all teams).
DAILY_REPORT_EMAIL_RECIPIENTS = [
    "safavan@deltainstitutions.com",
    "vishnusuresh@deltainstitutions.com",
]


# ── Serialization ─────────────────────────────────────────────────────────────

def group_message_to_dict(doc: dict) -> dict:
    return {
        "id": str(doc["_id"]),
        "group_id": doc.get("group_id", ""),
        "from_user_id": doc.get("from_user_id", ""),
        "from_user_name": doc.get("from_user_name", ""),
        "content": doc.get("content", ""),
        "is_system": bool(doc.get("is_system", False)),
        # Private bucket — attachments are signed per read (see utils/storage.py).
        "attachments": sign_attachments(doc.get("attachments", [])),
        "task_ids": doc.get("task_ids", []),
        "reply_to": sign_reply(doc.get("reply_to")),
        "created_at": utc_iso(doc.get("created_at")),
    }


def _serialize_group(doc: dict) -> dict:
    return {
        "id": str(doc["_id"]),
        "name": doc.get("name", ""),
        "team_id": doc.get("team_id", ""),
        "color": doc.get("color", "#6366f1"),
        "members": doc.get("members", []),
        "member_count": len(doc.get("members", [])),
        "is_report_group": bool(doc.get("is_report_group", True)),
        "is_common": bool(doc.get("is_common", False)),
    }


# ── Provisioning ──────────────────────────────────────────────────────────────

async def ensure_team_groups(db: AsyncIOMotorDatabase) -> None:
    """
    Upsert one report group per team, keeping membership in sync with the team.
    Idempotent — safe to call on every list/scheduler tick.
    """
    now = datetime.now(timezone.utc)
    teams = await db["teams"].find({}).to_list(1000)
    for team in teams:
        team_id = str(team["_id"])
        member_ids = [m["user_id"] for m in team.get("members", [])]
        existing = await db["chat_groups"].find_one({"team_id": team_id})
        if existing:
            # Keep name / colour / membership aligned with the team
            await db["chat_groups"].update_one(
                {"_id": existing["_id"]},
                {"$set": {
                    "name": team.get("name", "Team"),
                    "color": team.get("color", "#6366f1"),
                    "members": member_ids,
                    "updated_at": now,
                }},
            )
        else:
            await db["chat_groups"].insert_one({
                "name": team.get("name", "Team"),
                "team_id": team_id,
                "color": team.get("color", "#6366f1"),
                "members": member_ids,
                "is_report_group": True,
                "created_by": team.get("created_by", ""),
                "last_report_date": None,
                "created_at": now,
                "updated_at": now,
            })


COMMON_GROUP_NAME = "Everyone"


async def ensure_common_group(db: AsyncIOMotorDatabase) -> dict:
    """
    Upsert the single company-wide group and keep its roster in sync with the
    active user list, so people joining or leaving are picked up without anyone
    maintaining it by hand.

    Identified by is_common rather than by name, so renaming it doesn't cause a
    second one to be created. Idempotent — safe on every list/scheduler tick.
    """
    now = datetime.now(timezone.utc)
    users = await db["users"].find(
        {"$and": [
            {"$or": [{"is_active": True}, {"is_active": {"$exists": False}}]},
            {"$or": [{"status": {"$ne": "inactive"}}, {"status": {"$exists": False}}]},
        ]},
        {"_id": 1},
    ).to_list(5000)
    member_ids = [str(u["_id"]) for u in users]

    existing = await db["chat_groups"].find_one({"is_common": True})
    if existing:
        await db["chat_groups"].update_one(
            {"_id": existing["_id"]},
            {"$set": {"members": member_ids, "updated_at": now}},
        )
        return await db["chat_groups"].find_one({"_id": existing["_id"]})

    doc = {
        "name": COMMON_GROUP_NAME,
        # No team_id: this group belongs to the company, not a team, which also
        # keeps ensure_team_groups from ever matching and overwriting it.
        "team_id": None,
        "color": "#0ea5e9",
        "members": member_ids,
        "is_common": True,
        "is_report_group": False,
        "created_by": "",
        "created_at": now,
        "updated_at": now,
    }
    res = await db["chat_groups"].insert_one(doc)
    doc["_id"] = res.inserted_id
    return doc


_ELEVATED_ROLES = {"Super Admin", "Admin", "Coordinator"}


async def is_elevated(db: AsyncIOMotorDatabase, user_id: str) -> bool:
    """True for Super Admin / Admin / Coordinator — they may see & post in any group."""
    if not ObjectId.is_valid(user_id):
        return False
    user = await db["users"].find_one({"_id": ObjectId(user_id)}, {"role_id": 1})
    role_id = (user or {}).get("role_id", "")
    if not role_id or not ObjectId.is_valid(role_id):
        return False
    role = await db["roles"].find_one({"_id": ObjectId(role_id)}, {"role_name": 1})
    return (role or {}).get("role_name", "") in _ELEVATED_ROLES


async def can_access_group(db: AsyncIOMotorDatabase, group_id: str, user_id: str) -> bool:
    """A user can access a group if they are a member or an elevated role."""
    members = await group_member_ids(db, group_id)
    if user_id in members:
        return True
    return await is_elevated(db, user_id)


async def group_member_ids(db: AsyncIOMotorDatabase, group_id: str) -> list[str]:
    if not ObjectId.is_valid(group_id):
        return []
    doc = await db["chat_groups"].find_one({"_id": ObjectId(group_id)}, {"members": 1})
    return doc.get("members", []) if doc else []


async def get_group(db: AsyncIOMotorDatabase, group_id: str) -> dict | None:
    if not ObjectId.is_valid(group_id):
        return None
    return await db["chat_groups"].find_one({"_id": ObjectId(group_id)})


async def list_groups_for_user(
    db: AsyncIOMotorDatabase, user_id: str, include_all: bool = False
) -> list[dict]:
    """Groups the user belongs to (or all groups for elevated roles), with a preview."""
    await ensure_team_groups(db)
    await ensure_common_group(db)
    query = {} if include_all else {"members": user_id}
    docs = await db["chat_groups"].find(query).sort("name", 1).to_list(500)
    out = []
    for d in docs:
        g = _serialize_group(d)
        last = await db["messages"].find_one(
            {"group_id": g["id"]}, sort=[("_id", -1)]
        )
        if last:
            g["last_message"] = last.get("content", "")
            g["last_sender_name"] = last.get("from_user_name", "")
            g["last_at"] = utc_iso(last.get("created_at"))
        else:
            g["last_message"] = ""
            g["last_sender_name"] = ""
            g["last_at"] = None
        out.append(g)
    return out


# ── Messages ──────────────────────────────────────────────────────────────────

async def save_group_message(
    db: AsyncIOMotorDatabase,
    group_id: str,
    from_user_id: str,
    from_user_name: str,
    content: str,
    is_system: bool = False,
    attachments: list | None = None,
    task_ids: list | None = None,
    mention_user_ids: list | None = None,
    reply_to: dict | None = None,
) -> dict:
    doc = {
        "group_id": group_id,
        "from_user_id": from_user_id,
        "from_user_name": from_user_name,
        "content": content,
        "is_system": is_system,
        # Persist `key`, not the read-time signed URL the client sent back.
        "attachments": canonicalize_attachments(attachments),
        "task_ids": task_ids or [],
        "mention_user_ids": mention_user_ids or [],
        "reply_to": reply_to,
        "created_at": datetime.now(timezone.utc),
    }
    result = await db["messages"].insert_one(doc)
    doc["_id"] = result.inserted_id
    return doc


async def get_group_messages(
    db: AsyncIOMotorDatabase,
    group_id: str,
    limit: int = 50,
    before_id: str | None = None,
) -> list[dict]:
    query: dict = {"group_id": group_id}
    if before_id and ObjectId.is_valid(before_id):
        query["_id"] = {"$lt": ObjectId(before_id)}
    cursor = db["messages"].find(query).sort("_id", -1).limit(limit)
    docs = await cursor.to_list(limit)
    return list(reversed(docs))


# ── Daily report text ─────────────────────────────────────────────────────────

def _as_utc(value) -> datetime | None:
    if not isinstance(value, datetime):
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


_PERIOD_LABELS = {"daily": "Daily", "weekly": "Weekly", "monthly": "Monthly"}
_PERIOD_WINDOW_DAYS = {"weekly": 7, "monthly": 30}


def _period_range(period: str) -> tuple[datetime, datetime, str]:
    """
    Return (start_utc, end_utc, date_label) for a report period.

    "daily" is the IST calendar day so far (unchanged behaviour — this is
    what the 21:00 IST scheduler posts once a day). "weekly"/"monthly" are
    rolling windows (last 7 / 30 days up to now) rather than calendar-aligned
    periods, so a report sent on demand always covers "recent activity" no
    matter what day it's triggered.
    """
    ist_now = datetime.now(IST)
    end_utc = ist_now.astimezone(timezone.utc)
    if period == "daily":
        start_utc = ist_now.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc)
        date_label = ist_now.strftime("%d %b %Y")
    else:
        days = _PERIOD_WINDOW_DAYS.get(period, 1)
        start_ist = ist_now - timedelta(days=days)
        start_utc = start_ist.astimezone(timezone.utc)
        date_label = f"{start_ist.strftime('%d %b')} – {ist_now.strftime('%d %b %Y')}"
    return start_utc, end_utc, date_label


async def _team_report_stats(db: AsyncIOMotorDatabase, team: dict, period: str = "daily") -> dict:
    """
    Shared team-level counters for a report period — used by both the chat
    summary message and the PDF export so the two never drift apart.
    """
    team_id = str(team["_id"])
    start_utc, end_utc, date_label = _period_range(period)
    period_label = _PERIOD_LABELS.get(period, "Daily")

    tasks = await db["project_tasks"].find({"team_id": team_id}).to_list(5000)

    created = 0
    completed = 0
    active = 0
    per_member: dict[str, dict] = {}
    for t in tasks:
        status = t.get("status", "pending")
        if status == "started":
            active += 1
        assignee = t.get("assigned_to", "")
        c_at = _as_utc(t.get("created_at"))
        u_at = _as_utc(t.get("updated_at"))
        if c_at and start_utc <= c_at <= end_utc:
            created += 1
            per_member.setdefault(assignee, {"created": 0, "completed": 0})["created"] += 1
        if status == _COMPLETED_STATUS and u_at and start_utc <= u_at <= end_utc:
            completed += 1
            per_member.setdefault(assignee, {"created": 0, "completed": 0})["completed"] += 1

    # Resolve member names
    name_map: dict[str, str] = {}
    ids = [ObjectId(m["user_id"]) for m in team.get("members", []) if ObjectId.is_valid(m["user_id"])]
    if ids:
        for u in await db["users"].find({"_id": {"$in": ids}}, {"name": 1}).to_list(500):
            name_map[str(u["_id"])] = u.get("name", "Unknown")

    return {
        "created": created, "completed": completed, "active": active,
        "per_member": per_member, "name_map": name_map,
        "date_label": date_label, "period_label": period_label,
    }


async def build_daily_report_text(db: AsyncIOMotorDatabase, team: dict, period: str = "daily") -> str:
    """Format a team's task activity over the report period as a chat message."""
    s = await _team_report_stats(db, team, period)
    created, completed, active = s["created"], s["completed"], s["active"]
    per_member, name_map = s["per_member"], s["name_map"]

    lines = [
        f"📊 {s['period_label']} Report — {team.get('name', 'Team')} · {s['date_label']}",
        f"Created: {created} · Completed: {completed} · In progress: {active}",
    ]

    member_lines = []
    for m in team.get("members", []):
        uid = m["user_id"]
        stats = per_member.get(uid)
        if not stats:
            continue
        member_lines.append(
            f"• {name_map.get(uid, 'Unknown')}: {stats['created']} created, {stats['completed']} completed"
        )
    if member_lines:
        lines.append("——")
        lines.extend(member_lines)
    elif created == 0 and completed == 0:
        window = "today" if period == "daily" else f"in the last {_PERIOD_WINDOW_DAYS.get(period, 1)} days"
        lines.append(f"No task activity logged {window}.")

    return "\n".join(lines)


_OPEN_STATUS_LABELS = {
    "pending": "pending",
    "started": "in progress",
    "break": "on break",
    "reedit": "reedit",
    "pending_review": "in review",
}


async def post_member_reports(db: AsyncIOMotorDatabase, group: dict, team: dict, period: str = "daily") -> None:
    """
    Post one message per member into the group: their named tasks done over
    the report period and everything still pending. Members with no tasks
    are skipped.
    """
    team_id = str(team["_id"])
    start_utc, end_utc, date_label = _period_range(period)
    period_label = _PERIOD_LABELS.get(period, "Daily")
    done_label = {"daily": "Done today", "weekly": "Done this week", "monthly": "Done this month"}.get(
        period, "Done today"
    )

    # Resolve member names
    name_map: dict[str, str] = {}
    ids = [ObjectId(m["user_id"]) for m in team.get("members", []) if ObjectId.is_valid(m["user_id"])]
    if ids:
        for u in await db["users"].find({"_id": {"$in": ids}}, {"name": 1}).to_list(500):
            name_map[str(u["_id"])] = u.get("name", "Unknown")

    tasks = await db["project_tasks"].find({"team_id": team_id}).to_list(5000)

    for m in team.get("members", []):
        uid = m["user_id"]
        done_today: list[dict] = []
        pending: list[dict] = []
        for t in tasks:
            if t.get("assigned_to") != uid:
                continue
            status = t.get("status", "pending")
            u_at = _as_utc(t.get("updated_at"))
            if status == _COMPLETED_STATUS:
                if u_at and start_utc <= u_at <= end_utc:
                    done_today.append(t)
            else:
                pending.append(t)

        if not done_today and not pending:
            continue  # nothing to report for this member

        lines = [f"🧑 {name_map.get(uid, 'Member')} — {period_label} Report · {date_label}"]
        lines.append(f"✅ {done_label}: {len(done_today)}")
        for t in done_today[:15]:
            lines.append(f"   • {t.get('title', 'Task')}")
        lines.append(f"⏳ Pending: {len(pending)}")
        for t in pending[:15]:
            label = _OPEN_STATUS_LABELS.get(t.get("status", "pending"), t.get("status", "pending"))
            lines.append(f"   • {t.get('title', 'Task')} ({label})")

        task_ids = [str(t["_id"]) for t in (done_today + pending)]
        await save_group_message(
            db,
            group_id=str(group["_id"]),
            from_user_id=uid,
            from_user_name=name_map.get(uid, "Member"),
            content="\n".join(lines),
            is_system=True,
            task_ids=task_ids,
        )


async def post_daily_report(db: AsyncIOMotorDatabase, group: dict, team: dict, period: str = "daily") -> None:
    """Post the team summary followed by each member's named done/pending report."""
    text = await build_daily_report_text(db, team, period=period)
    sender_name = f"📊 {_PERIOD_LABELS.get(period, 'Daily')} Report"
    await save_group_message(
        db,
        group_id=str(group["_id"]),
        from_user_id=SYSTEM_SENDER_ID,
        from_user_name=sender_name,
        content=text,
        is_system=True,
    )
    await post_member_reports(db, group, team, period=period)


# ── Daily individual-employee report email digest ─────────────────────────────

async def _member_report_rows(db: AsyncIOMotorDatabase, team: dict, period: str = "daily") -> list[dict]:
    """
    For every member of a team (no one skipped), return their tasks completed
    over the report period and everything still pending.
    """
    team_id = str(team["_id"])
    start_utc, end_utc, _ = _period_range(period)

    name_map: dict[str, str] = {}
    ids = [ObjectId(m["user_id"]) for m in team.get("members", []) if ObjectId.is_valid(m["user_id"])]
    if ids:
        for u in await db["users"].find({"_id": {"$in": ids}}, {"name": 1, "email": 1}).to_list(500):
            name_map[str(u["_id"])] = u.get("name") or u.get("email") or "Member"

    tasks = await db["project_tasks"].find({"team_id": team_id}).to_list(5000)

    rows: list[dict] = []
    for m in team.get("members", []):
        uid = m["user_id"]
        done_today: list[str] = []
        pending: list[tuple[str, str]] = []
        for t in tasks:
            if t.get("assigned_to") != uid:
                continue
            status = t.get("status", "pending")
            u_at = _as_utc(t.get("updated_at"))
            if status == _COMPLETED_STATUS:
                if u_at and start_utc <= u_at <= end_utc:
                    done_today.append(t.get("title", "Task"))
            else:
                pending.append((t.get("title", "Task"), _OPEN_STATUS_LABELS.get(status, status)))
        rows.append({"name": name_map.get(uid, "Member"), "done": done_today, "pending": pending})
    return rows


def _esc(s: str) -> str:
    return (s or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


# ── Report PDF export ────────────────────────────────────────────────────────

async def build_group_report_pdf(db: AsyncIOMotorDatabase, team: dict, period: str = "monthly") -> bytes:
    """Render a team's report (summary + per-member breakdown) as a PDF."""
    import io as _io
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer

    stats = await _team_report_stats(db, team, period)
    rows = await _member_report_rows(db, team, period)

    buf = _io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        leftMargin=15 * mm, rightMargin=15 * mm, topMargin=15 * mm, bottomMargin=15 * mm,
    )

    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "Title", parent=styles["Normal"], fontSize=16, fontName="Helvetica-Bold",
        textColor=colors.HexColor("#18181B"), spaceAfter=4,
    )
    subtitle_style = ParagraphStyle(
        "Subtitle", parent=styles["Normal"], fontSize=10, fontName="Helvetica",
        textColor=colors.HexColor("#6B7280"), spaceAfter=10,
    )
    summary_style = ParagraphStyle(
        "Summary", parent=styles["Normal"], fontSize=10.5, fontName="Helvetica-Bold",
        textColor=colors.HexColor("#18181B"), spaceAfter=14,
    )
    section_style = ParagraphStyle(
        "Section", parent=styles["Normal"], fontSize=11, fontName="Helvetica-Bold",
        textColor=colors.HexColor("#18181B"), spaceBefore=4, spaceAfter=6,
    )
    cell_style = ParagraphStyle(
        "Cell", parent=styles["Normal"], fontSize=8, fontName="Helvetica",
        wordWrap="CJK", leading=11,
    )
    cell_bold = ParagraphStyle("CellBold", parent=cell_style, fontName="Helvetica-Bold", fontSize=9)

    period_label = stats["period_label"]
    team_name = team.get("name", "Team")

    story = [
        Paragraph(f"{_esc(team_name)} — {period_label} Report", title_style),
        Paragraph(
            f"Period: {_esc(stats['date_label'])}  |  "
            f"Generated: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}",
            subtitle_style,
        ),
        Paragraph(
            f"Created: {stats['created']} &nbsp;&middot;&nbsp; "
            f"Completed: {stats['completed']} &nbsp;&middot;&nbsp; "
            f"In progress: {stats['active']}",
            summary_style,
        ),
        Paragraph("Per-member breakdown", section_style),
    ]

    header = ["Member", "Completed", "Pending"]
    data = [header]
    for r in rows:
        done_lines = "<br/>".join(_esc(t) for t in r["done"][:20])
        done_text = f"<b>{len(r['done'])}</b>" + (f"<br/>{done_lines}" if done_lines else "")
        pending_lines = "<br/>".join(f"{_esc(t)} ({_esc(lbl)})" for t, lbl in r["pending"][:20])
        pend_text = f"<b>{len(r['pending'])}</b>" + (f"<br/>{pending_lines}" if pending_lines else "")
        data.append([
            Paragraph(_esc(r["name"]), cell_bold),
            Paragraph(done_text, cell_style),
            Paragraph(pend_text, cell_style),
        ])

    if len(data) == 1:
        data.append([Paragraph("No members in this team.", cell_style), "", ""])

    col_widths = [45 * mm, 65 * mm, 65 * mm]
    table = Table(data, colWidths=col_widths, repeatRows=1)
    table.setStyle(TableStyle([
        ("BACKGROUND",     (0, 0), (-1, 0), colors.HexColor("#18181B")),
        ("TEXTCOLOR",      (0, 0), (-1, 0), colors.white),
        ("FONTNAME",       (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE",       (0, 0), (-1, 0), 9),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F9FAFB")]),
        ("GRID",           (0, 0), (-1, -1), 0.4, colors.HexColor("#E5E7EB")),
        ("VALIGN",         (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING",     (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING",  (0, 0), (-1, -1), 6),
        ("LEFTPADDING",    (0, 0), (-1, -1), 6),
        ("RIGHTPADDING",   (0, 0), (-1, -1), 6),
    ]))
    story.append(table)

    doc.build(story)
    return buf.getvalue()


def _digest_html(sections: list[dict], date_label: str) -> str:
    """Build the combined all-teams individual-employee digest email."""
    blocks: list[str] = []
    total_done = 0
    for sec in sections:
        member_html: list[str] = []
        for r in sec["rows"]:
            total_done += len(r["done"])
            done_items = "".join(
                f'<li style="color:#166534;font-size:13px;line-height:1.6;">{_esc(t)}</li>' for t in r["done"]
            ) or '<li style="color:#9ca3af;font-size:13px;list-style:none;margin-left:-18px;">— nothing completed today</li>'
            pend_items = "".join(
                f'<li style="color:#374151;font-size:13px;line-height:1.6;">{_esc(t)} '
                f'<span style="color:#9ca3af;">({_esc(lbl)})</span></li>' for t, lbl in r["pending"]
            ) or '<li style="color:#9ca3af;font-size:13px;list-style:none;margin-left:-18px;">— none pending</li>'
            member_html.append(
                f'''
                <tr><td style="padding:12px 16px;border-top:1px solid #eef0f3;">
                  <div style="font-size:14px;font-weight:600;color:#111827;">{_esc(r["name"])}</div>
                  <div style="margin-top:6px;font-size:12px;font-weight:700;color:#166534;text-transform:uppercase;letter-spacing:.4px;">✅ Done today ({len(r["done"])})</div>
                  <ul style="margin:2px 0 0 18px;padding:0;">{done_items}</ul>
                  <div style="margin-top:8px;font-size:12px;font-weight:700;color:#b45309;text-transform:uppercase;letter-spacing:.4px;">⏳ Pending ({len(r["pending"])})</div>
                  <ul style="margin:2px 0 0 18px;padding:0;">{pend_items}</ul>
                </td></tr>'''
            )
        if not sec["rows"]:
            member_html.append(
                '<tr><td style="padding:14px 16px;border-top:1px solid #eef0f3;color:#9ca3af;font-size:13px;">No members in this team.</td></tr>'
            )
        blocks.append(
            f'''
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
                   style="margin:0 0 18px 0;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;background:#ffffff;">
              <tr><td style="padding:12px 16px;background:{sec["color"]}14;border-bottom:1px solid #e5e7eb;">
                <span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:{sec["color"]};margin-right:8px;"></span>
                <span style="font-size:15px;font-weight:700;color:#111827;">{_esc(sec["name"])}</span>
              </td></tr>
              {"".join(member_html)}
            </table>'''
        )

    return f'''\
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:28px 0;">
    <tr><td align="center">
      <table role="presentation" width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;">
        <tr><td style="padding:0 4px 18px 4px;">
          <div style="font-size:20px;font-weight:800;color:#111827;">📊 Daily Employee Reports</div>
          <div style="font-size:13px;color:#6b7280;margin-top:2px;">{date_label} · {len(sections)} team(s) · {total_done} task(s) completed today</div>
        </td></tr>
        <tr><td>{"".join(blocks)}</td></tr>
        <tr><td style="padding:10px 4px 0 4px;">
          <div style="font-size:11px;color:#9ca3af;">Automated nightly report from mediaERP · Delta Institutions</div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>'''


async def email_daily_report_digest(db: AsyncIOMotorDatabase) -> None:
    """Email one combined digest of every employee's daily report (all teams) to the fixed recipients."""
    if not DAILY_REPORT_EMAIL_RECIPIENTS:
        return
    from app.utils.email import send_email

    ist_now = datetime.now(IST)
    date_label = ist_now.strftime("%d %b %Y")
    teams = await db["teams"].find({}).sort("name", 1).to_list(1000)

    sections: list[dict] = []
    for team in teams:
        rows = await _member_report_rows(db, team)
        sections.append({"name": team.get("name", "Team"), "color": team.get("color", "#6366f1"), "rows": rows})

    html = _digest_html(sections, date_label)
    subject = f"Daily Employee Reports — {date_label}"
    for to in DAILY_REPORT_EMAIL_RECIPIENTS:
        try:
            await send_email(to, subject, html, category="daily_report")
            logger.info("Daily employee report digest emailed to %s", to)
        except Exception as exc:
            logger.error("Failed to email daily report digest to %s: %s", to, exc)


# ── Scheduler ─────────────────────────────────────────────────────────────────

async def _scheduler_loop(db: AsyncIOMotorDatabase):
    """Every minute: at/after 21:00 IST, post each team group's daily report once per day."""
    while True:
        try:
            await ensure_team_groups(db)
            ist_now = datetime.now(IST)
            today_key = ist_now.strftime("%Y-%m-%d")
            if ist_now.hour >= _REPORT_HOUR_IST:
                groups = await db["chat_groups"].find({"is_report_group": True}).to_list(1000)
                for group in groups:
                    if group.get("last_report_date") == today_key:
                        continue
                    team = await db["teams"].find_one({"_id": ObjectId(group["team_id"])}) \
                        if ObjectId.is_valid(group.get("team_id", "")) else None
                    if not team:
                        continue
                    try:
                        await post_daily_report(db, group, team)
                        await db["chat_groups"].update_one(
                            {"_id": group["_id"]},
                            {"$set": {"last_report_date": today_key, "updated_at": datetime.now(timezone.utc)}},
                        )
                        logger.info("Posted daily report to group '%s'", group.get("name"))
                    except Exception as exc:
                        logger.error("Failed to post daily report for group %s: %s", group["_id"], exc)

                # Individual-employee digest email → fixed recipients (once per day, all teams)
                state = await db["system_state"].find_one({"_id": "daily_report_email"})
                if not state or state.get("last_sent_date") != today_key:
                    try:
                        await email_daily_report_digest(db)
                        await db["system_state"].update_one(
                            {"_id": "daily_report_email"},
                            {"$set": {"last_sent_date": today_key, "updated_at": datetime.now(timezone.utc)}},
                            upsert=True,
                        )
                        logger.info("Sent daily employee report digest for %s", today_key)
                    except Exception as exc:
                        logger.error("Failed to send daily report email digest: %s", exc)
        except Exception as exc:
            logger.error("Group report scheduler loop error: %s", exc)
        await asyncio.sleep(_POLL_INTERVAL_SEC)


def start_group_report_scheduler():
    """Entry-point called from main.py lifespan — runs in a daemon thread."""
    async def _run():
        from motor.motor_asyncio import AsyncIOMotorClient
        from app.config import settings
        client = AsyncIOMotorClient(settings.mongodb_url)
        db = client[settings.mongodb_db_name]
        await _scheduler_loop(db)

    try:
        loop = asyncio.new_event_loop()
        loop.run_until_complete(_run())
    except Exception as exc:
        logger.error("Group report scheduler thread crashed: %s", exc)
