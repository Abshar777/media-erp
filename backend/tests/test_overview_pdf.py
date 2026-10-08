"""
Overview PDF: GET /api/v1/projects/overview/pdf

What must hold:
  • the PDF is built from EXACTLY the tasks GET /projects returns to the
    Overview for the same member + date filters (one shared query);
  • its numbers use the Overview's formulas (summarize);
  • a Team Leader can't export someone they don't lead — and the refused
    report doesn't even name them; an Employee's member_id is ignored;
  • the period line and file name describe the filter actually applied
    (an unparseable date is "All time", never a date over all-time numbers).

Integration test on a throwaway MongoDB database (created and dropped here).
Skips when Mongo is down.
"""
import base64
import re
import secrets
import zlib
from datetime import date, datetime, timedelta, timezone

import pytest
from bson import ObjectId
from httpx import ASGITransport, AsyncClient
from motor.motor_asyncio import AsyncIOMotorClient

from app.config import settings
from app.database import get_db
from app.main import app
from app.middleware.auth import get_current_user
from app.services import overview_report_service as svc
from app.utils.timezone import today_ist


async def _mongo_or_skip() -> AsyncIOMotorClient:
    client = AsyncIOMotorClient(settings.mongodb_url, serverSelectionTimeoutMS=3000)
    try:
        await client.admin.command("ping")
    except Exception:
        client.close()
        pytest.skip("MongoDB not reachable — integration test skipped")
    return client


def pdf_strings(pdf: bytes) -> str:
    """The text drawn in a reportlab PDF (standard fonts write literal strings)."""
    out = []
    for m in re.finditer(rb"stream\r?\n(.*?)endstream", pdf, re.S):
        raw = m.group(1).strip()
        if raw.endswith(b"~>"):                       # reportlab: ASCII85, then Flate
            try:
                raw = base64.a85decode(raw[:-2])
            except ValueError:
                continue
        try:
            raw = zlib.decompress(raw)
        except zlib.error:
            pass
        out += [s.decode("latin-1") for s in re.findall(rb"\(((?:[^()\\]|\\.)*)\)\s*Tj", raw)]
    return " ".join(out).replace(r"\(", "(").replace(r"\)", ")")


def test_summarize_matches_overview_formulas():
    t = date(2026, 10, 8)
    tasks = [
        {"id": "1", "status": "pending", "due_date": "2026-10-07"},                  # overdue
        {"id": "2", "status": "started", "due_date": "2026-10-08"},                  # due soon (today)
        {"id": "3", "status": "break", "due_date": "2026-10-15"},                    # due soon (+7, edge)
        {"id": "4", "status": "pending", "due_date": "2026-10-16"},                  # beyond +7
        {"id": "5", "status": "approved", "due_date": "2026-10-01",                  # approved: never overdue
         "timing": {"total_seconds": 601}},
        {"id": "6", "status": "approved", "timing": {"total_seconds": 600}},
        {"id": "7", "status": "approved", "timing": {"total_seconds": None}},       # no time: not averaged
        {"id": "8", "status": "pending_review"},
        {"id": "9", "status": "my_custom_col"},                                      # unknown column still counted
    ]
    s = svc.summarize(tasks, t)
    assert (s["total"], s["in_progress"], s["pending_review"], s["approved"], s["overdue"]) == (9, 2, 1, 3, 1)
    assert s["avg_seconds"] == 601   # (601+600)/2 = 600.5 → JS Math.round → 601 (Python round() gives 600)
    assert s["avg_label"] == "10m 1s" and s["avg_sub"] == "across 3 approved tasks"
    assert [x["id"] for x in s["due_soon"]] == ["2", "3"]
    assert sum(p["count"] for p in s["pipeline"]) == 9
    assert any(p["key"] == "my_custom_col" and p["count"] == 1 for p in s["pipeline"])
    assert svc.format_seconds(3725) == "1h 2m" and svc.format_seconds(59) == "59s"
    assert svc.summarize([], t)["avg_sub"] == "No completed tasks yet"


