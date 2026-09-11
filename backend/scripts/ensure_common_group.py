"""
Create (or re-sync) the company-wide "Everyone" chat group.

The app already provisions this lazily — ensure_common_group runs whenever
anyone lists their chat groups — so this script is for the cases where you
don't want to wait for that:

  - right after deploying, so the group exists before the first person opens
    chat
  - after a bulk user import, to pull the new people in immediately
  - to confirm what the roster actually looks like on a given environment

Safe to run as often as you like. It upserts a single group identified by
`is_common` (not by name, so renaming it can't create a second one) and
replaces its member list with every active user.

Usage (from the backend/ directory):
    python -m scripts.ensure_common_group           # create / sync
    python -m scripts.ensure_common_group --dry-run # report only, change nothing
"""
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from motor.motor_asyncio import AsyncIOMotorClient

from app.config import settings
from app.services.group_chat_service import ensure_common_group, COMMON_GROUP_NAME

# Matches the query in ensure_common_group: legacy users predate both fields,
# so a missing is_active / status counts as active rather than excluded.
ACTIVE_QUERY = {
    "$and": [
        {"$or": [{"is_active": True}, {"is_active": {"$exists": False}}]},
        {"$or": [{"status": {"$ne": "inactive"}}, {"status": {"$exists": False}}]},
    ]
}


async def main(dry_run: bool = False) -> int:
    print("=== mediaERP — company-wide chat group ===\n")
    print(f"Database: {settings.mongodb_db_name}")

    client = AsyncIOMotorClient(settings.mongodb_url)
    db = client[settings.mongodb_db_name]

    try:
        await db.command("ping")
    except Exception as exc:
        print(f"\n[FAIL] Cannot reach MongoDB at {settings.mongodb_url}\n       {exc}")
        client.close()
        return 1

    active = await db["users"].count_documents(ACTIVE_QUERY)
    inactive = await db["users"].count_documents({}) - active
    existing = await db["chat_groups"].find_one({"is_common": True})

    print(f"Active users: {active}   (skipping {inactive} inactive)")
    print(f"Existing group: {'yes — ' + existing.get('name', '') if existing else 'no'}")

    if dry_run:
        have = len(existing.get("members", [])) if existing else 0
        print(f"\n[DRY RUN] Would {'sync' if existing else 'create'} the group "
              f"with {active} member(s) (currently {have}).")
        print("          Nothing was written.")
        client.close()
        return 0

    if active == 0:
        # An empty roster would leave a group nobody can open — almost certainly
        # a wrong database rather than a real state worth writing.
        print("\n[FAIL] No active users found. Refusing to create an empty group —\n"
              "       check MONGODB_DB_NAME points at the right database.")
        client.close()
        return 1

    before = len(existing.get("members", [])) if existing else 0
    group = await ensure_common_group(db)
    after = len(group.get("members", []))

    action = "Synced" if existing else "Created"
    print(f"\n[OK]   {action} group '{group.get('name', COMMON_GROUP_NAME)}'  (id={group['_id']})")
    print(f"       Members: {before} → {after}")
    if existing and after == before:
        print("       Roster was already up to date.")

    dupes = await db["chat_groups"].count_documents({"is_common": True})
    if dupes != 1:
        # Would mean someone inserted one by hand; the upsert only ever
        # touches the first match, so the rest would silently go stale.
        print(f"\n[WARN] Found {dupes} groups flagged is_common — there should be exactly 1.")

    print("\n=== Done ===")
    print("It appears for everyone under Chat → Groups. Anyone may post.")
    client.close()
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main("--dry-run" in sys.argv)))
