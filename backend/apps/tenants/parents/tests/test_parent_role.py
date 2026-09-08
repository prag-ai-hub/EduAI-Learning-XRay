"""A Parent authenticates, and carries no school.

Day 11 task 2 asks whether the existing auth bridge resolves a Parent correctly
end to end. `apps/accounts/authentication.py` reads role, school and status from
`public.users` on every request and does nothing role-specific, so it should -
but "should" is what these tests replace.

The constraint under test alongside it is `users_role_school_scope_check`:
SchoolAdmin and Teacher must carry a school, SuperAdmin and Parent must not. A
Parent with a school would make the ordinary tenant filter apply to them, which
is a quieter and much worse failure than a refused insert.
"""

import uuid

import pytest
from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.accounts.capabilities import Capability, capabilities_for
from apps.accounts.roles import PARENT, SCHOOL_ADMIN, TEACHER

pytestmark = pytest.mark.django_db


def test_a_parent_authenticates_and_reaches_the_parent_portal(make_user, api_client_for):
    parent = make_user(PARENT)
    assert parent.school_id is None

    response = api_client_for(parent).get("/api/v1/parents/children/")

    assert response.status_code == 200
    assert response.data["results"] == []


def test_a_parent_belongs_to_no_school(make_user, api_client_for):
    # /schools/mine is the endpoint the client polls for tenant context. A
    # parent has none, and must get an answer rather than an error.
    response = api_client_for(make_user(PARENT)).get("/api/v1/schools/mine")

    assert response.status_code == 200
    assert response.data == {"school": None}


def test_the_database_refuses_a_parent_carrying_a_school(make_school, make_auth_user):
    from apps.accounts.models import User

    school = make_school()
    now = timezone.now()
    user_id = make_auth_user(f"parent-{uuid.uuid4().hex[:8]}@home.test")

    with pytest.raises(IntegrityError), transaction.atomic():
        User.objects.create(
            id=user_id,
            school=school,
            name="R. Iyer",
            email=f"parent-{uuid.uuid4().hex[:8]}@home.test",
            role=PARENT,
            status=User.Status.ACTIVE,
            profile_json={},
            total_credits=0,
            used_credits=0,
            created_at=now,
            updated_at=now,
        )


def test_a_disabled_parent_is_refused(make_user, api_client_for):
    from apps.accounts.models import User

    parent = make_user(PARENT, status=User.Status.DISABLED)

    response = api_client_for(parent).get("/api/v1/parents/children/")

    assert response.status_code == 403


def test_a_parent_never_holds_the_three_withheld_capabilities():
    # Matrix §2, "Deliberate restrictions": raw scans, OCR text and AI rationale
    # are absent from the role, not scoped to their own children.
    parent = capabilities_for(PARENT)

    assert Capability.STUDENT_RAW_FILE_READ not in parent
    assert Capability.STUDENT_OCR_TEXT_READ not in parent
    assert Capability.STUDENT_AI_RATIONALE_READ not in parent
    assert Capability.PARENT_CHILD_LINK in parent


@pytest.mark.parametrize("role", [TEACHER, SCHOOL_ADMIN])
def test_school_staff_hold_no_parent_portal_capability(role):
    held = capabilities_for(role)

    assert Capability.PARENT_CHILD_LINK not in held
    assert Capability.PARENT_CHILDREN_LIST not in held
    assert Capability.PARENT_CHILD_REPORTS_READ not in held