def test_task_table_matches_the_team_report():
    """
    The two rows below are copied from the team's own task report (the layout
    the PDF table follows); the PDF must produce the same numbers.
      Late by   = WORKING time (11:00–20:30 IST, Mon–Sat) from the end of the due day
      Time took = the timer's tracked time (raw, as on the Overview)
    """
    U = lambda *a: datetime(*a, tzinfo=timezone.utc).isoformat()
    # "Review all campaigns…": due 3 Oct, done 8 Oct 13:03 IST, 8s → Late by 30h 33m.
    r = svc.task_timeline({"status": "approved", "due_date": "2026-10-03",
                           "history": [{"action": "started", "timestamp": U(2026, 10, 7, 16, 23)},
                                       {"action": "approved", "timestamp": U(2026, 10, 8, 7, 33)}],
                           "timing": {"total_seconds": 8, "intervals": [
                               {"started_at": U(2026, 10, 7, 16, 23), "ended_at": U(2026, 10, 7, 16, 23, 8)}]}})
    assert (svc.fmt_duration(r["late"]), svc.fmt_duration(r["took"])) == ("30h 33m", "8s")
    assert r["started"].isoformat() == U(2026, 10, 7, 16, 23) and r["ended"].isoformat() == U(2026, 10, 7, 16, 23, 8)
    assert r["completed"].isoformat() == U(2026, 10, 8, 7, 33) and not r["late_open"]
    # "Boot Camp Payment Report": due 14 Sep, done 18 Sep 19:33 IST, 11h 18m → 37h 03m.
    r = svc.task_timeline({"status": "approved", "due_date": "2026-09-14",
                           "history": [{"action": "approved", "timestamp": U(2026, 9, 18, 14, 3)}],
                           "timing": {"total_seconds": 40680}})
    assert (svc.fmt_duration(r["late"]), svc.fmt_duration(r["took"])) == ("37h 03m", "11h 18m")
    # A holiday on 15 Sep takes its 9h 30m out of "Late by".
    r2 = svc.task_timeline({"status": "approved", "due_date": "2026-09-14",
                            "history": [{"action": "approved", "timestamp": U(2026, 9, 18, 14, 3)}]},
                           holidays=frozenset({date(2026, 9, 15)}))
    assert svc.fmt_duration(r2["late"]) == "27h 33m"
    # Done before the due day ends → not late; open and past due → late "so far".
    assert svc.task_timeline({"status": "approved", "due_date": "2026-10-08",
                              "history": [{"action": "approved", "timestamp": U(2026, 10, 8, 10, 0)}]})["late"] is None
    now = datetime(2026, 10, 9, 8, 30, tzinfo=timezone.utc)            # 9 Oct 14:00 IST
    r = svc.task_timeline({"status": "started", "due_date": "2026-10-08",
                           "timing": {"intervals": [{"started_at": U(2026, 10, 9, 6, 0), "ended_at": None}]}}, now=now)
    assert r["late_open"] and svc.fmt_duration(r["late"]) == "3h 00m" and r["running"] and r["ended"] is None
    assert svc.fmt_duration(r["took"]) == "2h 30m", "a running timer counts up to now"
    # Approved, sent back for a reedit, approved again: Completed is the LAST approval.
    r = svc.task_timeline({"status": "approved", "due_date": "2026-10-05",
                           "history": [{"action": "approved", "timestamp": U(2026, 10, 5, 6, 0)},
                                       {"action": "reedit", "timestamp": U(2026, 10, 6, 6, 0)},
                                       {"action": "approved", "timestamp": U(2026, 10, 7, 6, 30)}]})
    assert r["completed"].isoformat() == U(2026, 10, 7, 6, 30) and svc.fmt_duration(r["late"]) == "10h 30m"
    # Approved before history was kept: no "approved" entry → the last update, flagged.
    r = svc.task_timeline({"status": "approved", "due_date": "2026-07-13", "history": [],
                           "updated_at": U(2026, 7, 14, 12, 20)})
    assert r["completed"].isoformat() == U(2026, 7, 14, 12, 20) and r["completed_estimated"]
    assert svc.fmt_duration(r["late"]) == "6h 50m"          # 14 Jul 11:00 → 17:50 IST
    assert not svc.task_timeline({"status": "approved", "history": [{"action": "approved", "timestamp": U(2026, 7, 14, 6, 0)}],
                                  "updated_at": U(2026, 7, 20, 6, 0)})["completed_estimated"]
    assert svc.task_timeline({"status": "pending", "updated_at": U(2026, 7, 14, 6, 0)})["completed"] is None
    # Assigned = last assignment / transfer, else when the task was created.
    r = svc.task_timeline({"status": "pending", "created_at": U(2026, 10, 1, 5, 0),
                           "history": [{"action": "assigned", "timestamp": U(2026, 10, 2, 5, 0)},
                                       {"action": "transferred", "timestamp": U(2026, 10, 4, 5, 0)}]})
    assert r["assigned"].isoformat() == U(2026, 10, 4, 5, 0)
    assert svc.task_timeline({"created_at": U(2026, 10, 1, 5, 0)})["assigned"].isoformat() == U(2026, 10, 1, 5, 0)
    assert [svc.fmt_duration(x) for x in (None, 8, 240, 3000, 133380)] == ["—", "8s", "4m", "50m", "37h 03m"]


