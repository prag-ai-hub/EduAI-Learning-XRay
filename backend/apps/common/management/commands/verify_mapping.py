"""Check every unmanaged model against the database it claims to describe.

The models in apps/*/models.py mirror tables that ../../supabase/migrations
owns. Nothing in Django validates that mirror: a renamed column, a dropped
table or a changed type is only discovered when a query fails at runtime.

    python manage.py verify_mapping           # report and exit non-zero on drift
    python manage.py verify_mapping --quiet   # only report problems

Run it after applying new SQL migrations, and in the deploy pipeline.
"""

from django.apps import apps as django_apps
from django.core.management.base import BaseCommand, CommandError
from django.db import connection

LOCAL_APP_LABELS = ("accounts", "schools", "billing", "parents", "audit")

# Django field type -> the Postgres types that can back it.
COMPATIBLE = {
    "UUIDField": {"uuid"},
    "TextField": {"text", "character varying", "character"},
    "IntegerField": {"integer", "smallint"},
    "BigIntegerField": {"bigint", "integer"},
    "BooleanField": {"boolean"},
    "JSONField": {"jsonb", "json"},
    "DateTimeField": {"timestamp with time zone", "timestamp without time zone"},
    "DateField": {"date"},
    "ForeignKey": None,  # resolved to the target's primary key type
    "OneToOneField": None,
}


class Command(BaseCommand):
    help = "Verify every unmanaged model matches the live database schema."

    def add_arguments(self, parser):
        parser.add_argument(
            "--quiet",
            action="store_true",
            help="Print only problems, not the per-model summary.",
        )

    def handle(self, *args, **options):
        quiet = options["quiet"]
        columns = self._live_columns()
        problems: list[str] = []
        checked = 0

        for label in LOCAL_APP_LABELS:
            for model in django_apps.get_app_config(label).get_models():
                checked += 1
                problems.extend(self._check_model(model, columns, quiet))

        if problems:
            self.stderr.write("")
            for problem in problems:
                self.stderr.write(self.style.ERROR(f"  {problem}"))
            raise CommandError(f"{len(problems)} mapping problem(s) across {checked} models.")

        self.stdout.write(self.style.SUCCESS(f"\n{checked} models match the database schema."))

    def _live_columns(self) -> dict[str, dict[str, str]]:
        """{table: {column: postgres type}} for the application schema."""
        with connection.cursor() as cursor:
            cursor.execute(
                """
                select table_name, column_name, data_type
                from information_schema.columns
                where table_schema = 'public'
                """
            )
            result: dict[str, dict[str, str]] = {}
            for table, column, data_type in cursor.fetchall():
                result.setdefault(table, {})[column] = data_type
            return result

    def _check_model(self, model, columns, quiet) -> list[str]:
        table = model._meta.db_table
        label = model._meta.label
        problems: list[str] = []

        if table not in columns:
            return [f"{label}: table public.{table} does not exist"]

        for field in model._meta.concrete_fields:
            column = field.column
            if column not in columns[table]:
                problems.append(f"{label}.{field.name}: public.{table}.{column} does not exist")
                continue

            expected = self._expected_types(field)
            actual = columns[table][column]
            if expected and actual not in expected:
                problems.append(
                    f"{label}.{field.name}: public.{table}.{column} is "
                    f"{actual!r}, model says {field.get_internal_type()} "
                    f"(expects one of {sorted(expected)})"
                )

        if not quiet and not problems:
            count = len(model._meta.concrete_fields)
            self.stdout.write(f"  ok  {label:38} -> public.{table} ({count} fields)")
        return problems

    def _expected_types(self, field) -> set[str] | None:
        internal = field.get_internal_type()
        if internal in ("ForeignKey", "OneToOneField"):
            target = field.target_field
            return COMPATIBLE.get(target.get_internal_type())
        return COMPATIBLE.get(internal)
