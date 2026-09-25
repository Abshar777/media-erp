"""
Give every role the new Fund Requests permission.

Every role may ask finance for money: view (the page, your own requests) and
create (make one). Admin and Super Admin get the whole row, as their presets
in app/models/role.py do, so a later refresh_role_permissions run agrees with
what this wrote instead of undoing it.

Only ever grants. A role that already has the permission is left exactly as
it is — including one somebody has deliberately narrowed on the Roles screen
after this ran, which is why it grants view/create only where they are unset.

Usage (from the backend/ directory):
    python -m scripts.grant_fund_requests            # show what would change
    python -m scripts.grant_fund_requests --apply    # write it
"""
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from datetime import datetime, timezone

from motor.motor_asyncio import AsyncIOMotorClient

from app.config import settings

MODULE = "fund_requests"
ACTIONS = ("view", "create", "edit", "delete", "export")
FULL_ROW = {"Super Admin", "Admin"}


def wanted(role: dict) -> dict:
    stored = ((role.get("permissions") or {}).get(MODULE)) or {}
    if role.get("role_name") in FULL_ROW:
        return {a: True for a in ACTIONS}
    row = {a: bool(stored.get(a, False)) for a in ACTIONS}
    # Granted once; a role that has already been through here keeps whatever
    # was chosen for it since.
    if MODULE not in (role.get("permissions") or {}):
        row["view"] = True
        row["create"] = True
    return row


async def main(apply: bool) -> int:
    print("=== mediaERP — grant Fund Requests to every role ===\n")
    print(f"Database: {settings.mongodb_db_name}")
    print(f"Mode:     {'APPLY (writing changes)' if apply else 'DRY RUN (read-only)'}\n")

    client = AsyncIOMotorClient(settings.mongodb_url)
    db = client[settings.mongodb_db_name]
    try:
        await db.command("ping")
    except Exception as exc:
        print(f"[FAIL] Cannot reach MongoDB\n       {exc}")
        client.close()
        return 1

    changed = 0
    roles = await db["roles"].find({}).sort("role_name", 1).to_list(1000)
    for role in roles:
        name = role.get("role_name", "?")
        stored = (role.get("permissions") or {}).get(MODULE)
        want = wanted(role)
        if stored == want:
            print(f"[OK]    {name}: already has it")
            continue
        granted = [a for a in ACTIONS if want[a] and not (stored or {}).get(a)]
        print(f"[GRANT] {name}: {', '.join(granted) or 'fills in the row'}")
        if apply:
            await db["roles"].update_one(
                {"_id": role["_id"]},
                {"$set": {f"permissions.{MODULE}": want, "updated_at": datetime.now(timezone.utc)}},
            )
        changed += 1

    print("\n=== Summary ===")
    if not roles:
        print("No roles found — is this the right database?")
    elif changed == 0:
        print("Every role already has Fund Requests. Nothing to do.")
    elif apply:
        print(f"Updated {changed} role(s).")
        print("Signed-in users pick it up within 15 minutes (their next token")
        print("refresh), or straight away by signing out and in again. The server")
        print("checks the live role on every request, so the API allows it now.")
    else:
        print(f"{changed} role(s) would change. Re-run with --apply to write them.")

    client.close()
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main("--apply" in sys.argv[1:])))
