"""
Overview report — the Overview page, as a PDF.

The tasks come from routers.projects.query_scoped_tasks (the same call that
feeds the Overview), and every number here uses the Overview's own formulas
(frontend/app/(dashboard)/dashboard/page.tsx), so the download always matches
the screen for the same filters:

  total          every task in scope
  in progress    status started + break
  pending review status pending_review
  approved       status approved
  overdue        due date before today (IST) and not approved
  avg completion mean timing.total_seconds over approved tasks that have one,
                 rounded like JS Math.round, shown like formatSeconds()
  due soon       due today … today+7 (IST), not approved

`summarize` is pure (no I/O) so it can be tested on its own; `build_pdf`
only lays the numbers out.
"""
from __future__ import annotations

import io
import math
import re
from datetime import date, datetime, timedelta
from xml.sax.saxutils import escape as _xml_escape

from app.utils.timezone import IST, today_ist

# Mirrors BOARD_COLUMNS in frontend/types/project.ts (order + colours).
BOARD_COLUMNS: list[tuple[str, str, str]] = [
    ("pending", "Pending", "#f59e0b"),
    ("started", "Started", "#3b82f6"),
    ("break", "Break", "#f97316"),
    ("reedit", "Reedit", "#f43f5e"),
    ("pending_review", "Pending Review", "#a855f7"),
    ("approved", "Approved", "#22c55e"),
]
_STATUS_LABEL = {k: label for k, label, _ in BOARD_COLUMNS}
_PRIORITY_LABEL = {"low": "Low", "medium": "Medium", "high": "High"}
_PRIORITY_COLOR = {"low": "#94a3b8", "medium": "#f59e0b", "high": "#ef4444"}

# Friendly names the Overview's date picker sends along (display only — the
# dates themselves always come from the real filter).
TITLE_MAX = 240   # characters of a task title shown in the PDF

RANGE_NAMES = {
    "today": "Today", "yesterday": "Yesterday", "last7": "Last 7 days",
    "this_week": "This week", "this_month": "This month", "last_month": "Last month",
    "this_year": "This year", "custom": "Custom range",
}


# ── Formatting helpers ──────────────────────────────────────────────────────

def format_seconds(s: int) -> str:
    """Same output as formatSeconds() in hooks/useTaskTimer.ts."""
    h, m, sec = s // 3600, (s % 3600) // 60, s % 60
    if h > 0:
        return f"{h}h {m}m"
    if m > 0:
        return f"{m}m {sec}s"
    return f"{sec}s"


def _js_round(x: float) -> int:
    """JavaScript Math.round (half up), not Python's banker's rounding."""
    return int(math.floor(x + 0.5))


def _day(d: date, with_year: bool = True) -> str:
    return f"{d.day} {d.strftime('%b')}" + (f" {d.year}" if with_year else "")


def _span(a: date, b: date) -> str:
    if a == b:
        return _day(a)
    if a.year == b.year:
        return f"{_day(a, False)} – {_day(b)}"
    return f"{_day(a)} – {_day(b)}"


def _parse_day(v: str) -> date | None:
    try:
        return datetime.strptime(v, "%Y-%m-%d").date()
    except (TypeError, ValueError):
        return None


def describe_period(date_filter: str, date_from: str, date_to: str,
                    range_name: str = "", today: date | None = None) -> tuple[str, str]:
    """
    (label, filename part) for the filter that was ACTUALLY applied.

    Mirrors list_tasks: an unknown preset or an unparseable custom date applies
    no date filter at all, so it is reported as "All time" — never a date
    heading over all-time numbers.
    """
    t = today or today_ist()
    name = RANGE_NAMES.get(range_name, "")
    if date_filter in ("today", "this_week", "this_month", "this_year"):
        start = {
            "today": t,
            "this_week": t - timedelta(days=t.weekday()),
            "this_month": t.replace(day=1),
            "this_year": t.replace(month=1, day=1),
        }[date_filter]
        return f"{RANGE_NAMES[date_filter]} · {_span(start, t)}", date_filter.replace("_", "-")
    if date_filter == "custom":
        a, b = _parse_day(date_from), _parse_day(date_to)
        if a and b:
            span = _span(a, b)
            label = f"{name} · {span}" if name and range_name != "custom" else span
            return label, a.isoformat() if a == b else f"{a.isoformat()}_to_{b.isoformat()}"
    return "All time", "all-time"


