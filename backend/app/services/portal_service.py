"""
Answering the Root portal's questions about this server's people.

The portal decides who may open what across the estate. It could already sign
somebody in here, and that was all: the role it recorded against a person was
whatever an administrator had typed into a box, nothing checked it against
this server, and the two could drift apart indefinitely with the portal still
reporting the one it remembered.

One organization per deployment here, unlike HRMS and the LMS, so nothing is
scoped by tenant and no organization id is asked for.
"""

import secrets

from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.models.role import ACTIONS, MODULES
from app.models.user import user_doc_to_dict
from app.services.auth_service import hash_password


class PortalError(Exception):
    """A refusal with a status the router can pass straight through."""

    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def _flatten(permissions: dict | None) -> list[str]:
    """
    Permissions as a flat list the portal can show.

    They are stored as a map of module to five booleans, which is right here
    and meaningless to another application. "reports:export" reads the same
    anywhere, and the portal shows it beside the role so that choosing one is
    a decision about what somebody will be able to do rather than a guess
    from its name.
    """
    out: list[str] = []
    for module in MODULES:
        actions = (permissions or {}).get(module) or {}
        for action in ACTIONS:
            if actions.get(action):
                out.append(f"{module}:{action}")
    return out


def _role_key(doc: dict) -> str:
    """
    The role's name, however the document spells it.

    `role_name` is what this application writes, but a document missing it is
    not worth a 500 — and the serialiser elsewhere does exactly that. Falling
    back keeps a half-formed role visible rather than breaking the whole list
    that happens to contain it.
    """
    return str(doc.get("role_name") or doc.get("name") or "")


async def list_roles_for_portal(db: AsyncIOMotorDatabase) -> dict:
    """The roles this server has, with what each one permits."""
    docs = await db["roles"].find({}).sort("role_name", 1).to_list(length=500)
    return {
        "organization": "Media ERP",
        "roles": [
            {
                # This server identifies a role by its name and has no
                # separate stable key; inventing one here would be an
                # identifier nothing else knows.
                "key": _role_key(d),
                "name": _role_key(d),
                "description": d.get("description", "") or "",
                "permissions": _flatten(d.get("permissions")),
                "isSystem": bool(d.get("is_system_role", False)),
            }
            for d in docs
            if _role_key(d)
        ],
    }


async def describe_user_for_portal(db: AsyncIOMotorDatabase, email: str) -> dict:
    """
    What an account actually holds here, right now.

    "Does not exist" is an answer rather than an error: the portal asks this
    about everybody it knows, and most will have no account here. A 404 would
    make the ordinary case look like a fault and bury the real ones.
    """
    wanted = (email or "").strip().lower()
    if not wanted:
        raise PortalError("email is required", 400)

    blank = {
        "exists": False, "inOrganization": False, "name": "", "email": wanted,
        "status": "", "membershipStatus": None, "roleKey": None, "roleName": None,
        "permissions": [], "lastLoginAt": None,
    }

    user = await db["users"].find_one({"email": wanted})
    if not user:
        return blank

    role = None
    if user.get("role_id"):
        try:
            role = await db["roles"].find_one({"_id": ObjectId(user["role_id"])})
        except Exception:
            role = None

    status = "active" if user.get("is_active", True) else "inactive"
    return {
        "exists": True,
        # One organization per deployment, so being here is being a member.
        "inOrganization": True,
        "name": user.get("name", "") or "",
        "email": user["email"],
        "status": status,
        "membershipStatus": status,
        "roleKey": _role_key(role) if role else None,
        "roleName": _role_key(role) if role else None,
        "permissions": _flatten(role.get("permissions")) if role else [],
        "lastLoginAt": None,
    }


async def _find_role(db: AsyncIOMotorDatabase, name: str) -> dict:
    """The role, matched the way a person would write it."""
    wanted = (name or "").strip()
    if not wanted:
        raise PortalError("A role is required", 400)

    for doc in await db["roles"].find({}).to_list(length=500):
        if _role_key(doc).strip().lower() == wanted.lower():
            return doc

    available = ", ".join(
        sorted(k for k in (_role_key(d) for d in await db["roles"].find({}).to_list(length=500)) if k)
    )
    raise PortalError(f'No role "{wanted}" here. Available: {available}.', 400)


async def set_user_role_from_portal(
    db: AsyncIOMotorDatabase, email: str, role: str | None = None, status: str | None = None
) -> dict:
    """
    Change what somebody is here, because the portal said so.

    Creates nothing. Provisioning is its own call, and an edit that created
    accounts as a side effect would turn a typo in an email address into a
    second person.
    """
    wanted = (email or "").strip().lower()
    if not wanted:
        raise PortalError("email is required", 400)
    if not role and not status:
        raise PortalError("Nothing to change: give a role, a status, or both", 400)

    user = await db["users"].find_one({"email": wanted})
    if not user:
        raise PortalError(f"{wanted} has no account on this server — create one first", 404)

    updates: dict = {}
    changes: list[str] = []

    if role:
        found = await _find_role(db, role)
        if str(user.get("role_id", "")) != str(found["_id"]):
            updates["role_id"] = str(found["_id"])
            changes.append(f"role to {_role_key(found)}")

    if status:
        wanted_status = status.strip().lower()
        if wanted_status not in ("active", "inactive"):
            raise PortalError(f'"{status}" is not a status here', 400)
        if user.get("status") != wanted_status:
            # Both fields, because both are read: `status` by the screens and
            # `is_active` by the sign-in. Writing one and not the other leaves
            # somebody switched off in one place and on in the other.
            updates["status"] = wanted_status
            updates["is_active"] = wanted_status == "active"
            changes.append(f"status to {wanted_status}")

    if updates:
        await db["users"].update_one({"_id": user["_id"]}, {"$set": updates})

    fresh = await db["users"].find_one({"_id": user["_id"]})
    final_role = None
    if fresh and fresh.get("role_id"):
        try:
            final_role = await db["roles"].find_one({"_id": ObjectId(fresh["role_id"])})
        except Exception:
            final_role = None

    return {
        "detail": f"Changed {wanted}'s {' and '.join(changes)}" if changes else f"{wanted} already held that",
        "roleKey": _role_key(final_role) if final_role else "",
        "membershipStatus": (fresh or {}).get("status", "active"),
    }


