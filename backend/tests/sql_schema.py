"""Read the allowed values of enumerated columns out of the SQL migrations.

The migrations in ../../supabase/migrations are the authority on what the
database will accept. These helpers let a test compare a Django TextChoices
against that authority without needing a live database, so the check runs in
CI on a clean checkout.

Migrations are immutable history: a column's constraint can be redefined by a
later file. Files are therefore read in filename order and a later definition
wins, the same rule the frontend's plpgsql-conventions suite applies to
function definitions.
"""

from __future__ import annotations

import re
from functools import cache
from pathlib import Path

MIGRATIONS = Path(__file__).resolve().parents[2] / "supabase" / "migrations"

# check (col in ('a','b')) - the form every enumerated column in these
# migrations uses, whether inline in a CREATE TABLE or added by an ALTER.
_CHECK = re.compile(
    r"check\s*\(\s*(?P<col>[a-z_][a-z0-9_]*)\s+in\s*\(\s*(?P<vals>'[^)]*?')\s*\)",
    re.IGNORECASE,
)
_VALUE = re.compile(r"'([^']*)'")


def _strip_comments(sql: str) -> str:
    """Assertions must read executable SQL, not the prose explaining it."""
    return re.sub(r"^\s*--.*$", "", sql, flags=re.MULTILINE)


def _create_table_body(sql: str, table: str) -> str | None:
    """Return the text between the parentheses of `create table public.<table> (...)`."""
    match = re.search(
        rf"create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?{table}\s*\(",
        sql,
        re.IGNORECASE,
    )
    if not match:
        return None
    depth, start = 0, match.end() - 1
    for i in range(start, len(sql)):
        if sql[i] == "(":
            depth += 1
        elif sql[i] == ")":
            depth -= 1
            if depth == 0:
                return sql[start + 1 : i]
    return None


def _alter_table_checks(sql: str, table: str) -> dict[str, set[str]]:
    """Constraints added to an existing table by `alter table ... add constraint`."""
    found: dict[str, set[str]] = {}
    pattern = rf"alter\s+table\s+(?:public\.)?{table}\b(.*?);"
    for statement in re.findall(pattern, sql, re.IGNORECASE | re.DOTALL):
        for check in _CHECK.finditer(statement):
            found[check.group("col").lower()] = set(_VALUE.findall(check.group("vals")))
    return found


@cache
def allowed_values(table: str, column: str) -> frozenset[str]:
    """Every value the database will accept in `public.<table>.<column>`.

    Raises LookupError when no CHECK constraint defines the column, so a test
    can never quietly pass against a constraint that was renamed or removed.
    """
    result: set[str] | None = None
    for path in sorted(MIGRATIONS.glob("*.sql")):
        sql = _strip_comments(path.read_text())

        body = _create_table_body(sql, table)
        if body:
            for check in _CHECK.finditer(body):
                if check.group("col").lower() == column.lower():
                    result = set(_VALUE.findall(check.group("vals")))

        altered = _alter_table_checks(sql, table)
        if column.lower() in altered:
            result = altered[column.lower()]

    if result is None:
        raise LookupError(
            f"No CHECK constraint found for public.{table}.{column} in "
            f"{MIGRATIONS}. Has the constraint been renamed or dropped?"
        )
    return frozenset(result)
