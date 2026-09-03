"""Database fixtures for the backend suite.

The application tables are unmanaged - `supabase/migrations` creates them, not
Django - so pytest-django's usual "create a fresh test database and migrate"
would produce a database containing only Django's own bookkeeping tables, and
every query in these tests would fail against it.

So database tests run against the *configured* database, each inside a
transaction that pytest-django rolls back. Two guards make that safe:

  * the host must be local; a non-local DATABASE_URL fails the run outright,
  * tests skip themselves when nothing is listening, so the structural suite
    still runs on a checkout with no Supabase stack.

Start the stack with `make db-start && make db-reset` before running these.
"""

from __future__ import annotations

import uuid
from datetime import timedelta
from urllib.parse import urlparse

import pytest
from django.conf import settings
from django.db import connection
from django.utils import timezone

LOCAL_HOSTS = {"127.0.0.1", "localhost", "::1", "db", "postgres"}


def _configured_host() -> str:
    name = settings.DATABASES["default"].get("HOST") or ""
    if not name:
        # django-environ keeps the original URL around in some setups; fall
        # back to parsing it so the guard cannot be bypassed by config shape.
        import os

        name = urlparse(os.environ.get("DATABASE_URL", "")).hostname or ""
    return name


@pytest.fixture(scope="session")
def django_db_setup(django_db_blocker):
    """Reuse the configured database; never create or destroy one.

    Skipping here rather than in an autouse fixture is deliberate: this runs
    before pytest-django opens its transaction, so an unreachable database
    skips the database tests instead of erroring 37 times.
    """
    host = _configured_host()
    if host and host not in LOCAL_HOSTS:
        pytest.exit(
            f"Refusing to run database tests against non-local host {host!r}. "
            "These tests write and roll back against a real schema.",
            returncode=3,
        )
    with django_db_blocker.unblock():
        try:
            connection.ensure_connection()
        except Exception as exc:  # noqa: BLE001 - any connection failure is a skip
            pytest.skip(f"database unavailable ({type(exc).__name__}). Run `make db-start`.")
    # Intentionally no setup/teardown: the schema is owned by supabase/migrations.
    yield


# ---------------------------------------------------------------------------
# Factories
#
# `public.users.id` references `auth.users.id`, so a profile cannot exist
# without an identity - Supabase Auth normally creates it. `make_auth_user`
# stands in for that signup. See apps/accounts/models.User.
# ---------------------------------------------------------------------------


@pytest.fixture
def make_auth_user(db):
    def _make(email: str) -> uuid.UUID:
        user_id = uuid.uuid4()
        with connection.cursor() as cursor:
            cursor.execute(
                "insert into auth.users (id, instance_id, aud, role, email) "
                "values (%s, '00000000-0000-0000-0000-000000000000', "
                "'authenticated', 'authenticated', %s)",
                [str(user_id), email],
            )
        return user_id

    return _make


@pytest.fixture
def make_school(db):
    def _make(name="Nehru Vidyalaya", status=None):
        from apps.schools.models import School

        now = timezone.now()
        return School.objects.create(
            id=f"school-{uuid.uuid4()}",
            name=name,
            settings_json={},
            status=status or School.Status.ACTIVE,
            created_at=now,
            updated_at=now,
        )

    return _make


@pytest.fixture
def make_user(db, make_auth_user):
    def _make(role, school=None, email=None, status=None, disabled_at=None):
        from apps.accounts.models import User
        from apps.accounts.roles import is_school_scoped

        email = email or f"{role.lower()}-{uuid.uuid4().hex[:8]}@school.test"
        user_id = make_auth_user(email)
        now = timezone.now()
        # users_role_school_scope_check: exactly SchoolAdmin and Teacher carry a
        # school; SuperAdmin and Parent must not.
        assert bool(school) == is_school_scoped(role), (
            f"{role} must {'have' if is_school_scoped(role) else 'not have'} a school"
        )
        return User.objects.create(
            id=user_id,
            school=school,
            name=email.split("@")[0],
            email=email,
            role=role,
            status=status or User.Status.ACTIVE,
            profile_json={},
            total_credits=10,
            used_credits=0,
            disabled_at=disabled_at,
            created_at=now,
            updated_at=now,
        )

    return _make


@pytest.fixture
def make_grant(db):
    def _make(granted_to, school, hours=24, reason="Investigating a reported grading fault"):
        """A support grant expiring `hours` from now; negative means expired.

        `support_access_grants_check` is `expires_at > created_at`, so a grant
        cannot be born expired. An already-expired one is therefore backdated:
        issued in the past, and lapsed since.
        """
        from apps.schools.models import SupportAccessGrant

        now = timezone.now()
        expires_at = now + timedelta(hours=hours)
        created_at = min(now, expires_at - timedelta(minutes=1))
        return SupportAccessGrant.objects.create(
            id=uuid.uuid4(),
            school=school,
            granted_to=granted_to,
            granted_by=None,
            reason=reason,
            expires_at=expires_at,
            created_at=created_at,
        )

    return _make


@pytest.fixture
def make_student(db):
    def _make(school, name="A. Rao"):
        from apps.schools.models import Student

        now = timezone.now()
        return Student.objects.create(
            id=f"student-{uuid.uuid4()}",
            school=school,
            name=name,
            status="Active",
            created_at=now,
            updated_at=now,
        )

    return _make


@pytest.fixture
def make_link(db):
    def _make(parent, student, status=None):
        from apps.parents.models import ParentStudentLink, Relationship

        return ParentStudentLink.objects.create(
            id=uuid.uuid4(),
            parent_user=parent,
            student=student,
            school=student.school,
            relationship=Relationship.MOTHER,
            status=status or ParentStudentLink.Status.ACTIVE,
            linked_via=ParentStudentLink.LinkedVia.ADMIN,
            created_at=timezone.now(),
        )

    return _make


@pytest.fixture
def api_client_for():
    """An APIClient carrying a valid Supabase token for a user or a bare identity.

    `identity=` builds a token for a Supabase account with no profile row - the
    state a visitor is in between signing up and registering a school.
    """
    import jwt
    from rest_framework.test import APIClient

    def _make(user=None, *, identity: tuple[str, str] | None = None):
        if identity is not None:
            subject, email = identity
        else:
            subject, email = str(user.id), user.email
        token = jwt.encode(
            {
                "sub": str(subject),
                "email": email,
                "aud": settings.SUPABASE_JWT_AUDIENCE,
                "exp": int(timezone.now().timestamp()) + 3600,
            },
            settings.SUPABASE_JWT_SECRET,
            algorithm="HS256",
        )
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
        return client

    return _make


@pytest.fixture
def make_identity(make_auth_user):
    """A Supabase account that exists but has no profile row yet."""

    def _make(email=None):
        email = email or f"newcomer-{uuid.uuid4().hex[:8]}@school.test"
        return str(make_auth_user(email)), email

    return _make
