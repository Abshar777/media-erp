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


# ── Tasks, driven from the Root portal ───────────────────────────────────────
#
# This application already has a task system worth more than anything the
# portal could grow: teams, assignment, a leader's review desk, a verification
# gate before approval, push notifications and WhatsApp. None of that is
# reimplemented here.
#
# What follows resolves *who is acting* and then calls the same handlers the
# web app calls, with that person as the current user. Writing a parallel
# create-or-approve path would have meant two sets of rules, and the one that
# drifts is always the one with fewer eyes on it.



def _unwrap(result):
    """
    What a handler actually said.

    These return this application's own JSONResponse, so a refusal — a missing
    due date, a team somebody may not assign into — comes back as a perfectly
    ordinary object with success:false inside it. Passing that straight through
    told the portal a task had been created when nothing had, which is the one
    answer a create endpoint must never give.
    """
    import json as _json

    if isinstance(result, dict):
        body = result
    else:
        raw = getattr(result, "body", None)
        if raw is None:
            return {"success": True, "data": None}
        try:
            body = _json.loads(raw.decode() if isinstance(raw, (bytes, bytearray)) else raw)
        except Exception:
            return {"success": True, "data": None}

    if body.get("success") is False:
        status = getattr(result, "status_code", 400) or 400
        raise PortalError(body.get("message") or "That was refused", status)
    return body


async def _role_of(db: AsyncIOMotorDatabase, user: dict) -> dict:
    """The role document the handlers expect hung off the user as `_role`."""
    rid = user.get("role_id")
    if not rid:
        return {}
    try:
        return await db["roles"].find_one({"_id": ObjectId(rid)}) or {}
    except Exception:
        return {}


async def _ensure_account(
    db: AsyncIOMotorDatabase, email: str, name: str, role: str, outside_team: str,
) -> dict:
    """
    The person raising work, given an account here if they had none.

    The portal is where this group signs people in, and most of the people using
    it have never needed anything on this server. Standing them all behind one
    shared service account worked until work had to come back to whoever raised
    it: an approver nobody can act as is work that sits in the queue forever.

    So the account is made the first time somebody raises something, and they
    are put on an outside team — a home board for people who work with this
    department without belonging to it. Idempotent, because the second task
    should not be a second account.

    The password is random and nobody is told it. They arrive through the portal
    and never type one here, which is the same arrangement provisioning has
    always used.
    """
    wanted = (email or "").strip().lower()
    if not wanted:
        raise PortalError("Nobody to act as — the portal sent no address.", 400)

    user = await db["users"].find_one({"email": wanted})
    if not user:
        await provision_from_portal(db, wanted, name or wanted.split("@")[0], role)
        user = await db["users"].find_one({"email": wanted})
        if not user:
            raise PortalError(f"Could not create an account here for {wanted}.", 500)

    uid = str(user["_id"])

    team_name = (outside_team or "Outside").strip() or "Outside"
    team = await db["teams"].find_one({"name": team_name})
    if not team:
        res = await db["teams"].insert_one(
            {"name": team_name, "color": "#64748b", "members": [{"user_id": uid, "role": "member"}]}
        )
        team = await db["teams"].find_one({"_id": res.inserted_id})
    elif not any(m.get("user_id") == uid for m in (team.get("members") or [])):
        await db["teams"].update_one(
            {"_id": team["_id"]}, {"$push": {"members": {"user_id": uid, "role": "member"}}}
        )

    user["_role"] = await _role_of(db, user)
    return user


async def list_task_teams_for_portal(db: AsyncIOMotorDatabase) -> dict:
    """The teams work can be put on, and who is in them."""
    teams = await db["teams"].find({}).to_list(500)

    member_ids = {m.get("user_id") for t in teams for m in (t.get("members") or []) if m.get("user_id")}
    valid = [ObjectId(i) for i in member_ids if ObjectId.is_valid(i)]
    users = await db["users"].find({"_id": {"$in": valid}}, {"name": 1, "email": 1}).to_list(1000)
    by_id = {str(u["_id"]): u for u in users}

    return {
        "teams": [
            {
                "id": str(t["_id"]),
                "name": t.get("name", ""),
                "color": t.get("color", "#6366f1"),
                "members": [
                    {
                        "id": m.get("user_id", ""),
                        "name": (by_id.get(m.get("user_id"), {}) or {}).get("name", ""),
                        "email": (by_id.get(m.get("user_id"), {}) or {}).get("email", ""),
                        "role": m.get("role", "member"),
                    }
                    for m in (t.get("members") or [])
                    if by_id.get(m.get("user_id"))
                ],
            }
            for t in teams
        ]
    }


