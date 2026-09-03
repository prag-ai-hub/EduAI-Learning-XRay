"""Django must never own a table in `public`.

The application schema is built by ../../supabase/migrations and shared with
the Next.js app, which keeps reading and writing it. If Django ever starts
managing one of those tables, two migration systems are describing one schema
and they will diverge - silently, until a deploy fails or a column is dropped
from under the other service.

These tests are the guard on that decision. See docs/ARCHITECTURE.md.
"""

import pytest
from django.apps import apps
from django.conf import settings
from django.db.migrations.loader import MigrationLoader
from django.db.migrations.operations.models import CreateModel

# The apps whose models map tables owned by the SQL migrations.
LOCAL_APP_LABELS = ("accounts", "schools", "billing", "parents", "audit")

LOCAL_MODELS = [
    model for label in LOCAL_APP_LABELS for model in apps.get_app_config(label).get_models()
]


def test_the_app_list_is_not_silently_empty():
    # A refactor that renames an app would otherwise make every test below
    # vacuously pass.
    assert len(LOCAL_MODELS) >= 14


@pytest.mark.parametrize("model", LOCAL_MODELS, ids=lambda m: m._meta.label)
def test_every_model_is_unmanaged(model):
    assert model._meta.managed is False, (
        f"{model._meta.label} is managed. Django would emit DDL for "
        f"public.{model._meta.db_table}, which supabase/migrations owns."
    )


@pytest.mark.parametrize("model", LOCAL_MODELS, ids=lambda m: m._meta.label)
def test_every_model_names_its_table_explicitly(model):
    # Without db_table Django invents `<app>_<model>`, which is not the table
    # that exists.
    assert model._meta.original_attrs.get("db_table"), (
        f"{model._meta.label} does not set Meta.db_table"
    )


def test_no_two_models_claim_the_same_table():
    seen: dict[str, str] = {}
    for model in LOCAL_MODELS:
        table = model._meta.db_table
        assert table not in seen, f"{model._meta.label} and {seen[table]} both map public.{table}"
        seen[table] = model._meta.label


def test_no_migration_creates_a_managed_model():
    """Every CreateModel in our own migrations must carry managed = False.

    This is what makes `manage.py migrate` a no-op against `public`: Django
    skips DDL entirely for a model it does not manage.
    """
    loader = MigrationLoader(None, ignore_no_migrations=True)
    offenders = []
    for (app_label, name), migration in loader.disk_migrations.items():
        if app_label not in LOCAL_APP_LABELS:
            continue
        for operation in migration.operations:
            if isinstance(operation, CreateModel):
                if operation.options.get("managed", True) is not False:
                    offenders.append(f"{app_label}.{name}: {operation.name}")
    assert not offenders, "migrations would create real tables: " + ", ".join(offenders)


def test_django_keeps_its_own_tables_out_of_the_application_schema():
    options = settings.DATABASES["default"]["OPTIONS"]["options"]
    assert "search_path=" in options.replace(" ", "")
    # Django creates into the FIRST schema on the path and falls through to
    # the rest for reads. `django` must lead, or django_migrations and the
    # auth_* tables land in public.
    path = options.split("search_path=", 1)[1].strip()
    schemas = [s.strip() for s in path.split(",")]
    assert schemas[0] != "public", (
        "public leads the search_path - Django would create its bookkeeping "
        "tables in the application schema"
    )
    assert "public" in schemas, "public must stay on the path for reads"