def test_task_table_is_on_landscape_pages():
    tasks = [{"id": "1", "title": "Reel", "status": "approved", "due_date": "2026-10-03",
              "assigned_to_name": "Sara", "created_at": "2026-10-01T05:00:00+00:00",
              "history": [{"action": "approved", "timestamp": "2026-10-08T07:33:00+00:00"}],
              "timing": {"total_seconds": 8}}]
    pdf = svc.build_pdf(tasks=tasks, heading="Sara's overview", scope_line="", period_label="All time",
                        generated_by="Lena", team_names={}, today=date(2026, 10, 9))
    sizes = re.findall(rb"/MediaBox \[ 0 0 ([\d.]+) ([\d.]+) \]", pdf)
    assert [tuple(round(float(v)) for v in sz) for sz in sizes] == [(595, 842), (842, 595)], "portrait, then landscape"
    text = pdf_strings(pdf)
    for needle in ("Sara", "03 Oct", "08 Oct 13:03", "8s", "30h 33m", "Late by"):
        assert needle in text, needle

    # No stored name: the person's current name — and never a raw id.
    ghost, known = "6ac60f98906a4b1cbc9111fb", "6ac60f98906a4b1cbc9111fc"
    more = [{**tasks[0], "id": "2", "title": "Named later", "assigned_to": known, "assigned_to_name": ""},
            {**tasks[0], "id": "3", "title": "Nobody", "assigned_to": ghost, "assigned_to_name": ""}]
    text = pdf_strings(svc.build_pdf(tasks=more, heading="x", scope_line="", period_label="All time",
                                     generated_by="Lena", team_names={}, people={known: "Omar Khan"}))
    assert "Omar Khan" in text and ghost not in text
    # The older-task note appears only when such a task is in the report.
    legacy = [{**tasks[0], "id": "4", "history": [], "updated_at": "2026-07-14T12:20:00+00:00"}]
    text = pdf_strings(svc.build_pdf(tasks=legacy, heading="x", scope_line="", period_label="All time",
                                     generated_by="Lena", team_names={}))
    assert "14 Jul 17:50" in text and "approved before approval times were recorded" in text
    assert "approved before approval times" not in pdf_strings(svc.build_pdf(
        tasks=tasks, heading="x", scope_line="", period_label="All time", generated_by="Lena", team_names={}))


def test_period_labels_describe_the_applied_filter():
    t = date(2026, 10, 8)   # a Thursday
    assert svc.describe_period("", "", "", today=t) == ("All time", "all-time")
    assert svc.describe_period("this_month", "", "", today=t) == ("This month · 1 Oct – 8 Oct 2026", "this-month")
    assert svc.describe_period("this_week", "", "", today=t)[0] == "This week · 5 Oct – 8 Oct 2026"
    assert svc.describe_period("custom", "2026-10-01", "2026-10-08", today=t) == (
        "1 Oct – 8 Oct 2026", "2026-10-01_to_2026-10-08")
    assert svc.describe_period("custom", "2026-09-01", "2026-09-30", "last_month", today=t)[0] == \
        "Last month · 1 Sep – 30 Sep 2026"
    assert svc.describe_period("custom", "2025-12-20", "2026-01-05", today=t)[0] == "20 Dec 2025 – 5 Jan 2026"
    assert svc.describe_period("custom", "2026-10-07", "2026-10-07", "yesterday", today=t) == (
        "Yesterday · 7 Oct 2026", "2026-10-07")
    # list_tasks applies no date filter for these, so neither may the label.
    assert svc.describe_period("custom", "2026-02-31", "2026-03-05", today=t)[0] == "All time"
    assert svc.describe_period("bogus", "", "", today=t)[0] == "All time"
    assert svc.pdf_text("QA ✨ <b>&") == "QA  &lt;b&gt;&amp;"


