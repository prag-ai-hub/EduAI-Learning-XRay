"""Django cannot create a user, and that is deliberate.

`public.users.id` carries a foreign key to `auth.users.id` (M13,
ON DELETE CASCADE). An identity row is Supabase Auth's to create; Django can
only attach or update the profile that hangs off it. Any endpoint that thinks
it can sign a user up - school registration (Day 6), parent sign-up (Day 11) -
has to go through Supabase first and reach this table second.

This test fails if that foreign key is ever dropped, so the assumption gets
revisited deliberately rather than discovered by an IntegrityError.
"""

import re
from pathlib import Path

MIGRATIONS = Path(__file__).resolve().parents[4] / "supabase" / "migrations"


def executable_sql() -> str:
    """All migration SQL, in order, with comments stripped."""
    return "\n".join(
        re.sub(r"^\s*--.*$", "", path.read_text(), flags=re.MULTILINE)
        for path in sorted(MIGRATIONS.glob("*.sql"))
    )


def test_public_users_id_still_references_auth_users():
    sql = executable_sql()
    match = re.search(
        r"add\s+constraint\s+users_id_auth_fkey\s+foreign\s+key\s*\(\s*id\s*\)\s*"
        r"references\s+auth\.users\s*\(\s*id\s*\)\s*on\s+delete\s+cascade",
        sql,
        re.IGNORECASE | re.DOTALL,
    )
    assert match, (
        "users_id_auth_fkey is gone. If public.users no longer hangs off "
        "auth.users, Django may now create identities - and the assumption "
        "that Supabase Auth is the sole identity provider needs rechecking."
    )


def test_no_public_table_other_than_users_points_at_auth_users():
    """M13's rule: one parent for 'a user', and it is public.users.

    M13 repointed credit_transactions and invitations, which had referenced
    auth.users directly and given the schema two competing definitions.
    """
    sql = executable_sql()
    # The last migration to mention it must be M13's post-check, not a new
    # table declaring its own reference to auth.users.
    creations = re.findall(
        r"create\s+table[^;]*?references\s+auth\.users", sql, re.IGNORECASE | re.DOTALL
    )
    tables = {
        re.search(r"create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?(\w+)", c, re.I).group(1)
        for c in creations
    }
    # These three predate M13, which repointed them; no NEW table may join them.
    assert tables <= {"credit_transactions", "invitations", "users"}, (
        f"new table(s) reference auth.users directly: {sorted(tables)} - "
        "every user foreign key must point at public.users"
    )
