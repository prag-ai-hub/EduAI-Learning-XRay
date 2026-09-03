"""The four-tier role hierarchy.

These strings are the values the database constraint accepts. They must stay
identical in all three places the enum is defined:

  * ../../supabase/migrations/20260903000000_roles_and_school_status.sql
    (`users_role_check`) - the authority
  * ../../frontend/lib/roles.ts (`AppRole`)
  * here

They are PascalCase, not snake_case. Changing one means changing all three.
"""

from __future__ import annotations

SUPER_ADMIN = "SuperAdmin"
SCHOOL_ADMIN = "SchoolAdmin"
TEACHER = "Teacher"
PARENT = "Parent"

ALL_ROLES = (SUPER_ADMIN, SCHOOL_ADMIN, TEACHER, PARENT)

CHOICES = tuple((role, role) for role in ALL_ROLES)

# Pre-M7 value. `toAppRole` in the frontend coerces it the same way, and M7
# rewrote every stored row - but a stale JWT can still carry it.
LEGACY_ADMIN = "Admin"

# Roles that are scoped to exactly one school. The database enforces the same
# rule as a constraint:
#   (role in ('SchoolAdmin','Teacher')) = (school_id is not null)
# so a SuperAdmin and a Parent both have school_id NULL. A Parent reaches
# their children through parent_student_links, never through a school_id.
SCHOOL_SCOPED_ROLES = frozenset({SCHOOL_ADMIN, TEACHER})

# There is deliberately NO rank ordering here. Authority in this product does
# not flow downward - a SchoolAdmin outranks a Teacher administratively yet
# cannot grade - so ranking roles would invite exactly the wrong check. Ask
# apps/accounts/capabilities.py what a role may do instead.


def normalize(value: object) -> str | None:
    """Coerce a stored or claimed role to a known one, or None.

    Mirrors `toAppRole` in the frontend for the one legacy value, but returns
    None rather than defaulting to Teacher: silently promoting an unknown role
    to a real one is how an authorisation bug gets hidden.
    """
    role = str(value or "")
    if role == LEGACY_ADMIN:
        return SCHOOL_ADMIN
    return role if role in ALL_ROLES else None


def is_school_scoped(role: str) -> bool:
    return role in SCHOOL_SCOPED_ROLES
