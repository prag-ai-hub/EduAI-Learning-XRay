"""The role enum is defined in three places. This test is what stops them drifting.

`apps/accounts/roles.py`, `frontend/lib/roles.ts` and the `users_role_check`
constraint in the M7 migration must name exactly the same four roles. A
mismatch does not fail a build - it fails at runtime, as a write rejected by
the database or an authorisation check that silently never matches.
"""

import re
from pathlib import Path

import pytest

from apps.accounts import roles

REPO = Path(__file__).resolve().parents[4]
M7 = REPO / "supabase" / "migrations" / "20260903000000_roles_and_school_status.sql"
FRONTEND_ROLES = REPO / "frontend" / "lib" / "roles.ts"


def strip_sql_comments(sql: str) -> str:
    # Assertions must read executable SQL, not the prose explaining it.
    return re.sub(r"^\s*--.*$", "", sql, flags=re.MULTILINE)


@pytest.fixture(scope="module")
def sql_roles() -> set[str]:
    sql = strip_sql_comments(M7.read_text())
    match = re.search(
        r"add constraint users_role_check\s*check\s*\(\s*role in \(([^)]*)\)",
        sql,
        re.IGNORECASE,
    )
    assert match, "users_role_check not found in M7 - has the constraint moved?"
    return set(re.findall(r"'([^']+)'", match.group(1)))


@pytest.fixture(scope="module")
def frontend_roles() -> set[str]:
    ts = FRONTEND_ROLES.read_text()
    match = re.search(r"export type AppRole\s*=\s*([^;]+);", ts)
    assert match, "AppRole union not found in frontend/lib/roles.ts"
    return set(re.findall(r'"([^"]+)"', match.group(1)))


def test_python_matches_the_database_constraint(sql_roles):
    assert set(roles.ALL_ROLES) == sql_roles


def test_python_matches_the_frontend_union(frontend_roles):
    assert set(roles.ALL_ROLES) == frontend_roles


def test_roles_are_pascal_case_as_stored():
    # The values are written to public.users.role verbatim. snake_case here
    # would be rejected by the constraint on every write.
    for role in roles.ALL_ROLES:
        assert role[0].isupper(), f"{role!r} is not in the stored PascalCase form"
        assert "_" not in role


def test_the_legacy_admin_value_is_not_a_current_role(sql_roles):
    assert roles.LEGACY_ADMIN not in sql_roles
    assert roles.normalize(roles.LEGACY_ADMIN) == roles.SCHOOL_ADMIN


def test_school_scoped_roles_match_the_scope_constraint():
    # M7: check ((role in ('SchoolAdmin','Teacher')) = (school_id is not null))
    sql = strip_sql_comments(M7.read_text())
    match = re.search(
        r"add constraint users_role_school_scope_check\s*check\s*"
        r"\(\s*\(\s*role in \(([^)]*)\)",
        sql,
        re.IGNORECASE,
    )
    assert match, "users_role_school_scope_check not found in M7"
    assert roles.SCHOOL_SCOPED_ROLES == set(re.findall(r"'([^']+)'", match.group(1)))


def test_choices_cover_every_role():
    assert roles.CHOICES == tuple((r, r) for r in roles.ALL_ROLES)