def test_huge_titles_and_long_reports_render():
    """A title longer than a page used to fail the whole export (LayoutError)."""
    tasks = [{"id": "x", "title": "QA ✨ <script>alert(1)</script> " + "x" * 5000, "status": "pending",
              "assigned_to_name": "Asha " + "y" * 300, "created_at": "2026-10-05T06:00:00+00:00",
              "due_date": "2026-10-09"}]
    tasks += [{"id": str(i), "title": f"Task {i} " + "word " * 60, "status": "approved",
               "timing": {"total_seconds": 60 * i}, "created_at": "2026-10-05T06:00:00+00:00"}
              for i in range(300)]
    pdf = svc.build_pdf(tasks=tasks, heading="Sara 🙂 " + "z" * 300, scope_line="Teams: " + ", ".join(["T"] * 500),
                        period_label="All time", generated_by="Lena", team_names={}, today=date(2026, 10, 8))
    text = pdf_strings(pdf)
    assert pdf.startswith(b"%PDF") and "TOTAL TASKS" in text and "&lt;script&gt;" not in text
    pages = int(re.search(r"Page 1 of (\d+)", text).group(1))
    assert pages > 3, pages
    assert "Task 299" in text and "301" in text      # every task present; total tile = 301


async def test_overview_pdf_endpoint(monkeypatch):
    client = await _mongo_or_skip()
    db_name = f"mediaerp_test_ovpdf_{secrets.token_hex(4)}"
    db = client[db_name]
    try:
        roles = {
            "TL": {"_id": ObjectId(), "role_name": "Team Leader"},
            "SA": {"_id": ObjectId(), "role_name": "Super Admin", "is_system_role": True},
            "EM": {"_id": ObjectId(), "role_name": "Employee"},
        }
        role_of = {"LEAD": "TL", "OTHERLEAD": "TL", "ADMIN": "SA", "SARA": "EM", "OMAR": "EM", "ZED": "EM"}
        names = {"LEAD": "Lena Lead", "OTHERLEAD": "Otto Lead", "ADMIN": "Ada Admin",
                 "SARA": "Sara Ali", "OMAR": "Omar Khan", "ZED": "Zed Stranger"}
        U = {k: ObjectId() for k in role_of}
        s = {k: str(v) for k, v in U.items()}
        await db["users"].insert_many([{"_id": U[k], "name": names[k], "email": f"{k.lower()}@t.io"} for k in U])
        design = {"_id": ObjectId(), "name": "Design", "members": [
            {"user_id": s["LEAD"], "role": "leader"}, {"user_id": s["SARA"], "role": "member"},
            {"user_id": s["OMAR"], "role": "member"}]}
        video = {"_id": ObjectId(), "name": "Video", "members": [
            {"user_id": s["OTHERLEAD"], "role": "leader"}, {"user_id": s["SARA"], "role": "member"},
            {"user_id": s["ZED"], "role": "member"}]}
        await db["teams"].insert_many([design, video])
        D, V = str(design["_id"]), str(video["_id"])

        today = today_ist()
        ist_noon = lambda d: datetime(d.year, d.month, d.day, 6, 30, tzinfo=timezone.utc)

        def task(title, who, team, created, status="pending", due=None, secs=None):
            return {"title": title, "assigned_to": s[who], "assigned_to_name": names[who], "status": status,
                    "priority": "high", "attachments": [], "created_by": s["LEAD"], "history": [],
                    "team_id": team, "due_date": due, "created_at": created, "updated_at": created,
                    **({"timing": {"intervals": [], "total_seconds": secs}} if secs is not None else {})}

        await db["project_tasks"].insert_many([
            task("Reel edit ✨", "SARA", D, ist_noon(date(2026, 10, 2)), "approved", "2026-10-03", 900),
            task("Poster", "SARA", D, ist_noon(date(2026, 10, 5)), "started", (today - timedelta(days=1)).isoformat()),
            task("Caption", "SARA", D, ist_noon(date(2026, 9, 20)), "pending_review"),
            task("Video cut", "SARA", V, ist_noon(date(2026, 10, 4)), "pending"),        # team LEAD doesn't lead
            task("Thumbnail", "OMAR", D, ist_noon(date(2026, 10, 6)), "break", (today + timedelta(days=2)).isoformat()),
            task("Zed's secret", "ZED", V, ist_noon(date(2026, 10, 6)), "pending"),
        ])

        def as_user(key):
            async def _user():
                return {"_id": U[key], "name": names[key], "email": f"{key.lower()}@t.io",
                        "role_id": str(roles[role_of[key]]["_id"]), "_role": roles[role_of[key]]}
            return _user

        captured: list[dict] = []
        real_build = svc.build_pdf

        def spy_build(**kw):
            captured.append(kw)
            return real_build(**kw)

        monkeypatch.setattr(svc, "build_pdf", spy_build)

        app.dependency_overrides[get_db] = lambda: db
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as ac:

            async def export(viewer, **params):
                app.dependency_overrides[get_current_user] = as_user(viewer)
                list_r = await ac.get("/api/v1/projects", params=params)
                pdf_r = await ac.get("/api/v1/projects/overview/pdf", params=params)
                assert pdf_r.status_code == 200, pdf_r.text
                assert pdf_r.headers["content-type"] == "application/pdf"
                assert pdf_r.content.startswith(b"%PDF")
                kw = captured[-1]
                # The headline guarantee: same tasks, same order, as the Overview's list.
                assert [t["id"] for t in kw["tasks"]] == [t["id"] for t in list_r.json()["data"]]
                fname = re.search(r'filename="([^"]+)"', pdf_r.headers["content-disposition"]).group(1)
                # Every download is stamped with when it was made (IST), then the stamp is
                # dropped so the assertions below read the meaningful part.
                assert re.search(r"_\d{4}-\d{2}-\d{2}_\d{4}\.pdf$", fname), fname
                fname = re.sub(r"_\d{4}-\d{2}-\d{2}_\d{4}\.pdf$", ".pdf", fname)
                return kw, fname, pdf_strings(pdf_r.content)

            oct1_8 = {"date_filter": "custom", "date_from": "2026-10-01", "date_to": "2026-10-08"}

            # Leader views Sara, 1–8 Oct: Design work only (not Video), not 20 Sep.
            kw, fname, text = await export("LEAD", member_id=s["SARA"], **oct1_8)
            assert sorted(t["title"] for t in kw["tasks"]) == ["Poster", "Reel edit ✨"]
            assert kw["heading"] == "Sara Ali's overview" and kw["scope_line"] == "Teams: Design"
            assert fname == "overview_sara-ali_2026-10-01_to_2026-10-08.pdf"
            st = svc.summarize(kw["tasks"])
            assert (st["total"], st["in_progress"], st["approved"], st["overdue"], st["avg_label"]) == (2, 1, 1, 1, "15m 0s")
            for needle in ("Sara Ali's overview", "1 Oct", "8 Oct 2026", "TOTAL TASKS", "Reel edit", "Poster",
                           "Design", "15m 0s", "Page 1 of 2", "Page 2 of 2", "Lena Lead",
                           "Assigned", "Started", "Ended", "Completed", "Time took", "Late by"):
                assert needle in text, needle
            assert "Video cut" not in text and "Caption" not in text and "✨" not in text

            # Leader's own overview, preset: their teams only.
            kw, fname, text = await export("LEAD", date_filter="this_year")
            assert sorted(t["title"] for t in kw["tasks"]) == ["Caption", "Poster", "Reel edit ✨", "Thumbnail"]
            assert kw["heading"] == "Lena Lead's overview" and kw["scope_line"] == "Teams you lead: Design"
            assert fname == "overview_mine_this-year.pdf"
            assert "Zed" not in text

            # A person the leader doesn't lead: empty AND nameless.
            kw, fname, text = await export("LEAD", member_id=s["ZED"])
            assert kw["tasks"] == [] and kw["heading"] == "Member overview" and fname == "overview_member_all-time.pdf"
            assert "Zed" not in text and "No tasks were created in this period." in text

            # Admin views Sara: every team.
            kw, fname, _ = await export("ADMIN", member_id=s["SARA"], **oct1_8)
            assert sorted(t["title"] for t in kw["tasks"]) == ["Poster", "Reel edit ✨", "Video cut"]
            assert kw["scope_line"] == "Teams: Design, Video"

            # Employee: member_id ignored, own work only.
            kw, fname, _ = await export("OMAR", member_id=s["SARA"])
            assert [t["title"] for t in kw["tasks"]] == ["Thumbnail"]
            assert kw["heading"] == "Omar Khan's overview" and fname == "overview_mine_all-time.pdf"

            # Friendly preset name only labels; an unparseable date is "All time".
            kw, _, _ = await export("LEAD", member_id=s["SARA"], range_name="last7", **oct1_8)
            assert kw["period_label"] == "Last 7 days · 1 Oct – 8 Oct 2026"
            kw, fname, _ = await export("LEAD", date_filter="custom", date_from="2026-02-31", date_to="2026-03-05")
            assert kw["period_label"] == "All time" and fname.endswith("_all-time.pdf")
    finally:
        app.dependency_overrides.clear()
        await client.drop_database(db_name)
        client.close()
