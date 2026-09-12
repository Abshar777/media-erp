"""
Re-apply the canonical permission matrix to the built-in system roles.

migrate_roles.py only ever *creates* missing roles — it prints "[SKIP]" for any
that already exist and never touches their permissions. So every module added
since a role was first created is missing from that role's stored matrix, and
the Roles screen shows a set that no longer matches the code.

This re-applies app/models/role.py as the source of truth for:

    Admin · Coordinator · Team Leader · Employee · Super Admin

Custom roles you created yourself are never touched.

Usage (from the backend/ directory):
    python -m scripts.refresh_role_permissions             # show drift, change nothing
    python -m scripts.refresh_role_permissions --apply     # write the fixes
    python -m scripts.refresh_role_permissions --apply --role Employee
"""
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from datetime import datetime, timezone

from motor.motor_asyncio import AsyncIOMotorClient

from app.config import settings
from app.models.role import (
    admin_permissions,
    coordinator_permissions,
    team_leader_permissions,
    employee_permissions,
    all_permissions,
)

CANONICAL = {
    "Super Admin":  all_permissions,        # stays fully open by definition
    "Admin":        admin_permissions,
    "Coordinator":  coordinator_permissions,
    "Team Leader":  team_leader_permissions,
    "Employee":     employee_permissions,
}

ACTIONS = ("view", "create", "edit", "delete", "export")


def diff(stored: dict, want: dict) -> list[tuple[str, str, bool, bool]]:
    """Every (module, action) whose stored value disagrees with the code."""
    out = []
    for module in sorted(want):
        for action in ACTIONS:
            w = bool(want.get(module, {}).get(action, False))
            s = bool((stored or {}).get(module, {}).get(action, False))
            if w != s:
                out.append((module, action, s, w))
    return out


async def main(apply: bool, only: str | None) -> int:
    print("=== mediaERP — role permission refresh ===\n")
    print(f"Database: {settings.mongodb_db_name}")
    print(f"Mode:     {'APPLY (writing changes)' if apply else 'DRY RUN (read-only)'}\n")

    client = AsyncIOMotorClient(settings.mongodb_url)
    db = client[settings.mongodb_db_name]
    try:
        await db.command("ping")
    except Exception as exc:
        print(f"[FAIL] Cannot reach MongoDB at {settings.mongodb_url}\n       {exc}")
        client.close()
        return 1

    total_drift = 0
    touched = 0

    for role_name, builder in CANONICAL.items():
        if only and role_name.lower() != only.lower():
            continue
        role = await db["roles"].find_one({"role_name": role_name})
        if not role:
            print(f"[MISS] '{role_name}' does not exist — run scripts.migrate_roles first.")
            continue

        want = builder()
        changes = diff(role.get("permissions", {}), want)
        if not changes:
            print(f"[OK]   {role_name}: already correct")
            continue

        total_drift += len(changes)
        print(f"[DRIFT] {role_name}: {len(changes)} permission(s) differ")
        for module, action, was, now in changes:
            arrow = "grant" if now else "revoke"
            print(f"          {module:14} {action:7} {str(was):>5} -> {str(now):<5}  ({arrow})")

        if apply:
            await db["roles"].update_one(
                {"_id": role["_id"]},
                {"$set": {"permissions": want, "updated_at": datetime.now(timezone.utc)}},
            )
            touched += 1
            print(f"          → updated")
        print()

    print("=== Summary ===")
    if total_drift == 0:
        print("Every system role already matches the code. Nothing to do.")
    elif apply:
        print(f"Updated {touched} role(s), {total_drift} permission(s) corrected.")
        print("Anyone signed in picks this up on their next request — the role is")
        print("re-read per request, so there is no need to force a re-login.")
    else:
        print(f"{total_drift} permission(s) would change across the roles above.")
        print("Re-run with --apply to write them.")

    client.close()
    return 0


if __name__ == "__main__":
    args = sys.argv[1:]
    role = None
    if "--role" in args:
        i = args.index("--role")
        role = args[i + 1] if i + 1 < len(args) else None
    sys.exit(asyncio.run(main("--apply" in args, role)))
