"""
Role model constants and document helpers.
MongoDB collection: 'roles'
"""

MODULES = [
    "dashboard",
    "connectors",
    "reports",
    "campaigns",
    "projects",
    "teams",
    "ai",
    "users",
    "roles",
    "settings",
    # ── new modules ──────────────────
    "schedule",
    "rules",
    "email_reports",
    "social",
    "chat",
    "clients",
    "pipeline",
    "fund_requests",
]

ACTIONS = ["view", "create", "edit", "delete", "export"]


def default_permissions() -> dict:
    """All actions false for every module."""
    return {m: {a: False for a in ACTIONS} for m in MODULES}


def all_permissions() -> dict:
    """All actions true for every module (Super Admin)."""
    return {m: {a: True for a in ACTIONS} for m in MODULES}


def viewer_permissions() -> dict:
    """Only view=true for non-admin modules."""
    perms = default_permissions()
    for m in ["dashboard", "reports", "campaigns", "projects", "teams", "ai"]:
        perms[m]["view"] = True
    # fund requests — every role may ask finance for money
    for a in ["view", "create"]:
        perms["fund_requests"][a] = True
    return perms


def manager_permissions() -> dict:
    """Manager role permissions (legacy — kept for backward compatibility)."""
    perms = default_permissions()
    perms["dashboard"]["view"] = True
    perms["connectors"]["view"] = True
    perms["connectors"]["create"] = True
    perms["connectors"]["edit"] = True
    perms["reports"]["view"] = True
    perms["reports"]["export"] = True
    perms["campaigns"]["view"] = True
    perms["projects"]["view"] = True
    perms["projects"]["create"] = True
    perms["projects"]["edit"] = True
    perms["projects"]["delete"] = True
    perms["teams"]["view"] = True
    perms["teams"]["create"] = True
    perms["teams"]["edit"] = True
    perms["teams"]["delete"] = True
    perms["ai"]["view"] = True
    perms["ai"]["create"] = True
    perms["users"]["view"] = True
    perms["settings"]["view"] = True
    # fund requests — every role may ask finance for money
    for a in ["view", "create"]:
        perms["fund_requests"][a] = True
    return perms


def admin_permissions() -> dict:
    """Admin — full access except roles management (Super Admin only)."""
    perms = all_permissions()
    for a in ACTIONS:
        perms["roles"][a] = False
    return perms


def coordinator_permissions() -> dict:
    """Coordinator — manages campaigns, reports, projects; full team management."""
    perms = default_permissions()
    perms["dashboard"]["view"] = True
    for a in ["view", "create", "edit"]:
        perms["connectors"][a] = True
    for a in ["view", "create", "export"]:
        perms["reports"][a] = True
    for a in ["view", "create", "edit"]:
        perms["campaigns"][a] = True
    for a in ["view", "create", "edit"]:
        perms["projects"][a] = True
    for a in ["view", "create", "delete"]:
        perms["teams"][a] = True
    for a in ["view", "create"]:
        perms["ai"][a] = True
    perms["users"]["view"] = True
    # new modules
    for a in ["view", "create", "edit", "delete"]:
        perms["schedule"][a] = True
    for a in ["view", "create", "edit", "delete"]:
        perms["rules"][a] = True
    for a in ["view", "create", "edit", "export"]:
        perms["email_reports"][a] = True
    for a in ["view", "create", "edit", "delete"]:
        perms["social"][a] = True
    for a in ["view", "create", "edit"]:
        perms["chat"][a] = True
    for a in ["view", "create", "edit"]:
        perms["clients"][a] = True
    for a in ["view", "create", "edit", "delete"]:
        perms["pipeline"][a] = True
    # fund requests — every role may ask finance for money
    for a in ["view", "create"]:
        perms["fund_requests"][a] = True
    return perms


def team_leader_permissions() -> dict:
    """Team Leader — manages projects and tasks; read-only on campaigns/reports."""
    perms = default_permissions()
    perms["dashboard"]["view"] = True
    perms["reports"]["view"] = True
    perms["campaigns"]["view"] = True
    for a in ["view", "create", "edit", "delete"]:
        perms["projects"][a] = True
    for a in ["view", "edit"]:
        perms["teams"][a] = True
    for a in ["view", "create"]:
        perms["ai"][a] = True
    # new modules
    for a in ["view", "create"]:
        perms["schedule"][a] = True
    perms["rules"]["view"] = True
    perms["email_reports"]["view"] = True
    for a in ["view", "create"]:
        perms["social"][a] = True
    for a in ["view", "create"]:
        perms["chat"][a] = True
    perms["clients"]["view"] = True
    perms["pipeline"]["view"] = True
    # fund requests — every role may ask finance for money
    for a in ["view", "create"]:
        perms["fund_requests"][a] = True
    return perms


def employee_permissions() -> dict:
    """Employee / Team Member — works on assigned tasks; view access to most modules."""
    perms = default_permissions()
    perms["dashboard"]["view"] = True
    perms["reports"]["view"] = True
    perms["campaigns"]["view"] = True
    for a in ["view", "create", "edit"]:
        perms["projects"][a] = True
    perms["teams"]["view"] = True
    perms["ai"]["view"] = True
    # new modules
    perms["schedule"]["view"] = True
    for a in ["view", "create"]:
        perms["social"][a] = True
    for a in ["view", "create"]:
        perms["chat"][a] = True
    # fund requests — every role may ask finance for money
    for a in ["view", "create"]:
        perms["fund_requests"][a] = True
    return perms
