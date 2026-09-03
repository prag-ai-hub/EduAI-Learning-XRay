"""The Super Admin directory and the school lifecycle transitions."""

import pytest

from apps.accounts.roles import PARENT, SCHOOL_ADMIN, SUPER_ADMIN, TEACHER
from apps.audit.models import AuditEvent
from apps.audit.services import Action
from apps.schools.models import School

pytestmark = pytest.mark.django_db

LIST = "/api/v1/schools/"
REASON = {"reason": "Repeated billing disputes reported by the school."}


def detail(school, suffix=""):
    return f"/api/v1/schools/{school.id}/{suffix}"


# --- who may see the directory ---------------------------------------------


def test_a_super_admin_sees_the_cross_school_directory(make_school, make_user, api_client_for):
    make_school("One")
    make_school("Two")
    response = api_client_for(make_user(SUPER_ADMIN)).get(LIST)
    assert response.status_code == 200
    assert response.json()["count"] >= 2


@pytest.mark.parametrize("role", [SCHOOL_ADMIN, TEACHER, PARENT])
def test_no_other_role_may_list_schools(make_school, make_user, api_client_for, role):
    school = make_school()
    user = make_user(role, school=school if role in (SCHOOL_ADMIN, TEACHER) else None)
    assert api_client_for(user).get(LIST).status_code == 403


def test_an_anonymous_caller_cannot_list_schools():
    from rest_framework.test import APIClient

    assert APIClient().get(LIST).status_code in (401, 403)


def test_the_directory_can_be_filtered_by_status(make_school, make_user, api_client_for):
    make_school("Pending one", status=School.Status.PENDING)
    make_school("Active one", status=School.Status.ACTIVE)
    client = api_client_for(make_user(SUPER_ADMIN))
    statuses = {row["status"] for row in client.get(f"{LIST}?status=Pending").json()["results"]}
    assert statuses == {School.Status.PENDING}


# --- approve ----------------------------------------------------------------


def test_approving_a_pending_school_activates_it(make_school, make_user, api_client_for):
    school = make_school(status=School.Status.PENDING)
    admin = make_user(SUPER_ADMIN)

    response = api_client_for(admin).post(detail(school, "approve/"))

    assert response.status_code == 200
    school.refresh_from_db()
    assert school.status == School.Status.ACTIVE
    assert school.approved_at is not None
    assert str(school.approved_by_id) == str(admin.id)


def test_approval_is_audited(make_school, make_user, api_client_for):
    school = make_school(status=School.Status.PENDING)
    admin = make_user(SUPER_ADMIN)
    api_client_for(admin).post(detail(school, "approve/"))

    event = AuditEvent.objects.get(action=Action.SCHOOL_APPROVED, school_id=school.id)
    assert event.actor_id == str(admin.id)
    assert event.detail_json["to"] == School.Status.ACTIVE


def test_an_already_active_school_cannot_be_approved_again(make_school, make_user, api_client_for):
    school = make_school(status=School.Status.ACTIVE)
    response = api_client_for(make_user(SUPER_ADMIN)).post(detail(school, "approve/"))
    assert response.status_code == 400
    school.refresh_from_db()
    assert school.status == School.Status.ACTIVE


@pytest.mark.parametrize("role", [SCHOOL_ADMIN, TEACHER, PARENT])
def test_no_other_role_may_approve(make_school, make_user, api_client_for, role):
    school = make_school(status=School.Status.PENDING)
    user = make_user(role, school=school if role in (SCHOOL_ADMIN, TEACHER) else None)
    assert api_client_for(user).post(detail(school, "approve/")).status_code == 403
    school.refresh_from_db()
    assert school.status == School.Status.PENDING


def test_a_school_admin_cannot_approve_their_own_school(make_school, make_user, api_client_for):
    # The obvious self-service attack on an approval workflow.
    school = make_school(status=School.Status.PENDING)
    admin = make_user(SCHOOL_ADMIN, school=school)
    assert api_client_for(admin).post(detail(school, "approve/")).status_code == 403


# --- reject / suspend / reactivate -----------------------------------------


def test_rejecting_a_pending_school_closes_it(make_school, make_user, api_client_for):
    school = make_school(status=School.Status.PENDING)
    response = api_client_for(make_user(SUPER_ADMIN)).post(
        detail(school, "reject/"), REASON, format="json"
    )
    assert response.status_code == 200
    school.refresh_from_db()
    assert school.status == School.Status.CLOSED


def test_suspending_an_active_school_records_when(make_school, make_user, api_client_for):
    school = make_school(status=School.Status.ACTIVE)
    response = api_client_for(make_user(SUPER_ADMIN)).post(
        detail(school, "suspend/"), REASON, format="json"
    )
    assert response.status_code == 200
    school.refresh_from_db()
    assert school.status == School.Status.SUSPENDED
    assert school.suspended_at is not None


def test_a_suspended_school_can_be_reactivated(make_school, make_user, api_client_for):
    school = make_school(status=School.Status.SUSPENDED)
    api_client_for(make_user(SUPER_ADMIN)).post(
        detail(school, "reactivate/"), REASON, format="json"
    )
    school.refresh_from_db()
    assert school.status == School.Status.ACTIVE


def test_a_pending_school_cannot_be_suspended(make_school, make_user, api_client_for):
    school = make_school(status=School.Status.PENDING)
    response = api_client_for(make_user(SUPER_ADMIN)).post(
        detail(school, "suspend/"), REASON, format="json"
    )
    assert response.status_code == 400


@pytest.mark.parametrize("verb", ["reject", "suspend", "reactivate"])
def test_a_decision_requires_a_written_reason(make_school, make_user, api_client_for, verb):
    # These actions are appealable: the trail has to show a human judged.
    status = {
        "reject": School.Status.PENDING,
        "suspend": School.Status.ACTIVE,
        "reactivate": School.Status.SUSPENDED,
    }[verb]
    school = make_school(status=status)
    client = api_client_for(make_user(SUPER_ADMIN))
    assert client.post(detail(school, f"{verb}/"), {}, format="json").status_code == 400
    assert (
        client.post(detail(school, f"{verb}/"), {"reason": "too short"}, format="json").status_code
        == 400
    )
    school.refresh_from_db()
    assert school.status == status


def test_the_reason_reaches_the_audit_trail(make_school, make_user, api_client_for):
    school = make_school(status=School.Status.ACTIVE)
    api_client_for(make_user(SUPER_ADMIN)).post(detail(school, "suspend/"), REASON, format="json")
    event = AuditEvent.objects.get(action=Action.SCHOOL_SUSPENDED, school_id=school.id)
    assert event.detail_json["reason"] == REASON["reason"]


def test_status_cannot_be_moved_by_a_plain_write(make_school, make_user, api_client_for):
    # There is no PATCH into a state nobody chose - transitions only.
    school = make_school(status=School.Status.PENDING)
    client = api_client_for(make_user(SUPER_ADMIN))
    response = client.patch(detail(school), {"status": "Active"}, format="json")
    assert response.status_code in (403, 405)
    school.refresh_from_db()
    assert school.status == School.Status.PENDING