async def provision_from_portal(
    db: AsyncIOMotorDatabase, email: str, name: str, role: str
) -> dict:
    """
    Create an account here, because a root admin asked.

    Signing in from the portal deliberately refuses an unknown person — this
    server believes what the portal vouches for, so an account appearing
    because a token arrived would turn a spoofed portal into an instant
    account with whatever address it named. That refusal stands; this is the
    other half, decided on purpose, one person at a time.

    The password is random and nobody is told it, including whoever asked for
    the account: they arrive through the portal and never type one here.
    """
    wanted = (email or "").strip().lower()
    if not wanted:
        raise PortalError("email is required", 400)

    found = await _find_role(db, role)

    existing = await db["users"].find_one({"email": wanted})
    if existing:
        # Idempotent: the portal retries, and an administrator clicking twice
        # should not be an error they have to interpret.
        return {
            "created": False,
            "userId": str(existing["_id"]),
            "detail": f"{wanted} already has an account on this server",
        }

    doc = user_doc_to_dict(
        email=wanted,
        hashed_password=hash_password(secrets.token_hex(24)),
        name=(name or "").strip() or wanted.split("@")[0],
        role_id=str(found["_id"]),
    )
    result = await db["users"].insert_one(doc)

    return {
        "created": True,
        "userId": str(result.inserted_id),
        "detail": f"Created {wanted} as {_role_key(found)}",
    }


# At most this many addresses in one question.
#
# The portal asks about a page of its user list, which is twenty-five. The cap
# is far above that so it never has to think about the limit, and low enough
# that this endpoint cannot be turned into a way to sweep everybody here one
# large request at a time.
MAX_EMAILS = 500


async def describe_many_for_portal(db: AsyncIOMotorDatabase, emails: object) -> dict:
    """
    The same question as describe_user_for_portal, asked about many at once.

    The portal shows a column saying which systems each person actually has an
    account on, across a page of its user list. Asked one at a time that is
    twenty-five requests to each system for a single screen, so it is asked
    once instead.

    Two queries, not two per person: the accounts, then the roles they hold,
    each fetched in one go. Looking a role up per account would put back the
    per-person cost this endpoint exists to remove.

    Permissions are deliberately left out. They are the heaviest part of the
    answer and a column showing which systems somebody is on does not use
    them; whoever wants them opens that one person, where /user still gives
    the full picture.

    Every address asked about comes back, including the ones with no account
    here. The portal has to tell "asked, and there is nobody" apart from
    "never answered" — those mean opposite things on its screen, and a
    response that simply omitted the misses would make them indistinguishable.
    """
    if not isinstance(emails, list):
        raise PortalError("emails must be a list of addresses", 400)

    # Normalised and de-duplicated the same way a single lookup is, so that
    # asking about "A@x.com" and "a@x.com " is one question, answered once.
    wanted: list[str] = []
    seen: set[str] = set()
    for raw in emails:
        if not isinstance(raw, str):
            continue
        email = raw.strip().lower()
        if not email or email in seen:
            continue
        seen.add(email)
        wanted.append(email)

    if not wanted:
        return {"accounts": []}
    if len(wanted) > MAX_EMAILS:
        raise PortalError(
            f"At most {MAX_EMAILS} addresses at a time, and {len(wanted)} were asked for",
            400,
        )

    users = await db["users"].find({"email": {"$in": wanted}}).to_list(length=MAX_EMAILS)
    by_email = {str(u.get("email", "")).lower(): u for u in users}

    role_ids = []
    for user in users:
        raw_id = user.get("role_id")
        if not raw_id:
            continue
        try:
            role_ids.append(ObjectId(raw_id))
        except Exception:
            # A malformed id is the same as no role here, as it is singly.
            continue

    roles_by_id: dict[str, dict] = {}
    if role_ids:
        found = await db["roles"].find({"_id": {"$in": role_ids}}).to_list(length=len(role_ids))
        roles_by_id = {str(role["_id"]): role for role in found}

    accounts = []
    for email in wanted:
        user = by_email.get(email)
        if not user:
            accounts.append({
                "email": email, "exists": False, "inOrganization": False,
                "name": "", "status": "", "roleKey": None, "roleName": None,
            })
            continue

        role = roles_by_id.get(str(user.get("role_id"))) if user.get("role_id") else None
        status = "active" if user.get("is_active", True) else "inactive"
        accounts.append({
            "email": email,
            "exists": True,
            # One organization per deployment, so being here is being a member.
            "inOrganization": True,
            "name": user.get("name", "") or "",
            "status": status,
            "roleKey": _role_key(role) if role else None,
            "roleName": _role_key(role) if role else None,
        })

    return {"accounts": accounts}