async def create_task_for_portal(db: AsyncIOMotorDatabase, body: dict) -> dict:
    """
    Raise work on somebody's plate, through this application's own front door.

    Every rule the web app applies still applies — a title, a team, a due date,
    who may assign to whom — because this hands the same request to the same
    handler rather than repeating any of it.

    Two things follow the create.

    The person raising it gets an account here if they had none, on an outside
    team. Work has to come back to whoever asked for it, and somebody who does
    not exist on this server cannot be asked anything.

    And they are named a verifier, so nothing they raised reaches approved
    until they have looked at what came back. That is set through the ordinary
    update, which lets any role name verifiers — unlike naming an *approver*,
    which this application reserves for leaders and which the portal has no
    business working around.

    Raising work for yourself is the exception, and not one handled here:
    resolve_verifiers drops the assignee on purpose, because signing off your
    own work is the thing verification exists to prevent.
    """
    from app.routers.projects import add_task, edit_task
    from app.schemas.project import CreateTaskRequest, UpdateTaskRequest

    actor = await _ensure_account(
        db,
        str(body.get("actorEmail") or ""),
        str(body.get("actorName") or ""),
        str(body.get("outsideRole") or "Employee"),
        str(body.get("outsideTeam") or "Outside"),
    )
    uid = str(actor["_id"])

    try:
        payload = CreateTaskRequest(**{
            "title": str(body.get("title") or ""),
            "description": str(body.get("description") or ""),
            "priority": str(body.get("priority") or "medium"),
            "assigned_to": str(body.get("assignedTo") or ""),
            "due_date": str(body.get("dueDate") or ""),
            "team_id": str(body.get("teamId") or ""),
        })
    except Exception as exc:
        raise PortalError(f"That task is not valid: {exc}", 400)

    created = (_unwrap(await add_task(payload, actor, db)).get("data") or {})
    task_id = created.get("id") or created.get("_id")

    # Said out loud rather than swallowed. The task exists either way, and
    # somebody who asked to be kept in the loop should be told when they are
    # not, instead of discovering it when work is approved without them.
    verifier_note = ""
    if task_id:
        try:
            _unwrap(await edit_task(str(task_id), UpdateTaskRequest(verify_users=[uid]), actor, db))
        except PortalError as exc:
            verifier_note = f"Raised, but you were not added as a verifier: {exc}"
    else:
        verifier_note = "Raised, but you were not added as a verifier."

    return {
        "createdAs": actor.get("email", ""),
        "verifierNote": verifier_note,
        "task": created,
    }


async def get_task_for_portal(db: AsyncIOMotorDatabase, task_id: str, actor_email: str) -> dict:
    """
    One task in full: where it is, how it got there, and what is attached.

    Handed to the same reader the web app uses, so the history merged across
    every team the task passed through, the team flow and this application's own
    access rule all come along. Somebody with no business seeing it is refused
    by that rule rather than by a second one invented here.
    """
    from app.routers.projects import get_task_detail

    user = await db["users"].find_one({"email": (actor_email or "").strip().lower()})
    if not user:
        raise PortalError("No account here for that address.", 403)
    user["_role"] = await _role_of(db, user)

    return _unwrap(await get_task_detail(task_id, user, db)).get("data") or {}


async def list_raised_for_portal(db: AsyncIOMotorDatabase, actor_email: str) -> dict:
    """
    What this person has asked for, whatever became of it.

    Their own work, so no team gate: you may always see what you raised. Sorted
    newest first, because the question after raising something is almost always
    about the thing you raised last.
    """
    from app.services.project_service import _serialize

    user = await db["users"].find_one({"email": (actor_email or "").strip().lower()})
    if not user:
        # Nobody has raised anything yet under an address with no account.
        return {"tasks": []}

    uid = str(user["_id"])
    rows = await db["project_tasks"].find({"created_by": uid}).sort("_id", -1).to_list(200)

    teams = {}
    for t in rows:
        tid = str(t.get("team_id") or "")
        if tid and tid not in teams:
            try:
                doc = await db["teams"].find_one({"_id": ObjectId(tid)}, {"name": 1})
                teams[tid] = (doc or {}).get("name", "")
            except Exception:
                teams[tid] = ""

    out = []
    for t in rows:
        row = _serialize(t)
        row["teamName"] = teams.get(str(t.get("team_id") or ""), "")
        out.append(row)
    return {"tasks": out}


async def list_verifications_for_portal(db: AsyncIOMotorDatabase, actor_email: str, scope: str = "pending") -> dict:
    """What is waiting on this person to verify, from this application's own feed."""
    from app.routers.verify import my_verifications

    user = await db["users"].find_one({"email": (actor_email or "").strip().lower()})
    if not user:
        raise PortalError(
            f"{actor_email or 'That person'} has no account here, so nothing is waiting on them.",
            403,
        )
    user["_role"] = await _role_of(db, user)

    body = _unwrap(await my_verifications(scope, False, user, db))
    return body.get("data") or {}


async def submit_verification_for_portal(db: AsyncIOMotorDatabase, task_id: str, body: dict) -> dict:
    """Pass it, or say what is wrong with it."""
    from app.routers.verify import submit_verification, VerifyDecision

    email = str(body.get("actorEmail") or "").strip().lower()
    user = await db["users"].find_one({"email": email})
    if not user:
        raise PortalError(f"{email or 'That person'} has no account here.", 403)
    user["_role"] = await _role_of(db, user)

    decision = VerifyDecision(passed=bool(body.get("passed")), reason=str(body.get("reason") or ""))
    out = _unwrap(await submit_verification(task_id, decision, user, db))
    return {"verifiedAs": user.get("email", ""), "passed": decision.passed, "result": out.get("data")}


