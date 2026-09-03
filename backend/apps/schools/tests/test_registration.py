"""'Register your school' and the Pending → Approved workflow."""

import pytest

from apps.accounts.models import User
from apps.accounts.roles import PARENT, SCHOOL_ADMIN, SUPER_ADMIN, TEACHER
from apps.audit.models import AuditEvent
from apps.audit.services import Action
from apps.schools.models import School

pytestmark = pytest.mark.django_db

URL = "/api/v1/schools/register"
PAYLOAD = {"name": "Nehru Vidyalaya", "city": "Pune", "board": "CBSE", "admin_name": "S. Rao"}


def test_a_new_account_can_register_a_school(make_identity, api_client_for):
    subject, email = make_identity()
    response = api_client_for(identity=(subject, email)).post(URL, PAYLOAD, format="json")

    assert response.status_code == 201
    body = response.json()
    assert body["role"] == SCHOOL_ADMIN
    assert body["school"]["name"] == "Nehru Vidyalaya"
    # The whole point of the workflow: never Active on creation.
    assert body["school"]["status"] == School.Status.PENDING


def test_registration_creates_the_administrator_profile(make_identity, api_client_for):
    subject, email = make_identity()
    api_client_for(identity=(subject, email)).post(URL, PAYLOAD, format="json")

    profile = User.objects.get(pk=subject)
    assert profile.role == SCHOOL_ADMIN
    assert profile.email == email
    assert profile.school.status == School.Status.PENDING
    # Registering must not hand out credits before anyone has paid.
    assert profile.total_credits == 0


def test_registration_is_audited(make_identity, api_client_for):
    subject, email = make_identity()
    school_id = (
        api_client_for(identity=(subject, email))
        .post(URL, PAYLOAD, format="json")
        .json()["school"]["id"]
    )

    event = AuditEvent.objects.get(action=Action.SCHOOL_REGISTERED, school_id=school_id)
    assert event.actor_id == subject
    assert event.detail_json["name"] == "Nehru Vidyalaya"


def test_an_anonymous_visitor_cannot_register(api_client_for):
    from rest_framework.test import APIClient

    assert APIClient().post(URL, PAYLOAD, format="json").status_code in (401, 403)


def test_an_account_that_already_has_a_profile_cannot_register(
    make_school, make_user, api_client_for
):
    # A teacher registering a school would end up holding two roles, which the
    # schema forbids anyway.
    teacher = make_user(TEACHER, school=make_school())
    response = api_client_for(teacher).post(URL, PAYLOAD, format="json")
    assert response.status_code == 400
    assert "already belongs" in str(response.json())


def test_registration_rolls_back_completely_on_failure(make_identity, api_client_for):
    subject, email = make_identity()
    before = School.objects.count()
    response = api_client_for(identity=(subject, email)).post(
        URL, {"name": "X", "admin_name": "S. Rao"}, format="json"
    )
    assert response.status_code == 400
    assert School.objects.count() == before
    assert not User.objects.filter(pk=subject).exists()


@pytest.mark.parametrize(
    ("payload", "field"),
    [
        ({"name": "X", "admin_name": "S. Rao"}, "name"),
        ({"name": "Nehru Vidyalaya", "admin_name": "S"}, "admin_name"),
        ({"admin_name": "S. Rao"}, "name"),
        ({"name": "Nehru Vidyalaya"}, "admin_name"),
    ],
)
def test_invalid_registrations_are_refused(make_identity, api_client_for, payload, field):
    subject, email = make_identity()
    response = api_client_for(identity=(subject, email)).post(URL, payload, format="json")
    assert response.status_code == 400
    assert field in str(response.json())


def test_unknown_fields_are_rejected_not_ignored(make_identity, api_client_for):
    # A silently-dropped key is a request that looks like it worked.
    subject, email = make_identity()
    response = api_client_for(identity=(subject, email)).post(
        URL, {**PAYLOAD, "status": "Active"}, format="json"
    )
    assert response.status_code == 400
    assert "status" in str(response.json())


def test_the_caller_cannot_choose_their_own_status_or_role(make_identity, api_client_for):
    subject, email = make_identity()
    api_client_for(identity=(subject, email)).post(URL, PAYLOAD, format="json")
    assert User.objects.get(pk=subject).role == SCHOOL_ADMIN
    assert School.objects.get(users__id=subject).status == School.Status.PENDING


def test_a_disabled_account_cannot_register_a_fresh_school(make_school, make_user, api_client_for):
    # A suspended administrator must not be able to start over.
    disabled = make_user(SCHOOL_ADMIN, school=make_school(), status=User.Status.DISABLED)
    response = api_client_for(disabled).post(URL, PAYLOAD, format="json")
    assert response.status_code == 403


# --- GET /schools/mine ------------------------------------------------------


def test_an_administrator_sees_their_own_school_status(make_school, make_user, api_client_for):
    school = make_school(status=School.Status.PENDING)
    admin = make_user(SCHOOL_ADMIN, school=school)
    body = api_client_for(admin).get("/api/v1/schools/mine").json()
    assert body["school"]["id"] == school.id
    assert body["school"]["status"] == School.Status.PENDING


@pytest.mark.parametrize("role", [SUPER_ADMIN, PARENT])
def test_a_user_with_no_school_gets_null(make_user, api_client_for, role):
    assert api_client_for(make_user(role)).get("/api/v1/schools/mine").json()["school"] is None