def slug(text: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")
    return s[:40] or "member"


def pdf_text(v, limit: int | None = None) -> str:
    """
    Text that Helvetica can draw, escaped for a reportlab Paragraph.
    Characters outside cp1252 (emoji, other scripts) are dropped rather than
    printed as empty boxes. `limit` clips very long text with an ellipsis: a
    table row taller than a page can't be laid out at all (a 5,000-character
    title used to fail the whole export).
    """
    s = "" if v is None else str(v)
    s = "".join(ch for ch in s if _cp1252_ok(ch))
    if limit and len(s) > limit:
        s = s[: limit - 1].rstrip() + "…"
    return _xml_escape(s)


def _cp1252_ok(ch: str) -> bool:
    try:
        ch.encode("cp1252")
        return ch >= " " or ch in "\t"
    except UnicodeEncodeError:
        return False


def _created_day(task: dict) -> date | None:
    v = task.get("created_at")
    if not v:
        return None
    try:
        d = datetime.fromisoformat(str(v).replace("Z", "+00:00"))
    except ValueError:
        return None
    if d.tzinfo is None:
        from datetime import timezone as _tz
        d = d.replace(tzinfo=_tz.utc)
    return d.astimezone(IST).date()


def _due_key(task: dict) -> str:
    return str(task.get("due_date") or "")[:10]


# ── Task timeline (pure) — the "All tasks" table ────────────────────────────

def fmt_duration(sec: float | int | None) -> str:
    """37h 03m · 50m · 8s — the task table's format (whole minutes once past a minute)."""
    if sec is None:
        return "—"
    sec = int(sec)
    h, m, s_ = sec // 3600, (sec % 3600) // 60, sec % 60
    if h:
        return f"{h}h {m:02d}m"
    if m:
        return f"{m}m"
    return f"{s_}s"


def _ts(v) -> datetime | None:
    """ISO string or datetime → aware UTC (naive values are UTC, as Mongo stores them)."""
    if not v:
        return None
    if isinstance(v, datetime):
        d = v
    else:
        try:
            d = datetime.fromisoformat(str(v).replace("Z", "+00:00"))
        except ValueError:
            return None
    from datetime import timezone as _tz
    return d if d.tzinfo else d.replace(tzinfo=_tz.utc)


def task_timeline(task: dict, holidays: frozenset = frozenset(), now: datetime | None = None) -> dict:
    """
    One row of the task table, measured the way the Performance report measures:
      assigned   last "assigned"/"transferred", else when the task was created
      started    first "started"
      ended      when the timer last stopped (else the last submission for review)
      completed  last "approved" (approved tasks only). Older tasks were approved
                 before history was kept (24 of 37 in the dev data): their last
                 update is used instead and flagged `completed_estimated`
      took       the task timer's tracked time (timing.total_seconds — the number the
                 Overview averages), else the raw sum of its intervals
      late       WORKING seconds (11:00–20:30 IST, Mon–Sat, company holidays off)
                 from the end of the due day (IST) to completion —
                 or to now for a task that is still open ("so far")
    """
    from app.services.worktime import working_seconds
    from datetime import time as _time, timezone as _tz
    now = now or datetime.now(_tz.utc)
    hist = [(h.get("action"), _ts(h.get("timestamp"))) for h in task.get("history") or []]
    hist = [(a, t_) for a, t_ in hist if t_]

    def first(*actions):
        xs = sorted(t_ for a, t_ in hist if a in actions)
        return xs[0] if xs else None

    def last(*actions):
        xs = sorted(t_ for a, t_ in hist if a in actions)
        return xs[-1] if xs else None

    intervals = [{"started_at": _ts(i.get("started_at")), "ended_at": _ts(i.get("ended_at"))}
                 for i in (task.get("timing") or {}).get("intervals") or [] if isinstance(i, dict)]
    running = any(i["started_at"] and not i["ended_at"] for i in intervals)
    stops = sorted(i["ended_at"] for i in intervals if i["ended_at"])
    started = first("started") or min((i["started_at"] for i in intervals if i["started_at"]), default=None)
    ended = None if running else (stops[-1] if stops else last("pending_review"))
    completed = last("approved") if task.get("status") == "approved" else None
    completed_estimated = False
    if task.get("status") == "approved" and completed is None:
        completed = _ts(task.get("updated_at"))
        completed_estimated = completed is not None

    took = (task.get("timing") or {}).get("total_seconds")
    if took is None and intervals:
        took = sum(((i["ended_at"] or now) - i["started_at"]).total_seconds()
                   for i in intervals if i["started_at"])

    due = _parse_day(_due_key(task))
    late = None
    late_open = False
    if due:
        due_end = datetime.combine(due, _time.max, tzinfo=IST)
        until = completed or (None if task.get("status") == "approved" else now)
        if until and until > due_end:
            late = working_seconds(due_end, until, holidays)
            late_open = completed is None
    return {
        "assigned": last("assigned", "transferred") or _ts(task.get("created_at")),
        "due": due, "started": started, "ended": ended, "running": running, "completed": completed,
        "completed_estimated": completed_estimated,
        "took": took, "late": late, "late_open": late_open,
    }


# ── Numbers (pure) ──────────────────────────────────────────────────────────

def summarize(tasks: list[dict], today: date | None = None) -> dict:
    """Every figure on the Overview, from the same task list."""
    t = today or today_ist()
    now, week = t.isoformat(), (t + timedelta(days=7)).isoformat()

    def is_overdue(x: dict) -> bool:
        due = _due_key(x)
        return bool(due) and x.get("status") != "approved" and due < now

    approved_timed = [x for x in tasks if x.get("status") == "approved"
                      and (x.get("timing") or {}).get("total_seconds") is not None]
    avg = (_js_round(sum(x["timing"]["total_seconds"] for x in approved_timed) / len(approved_timed))
           if approved_timed else None)

    due_soon = [x for x in tasks if _due_key(x) and now <= _due_key(x) <= week
                and x.get("status") != "approved"]
    due_soon.sort(key=_due_key)

    counts: dict[str, int] = {}
    for x in tasks:
        counts[x.get("status", "")] = counts.get(x.get("status", ""), 0) + 1
    pipeline = [{"key": k, "label": label, "color": color, "count": counts.get(k, 0)}
                for k, label, color in BOARD_COLUMNS]
    # A custom Kanban column the board doesn't know still has to be counted.
    for k, n in counts.items():
        if k not in _STATUS_LABEL:
            pipeline.append({"key": k, "label": (k or "No status").replace("_", " ").title(),
                             "color": "#94a3b8", "count": n})

    approved = counts.get("approved", 0)
    return {
        "total": len(tasks),
        "in_progress": counts.get("started", 0) + counts.get("break", 0),
        "pending_review": counts.get("pending_review", 0),
        "approved": approved,
        "overdue": sum(1 for x in tasks if is_overdue(x)),
        "avg_seconds": avg,
        "avg_label": format_seconds(avg) if avg is not None else None,
        "avg_sub": (f"across {approved} approved task{'' if approved == 1 else 's'}"
                    if avg is not None else "No completed tasks yet"),
        "pipeline": pipeline,
        "due_soon": due_soon,
        "overdue_ids": {x.get("id") for x in tasks if is_overdue(x)},
    }


def team_rows(tasks: list[dict], team_names: dict[str, str]) -> list[dict]:
    """Per team, the same figures as the Overview's team cards."""
    groups: dict[str, list[dict]] = {}
    for x in tasks:
        groups.setdefault(x.get("team_id") or "", []).append(x)
    rows = []
    for tid, items in groups.items():
        done = sum(1 for x in items if x.get("status") == "approved")
        rows.append({
            "name": team_names.get(tid) or ("No team (personal)" if not tid else "Unknown team"),
            "tasks": len(items),
            "active": sum(1 for x in items if x.get("status") == "started"),
            "done": done,
            "pct": _js_round(done / len(items) * 100) if items else 0,
        })
    rows.sort(key=lambda r: (-r["tasks"], r["name"].lower()))
    return rows


# ── Layout ──────────────────────────────────────────────────────────────────

def build_pdf(*, tasks: list[dict], heading: str, scope_line: str, period_label: str,
              generated_by: str, team_names: dict[str, str], today: date | None = None,
              holidays: frozenset = frozenset(), people: dict[str, str] | None = None) -> bytes:
    from reportlab.lib import colors
    from reportlab.lib.enums import TA_CENTER
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.graphics.shapes import Drawing, Rect
    from reportlab.pdfgen import canvas as _canvas
    from reportlab.lib.enums import TA_RIGHT
    from reportlab.platypus import (
        BaseDocTemplate, Frame, KeepTogether, NextPageTemplate, PageBreak, PageTemplate,
        Paragraph, Spacer, Table, TableStyle,
    )

    t = today or today_ist()
    stats = summarize(tasks, t)
    INK, MUTED, LINE, SOFT = (colors.HexColor(c) for c in ("#18181B", "#6B7280", "#E5E7EB", "#F9FAFB"))
    BRAND = colors.HexColor("#2563EB")
    generated_at = datetime.now(IST).strftime("%d %b %Y, %I:%M %p IST").lstrip("0")

    def style(name, **kw):
        base = dict(fontName="Helvetica", fontSize=9, leading=12, textColor=INK)
        base.update(kw)
        return ParagraphStyle(name, **base)

    s_brand = style("brand", fontName="Helvetica-Bold", fontSize=8, textColor=BRAND, leading=10)
    s_title = style("title", fontName="Helvetica-Bold", fontSize=18, leading=22)
    s_meta = style("meta", fontSize=9.5, textColor=MUTED, leading=13)
    s_meta_b = style("metab", fontName="Helvetica-Bold", fontSize=9.5, leading=13)
    s_h2 = style("h2", fontName="Helvetica-Bold", fontSize=11.5, leading=14, spaceBefore=12, spaceAfter=6)
    s_tile_l = style("tilel", fontName="Helvetica-Bold", fontSize=7, textColor=MUTED, leading=9)
    s_tile_sub = style("tiles", fontSize=7, textColor=MUTED, leading=9)
    s_cell = style("cell", fontSize=8, leading=10, wordWrap="CJK")
    s_cell_m = style("cellm", fontSize=8, leading=10, textColor=MUTED, wordWrap="CJK")
    s_cell_b = style("cellb", fontName="Helvetica-Bold", fontSize=8, leading=10, wordWrap="CJK")
    # Light header row (grey text on a soft grey band), as in the team's task report.
    s_head = style("head", fontName="Helvetica-Bold", fontSize=7.5, leading=9, textColor=MUTED)
    s_head_r = style("headr", fontName="Helvetica-Bold", fontSize=7.5, leading=9, textColor=MUTED, alignment=TA_RIGHT)
    s_num = style("num", fontSize=8, leading=10, alignment=TA_RIGHT)
    s_empty = style("empty", fontSize=9.5, textColor=MUTED, alignment=TA_CENTER, leading=14)

    buf = io.BytesIO()
    # Portrait for the summary; the task table (ten columns) gets landscape pages.
    M, MB = 14 * mm, 16 * mm
    LS = landscape(A4)
    doc = BaseDocTemplate(buf, pagesize=A4, leftMargin=M, rightMargin=M, topMargin=M, bottomMargin=MB,
                          title=f"{heading} — {period_label}", author="mediaERP", subject="Overview report")

    def frame(size, fid):
        return Frame(M, MB, size[0] - 2 * M, size[1] - M - MB, id=fid,
                     leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)

    doc.addPageTemplates([PageTemplate(id="portrait", pagesize=A4, frames=[frame(A4, "p")]),
                          PageTemplate(id="landscape", pagesize=LS, frames=[frame(LS, "l")])])
    W, WL = A4[0] - 2 * M, LS[0] - 2 * M

    class NumberedCanvas(_canvas.Canvas):
        """Footer with "Page X of Y" (needs the page count, so pages are buffered)."""
        def __init__(self, *a, **k):
            super().__init__(*a, **k)
            self._pages = []

        def showPage(self):
            self._pages.append(dict(self.__dict__))
            self._startPage()

        def save(self):
            n = len(self._pages)
            for page in self._pages:
                self.__dict__.update(page)
                self.setFont("Helvetica", 7.5)
                self.setFillColor(MUTED)
                footer = f"mediaERP · Overview report · {heading} · {period_label}"
                self.drawString(14 * mm, 9 * mm, "".join(ch for ch in footer if _cp1252_ok(ch))[:110])
                self.drawRightString(self._pagesize[0] - 14 * mm, 9 * mm, f"Page {self._pageNumber} of {n}")
                super().showPage()
            super().save()

    story = [
        Paragraph("MEDIAERP · OVERVIEW REPORT", s_brand),
        Spacer(1, 2),
        Paragraph(pdf_text(heading, 90), s_title),
    ]
    if scope_line:
        story.append(Paragraph(pdf_text(scope_line, 400), s_meta))
    story += [
        Spacer(1, 4),
        Paragraph(f"Tasks created: <font name='Helvetica-Bold' color='#18181B'>{pdf_text(period_label)}</font>", s_meta),
        Paragraph(f"Generated {pdf_text(generated_at)} by {pdf_text(generated_by, 80)}", s_meta),
        Spacer(1, 10),
    ]

    # Summary tiles — the six KPI cards.
    tiles = [
        ("TOTAL TASKS", str(stats["total"]), "#18181B", ""),
        ("IN PROGRESS", str(stats["in_progress"]), "#2563EB", ""),
        ("PENDING REVIEW", str(stats["pending_review"]), "#9333EA", ""),
        ("APPROVED", str(stats["approved"]), "#16A34A", ""),
        ("OVERDUE", str(stats["overdue"]), "#DC2626" if stats["overdue"] else "#18181B",
         "Needs attention" if stats["overdue"] else "All on time"),
        ("AVG COMPLETION", stats["avg_label"] or "—", "#4F46E5", stats["avg_sub"]),
    ]
    tile_cells = [[
        [Paragraph(label, s_tile_l), Spacer(1, 3),
         Paragraph(pdf_text(value), style(f"v{i}", fontName="Helvetica-Bold", fontSize=17, leading=20,
                                          textColor=colors.HexColor(color))),
         Paragraph(pdf_text(sub), s_tile_sub)]
        for i, (label, value, color, sub) in enumerate(tiles)
    ]]
    tw = (W - 5 * 4) / 6
    tile_tbl = Table(tile_cells, colWidths=[tw] * 6, rowHeights=[22 * mm])
    tile_tbl.setStyle(TableStyle([
        ("BOX", (i, 0), (i, 0), 0.6, LINE) for i in range(6)
    ] + [
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 7), ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
    ]))
    story.append(tile_tbl)

    total = stats["total"]
    if total == 0:
        story += [Spacer(1, 18), Paragraph("No tasks were created in this period.", s_empty)]
        doc.build(story, canvasmaker=NumberedCanvas)
        return buf.getvalue()

    # Task pipeline — stacked bar + legend, like the Overview.
    bar = Drawing(W, 9)
    x = 0.0
    for p in stats["pipeline"]:
        if p["count"]:
            w = W * p["count"] / total
            bar.add(Rect(x, 0, max(w - 1, 0.5), 9, fillColor=colors.HexColor(p["color"]), strokeColor=None))
            x += w
    # Legend: three per row, so "Pending Review 1 (4%)" never wraps.
    items = [Paragraph(
        f"<font color='{p['color']}' size='12'>•</font> {pdf_text(p['label'], 30)} "
        f"<font name='Helvetica-Bold'>{p['count']}</font> "
        f"<font color='#6B7280'>({_js_round(p['count'] / total * 100)}%)</font>", s_cell)
        for p in stats["pipeline"]]
    per_row = 3
    legend = [items[i:i + per_row] + [""] * (per_row - len(items[i:i + per_row]))
              for i in range(0, len(items), per_row)]
    leg_tbl = Table(legend, colWidths=[W / per_row] * per_row)
    leg_tbl.setStyle(TableStyle([("LEFTPADDING", (0, 0), (-1, -1), 0), ("TOPPADDING", (0, 0), (-1, -1), 3),
                                 ("BOTTOMPADDING", (0, 0), (-1, -1), 1)]))
    story.append(KeepTogether([Paragraph("Task pipeline", s_h2), bar, leg_tbl]))

    def grid(data, widths, *, pad=5):
        """Clean report table: soft grey header band, hairline rows, no zebra."""
        # splitInRow: a row that still can't fit a page is split, never an error.
        tbl = Table(data, colWidths=widths, repeatRows=1, splitInRow=1)
        tbl.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#F4F4F5")),
            ("LINEBELOW", (0, 0), (-1, 0), 0.6, LINE),
            ("LINEBELOW", (0, 1), (-1, -1), 0.4, LINE),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ("LEFTPADDING", (0, 0), (-1, -1), pad), ("RIGHTPADDING", (0, 0), (-1, -1), pad),
        ]))
        return tbl

    # Teams.
    rows = team_rows(tasks, team_names)
    data = [[Paragraph(h, s_head) for h in ("Team", "Tasks", "Active", "Done", "Complete")]]
    for r in rows:
        data.append([Paragraph(pdf_text(r["name"], 80), s_cell_b), Paragraph(str(r["tasks"]), s_cell),
                     Paragraph(str(r["active"]), s_cell), Paragraph(str(r["done"]), s_cell),
                     Paragraph(f"{r['pct']}%", s_cell)])
    story += [Paragraph("Teams", s_h2), grid(data, [W * .44, W * .14, W * .14, W * .14, W * .14])]

    # Upcoming deadlines (next 7 days).
    story.append(Paragraph("Upcoming deadlines <font size='8.5' color='#6B7280'>(next 7 days, not approved)</font>", s_h2))
    if stats["due_soon"]:
        data = [[Paragraph(h, s_head) for h in ("Due", "Task", "Assignee", "Status")]]
        for x_ in stats["due_soon"]:
            d = _parse_day(_due_key(x_))
            data.append([Paragraph(_day(d, False) if d else "", s_cell_b), Paragraph(pdf_text(x_.get("title"), TITLE_MAX), s_cell),
                         Paragraph(pdf_text(x_.get("assigned_to_name") or x_.get("assigned_to"), 60), s_cell_m),
                         Paragraph(pdf_text(_STATUS_LABEL.get(x_.get("status"), x_.get("status"))), s_cell)])
        story.append(grid(data, [W * .12, W * .5, W * .2, W * .18]))
    else:
        story.append(Paragraph("No deadlines in the next 7 days.", s_cell_m))

    # Every task — its own landscape pages, in the team's task-report layout:
    # # · Task · Assignee · Assigned · Due · Started · Ended · Completed · Time took · Late by
    now = datetime.now(IST)

    def who_is(task: dict) -> str:
        # The stored name, else the person's current name — never a raw id.
        return (task.get("assigned_to_name") or (people or {}).get(task.get("assigned_to") or "", "")).strip()

    GREY = "<font color='#9CA3AF'>{}</font>"

    def stamp(d: datetime | None) -> str:
        if not d:
            return ""
        d = d.astimezone(IST)
        return d.strftime("%d %b") + ("" if d.year == t.year else f" {d.year}") + d.strftime(" %H:%M")

    def day_only(d: date | None) -> str:
        return (d.strftime("%d %b") + ("" if d.year == t.year else f" {d.year}")) if d else GREY.format("—")

    story += [NextPageTemplate("landscape"), PageBreak(),
              Paragraph(f"All tasks <font size='8.5' color='#6B7280'>({total}, newest first · times in IST · "
                        f"Late by = working hours past the due day, 11:00–20:30 Mon–Sat)</font>", s_h2)]
    heads = [("", s_head), ("Task", s_head), ("Assignee", s_head), ("Assigned", s_head_r), ("Due", s_head_r),
             ("Started", s_head_r), ("Ended", s_head_r), ("Completed", s_head_r), ("Time took", s_head_r),
             ("Late by", s_head_r)]
    data = [[Paragraph(h, st) for h, st in heads]]
    estimated = 0
    for i, x_ in enumerate(tasks, 1):
        tl = task_timeline(x_, holidays, now)
        estimated += tl["completed_estimated"]
        status = _STATUS_LABEL.get(x_.get("status"), x_.get("status") or "")
        if tl["late"] is not None:
            late = (f"<font color='#DC2626'><b>{fmt_duration(tl['late'])}</b></font>"
                    + ("<br/><font size='6.5' color='#9CA3AF'>so far</font>" if tl["late_open"] else ""))
        elif tl["completed"] and tl["due"]:
            late = "<font color='#16A34A'>On time</font>"
        else:
            late = GREY.format("—")
        assigned = tl["assigned"].astimezone(IST).date() if tl["assigned"] else None
        ended = stamp(tl["ended"]) or ("<font color='#2563EB'>Running</font>" if tl["running"] else GREY.format("—"))
        data.append([
            Paragraph(str(i), s_cell_m),
            Paragraph(pdf_text(x_.get("title"), TITLE_MAX), s_cell),
            Paragraph(pdf_text(who_is(x_), 60) or GREY.format("—"), s_cell_m),
            Paragraph(day_only(assigned), s_num),
            Paragraph(day_only(tl["due"]), s_num),
            Paragraph(stamp(tl["started"]) or GREY.format("—"), s_num),
            Paragraph(ended, s_num),
            Paragraph((stamp(tl["completed"]) + ("<font color='#9CA3AF'>*</font>" if tl["completed_estimated"] else ""))
                      or GREY.format(pdf_text(status)), s_num),
            Paragraph(fmt_duration(tl["took"]) if tl["took"] is not None else GREY.format("—"), s_num),
            Paragraph(late, s_num),
        ])
    # points; the task title takes the rest. Date columns fit "08 Mar 2027 19:34" on one line.
    fixed = [22, 90, 58, 58, 80, 80, 80, 50, 56]
    widths = [fixed[0], WL - sum(fixed)] + fixed[1:]
    story.append(grid(data, widths, pad=4))
    if estimated:
        story += [Spacer(1, 4), Paragraph(
            f"* {estimated} older task{'s were' if estimated > 1 else ' was'} approved before approval times were "
            "recorded — the task's last update is shown as Completed (and used for Late by).", s_cell_m)]

    doc.build(story, canvasmaker=NumberedCanvas)
    return buf.getvalue()
