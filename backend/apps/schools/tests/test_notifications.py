"""Registration and lifecycle emails.

`transaction.on_commit` callbacks are discarded when a test's transaction rolls
back, so these use django_capture_on_commit_callbacks. Without it the tests
would pass while no email was ever sent - which is exactly the failure mode
worth guarding against.
"""

from unittest.mock import patch

import pytest
from django.core import mail

from apps.accounts.models import User
from apps.accounts.roles import SCHOOL_ADMIN, SUPER_ADMIN, TEACHER
from apps.schools.models import School

pytestmark = pytest.mark.django_db

REASON = {"reason": "Repeated billing disputes reported by the school."}


def detail(school, verb):
    return f"/api/v1/schools/{school.id}/{verb}/"


@pytest.fixture(autouse=True)
def _empty_outbox():
    mail.outbox.clear()
    yield
    mail.outbox.clear()


# --- registration -----------------------------------------------------------


def test_registering_emails_the_applicant(
    make_identity, api_client_for, django_capture_on_commit_callbacks
):
    subject, email = make_identity()
    with django_capture_on_commit_callbacks(execute=True):
        response = api_client_for(identity=(subject, email)).post(
            "/api/v1/schools/register",
            {"name": "Nehru Vidyalaya", "admin_name": "S. Rao"},
            format="json",
        )
    assert response.status_code == 201
    assert len(mail.outbox) == 1
    sent = mail.outbox[0]
    assert sent.to == [email]
    assert "received your school registration" in sent.subject
    assert "S. Rao" in sent.body
    assert "up to two working days" in sent.body


def test_a_rolled_back_registration_emails_nobody(
    make_identity, api_client_for, django_capture_on_commit_callbacks
):
    # An applicant must not be told it worked when it did not.
    subject, email = make_identity()
    with django_capture_on_commit_callbacks(execute=True):
        response = api_client_for(identity=(subject, email)).post(
            "/api/v1/schools/register", {"name": "X", "admin_name": "S. Rao"}, format="json"
        )
    assert response.status_code == 400
    assert mail.outbox == []


# --- lifecycle --------------------------------------------------------------


def test_approval_tells_the_administrator_where_to_sign_in(
    make_school, make_user, api_client_for, django_capture_on_commit_callbacks
):
    school = make_school(status=School.Status.PENDING)
    admin = make_user(SCHOOL_ADMIN, school=school)
    with django_capture_on_commit_callbacks(execute=True):
        api_client_for(make_user(SUPER_ADMIN)).post(detail(school, "approve"))

    assert [m.to for m in mail.outbox] == [[admin.email]]
    assert "approved and is now active" in mail.outbox[0].body


@pytest.mark.parametrize(
    ("verb", "status", "phrase"),
    [
        ("reject", School.Status.PENDING, "unable to approve"),
        ("suspend", School.Status.ACTIVE, "has been suspended"),
    ],
)
def test_a_decision_email_carries_the_reason(
    make_school,
    make_user,
    api_client_for,
    django_capture_on_commit_callbacks,
    verb,
    status,
    phrase,
):
    school = make_school(status=status)
    make_user(SCHOOL_ADMIN, school=school)
    with django_capture_on_commit_callbacks(execute=True):
        api_client_for(make_user(SUPER_ADMIN)).post(detail(school, verb), REASON, format="json")

    assert len(mail.outbox) == 1
    assert phrase in mail.outbox[0].body
    assert REASON["reason"] in mail.outbox[0].body


def test_a_suspension_email_says_the_work_is_not_lost(
    make_school, make_user, api_client_for, django_capture_on_commit_callbacks
):
    # Matrix §5: suspension stops new billable work, it does not destroy access
    # to work already done or hide the invoice needed to reactivate.
    school = make_school(status=School.Status.ACTIVE)
    make_user(SCHOOL_ADMIN, school=school)
    with django_capture_on_commit_callbacks(execute=True):
        api_client_for(make_user(SUPER_ADMIN)).post(
            detail(school, "suspend"), REASON, format="json"
        )
    body = mail.outbox[0].body
    assert "not deleted" in body
    assert "invoices" in body


def test_every_active_administrator_is_told(
    make_school, make_user, api_client_for, django_capture_on_commit_callbacks
):
    school = make_school(status=School.Status.PENDING)
    first = make_user(SCHOOL_ADMIN, school=school)
    second = make_user(SCHOOL_ADMIN, school=school)
    with django_capture_on_commit_callbacks(execute=True):
        api_client_for(make_user(SUPER_ADMIN)).post(detail(school, "approve"))

    assert sorted(m.to[0] for m in mail.outbox) == sorted([first.email, second.email])


def test_teachers_and_disabled_admins_are_not_told(
    make_school, make_user, api_client_for, django_capture_on_commit_callbacks
):
    # Mail to an account that lost access for a reason is worse than no mail.
    school = make_school(status=School.Status.PENDING)
    active = make_user(SCHOOL_ADMIN, school=school)
    make_user(SCHOOL_ADMIN, school=school, status=User.Status.DISABLED)
    make_user(TEACHER, school=school)
    with django_capture_on_commit_callbacks(execute=True):
        api_client_for(make_user(SUPER_ADMIN)).post(detail(school, "approve"))

    assert [m.to for m in mail.outbox] == [[active.email]]


# --- failure handling -------------------------------------------------------


def test_a_failed_send_does_not_undo_the_decision(
    make_school, make_user, api_client_for, django_capture_on_commit_callbacks
):
    school = make_school(status=School.Status.PENDING)
    make_user(SCHOOL_ADMIN, school=school)
    with django_capture_on_commit_callbacks(execute=True):
        with patch("apps.schools.notifications.send_mail", side_effect=OSError("smtp down")):
            response = api_client_for(make_user(SUPER_ADMIN)).post(detail(school, "approve"))

    assert response.status_code == 200
    school.refresh_from_db()
    assert school.status == School.Status.ACTIVE


def test_a_school_with_no_administrator_is_not_an_error(
    make_school, make_user, api_client_for, django_capture_on_commit_callbacks
):
    school = make_school(status=School.Status.PENDING)
    with django_capture_on_commit_callbacks(execute=True):
        response = api_client_for(make_user(SUPER_ADMIN)).post(detail(school, "approve"))
    assert response.status_code == 200
    assert mail.outbox == []


def test_logs_record_counts_not_addresses(
    make_school, make_user, api_client_for, django_capture_on_commit_callbacks, caplog
):
    school = make_school(status=School.Status.PENDING)
    admin = make_user(SCHOOL_ADMIN, school=school)
    with caplog.at_level("INFO"), django_capture_on_commit_callbacks(execute=True):
        api_client_for(make_user(SUPER_ADMIN)).post(detail(school, "approve"))

    logged = " ".join(record.getMessage() for record in caplog.records)
    assert "notified 1 administrator" in logged
    assert admin.email not in logged
