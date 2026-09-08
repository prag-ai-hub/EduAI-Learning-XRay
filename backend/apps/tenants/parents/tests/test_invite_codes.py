"""Issuing and revoking a parent invite code (Day 13 task 2).

The code is a bearer credential, so the two things under test are that it cannot
be guessed and that it cannot be issued for a child the caller has no claim to.
"""

import re

import pytest

from apps.accounts.roles import PARENT, SCHOOL_ADMIN, SUPER_ADMIN, TEACHER
from apps.platform.audit.models import AuditEvent
from apps.tenants.parents.models import ParentInviteCode
from apps.tenants.parents.services import ALPHABET, CODE_LENGTH, ParentAction, generate_code
from apps.tenants.schools.models import School

pytestmark = pytest.mark.django_db

ENDPOINT = "/api/v1/parents/invite-codes/"


def test_a_teacher_issues_a_single_use_code_for_their_own_student(
    make_school, make_user, make_student, api_client_for
):
    school = make_school()
    teacher = make_user(TEACHER, school=school)
    student = make_student(school)

    response = api_client_for(teacher).post(
        ENDPOINT, {"student_id": student.id, "relationship": "Mother"}, format="json"
    )

    assert response.status_code == 201
    body = response.data
    assert re.fullmatch(r"[A-Z0-9]{6,12}", body["code"])
    assert body["max_uses"] == 1
    assert body["used_count"] == 0
    assert body["student_id"] == student.id
    assert ParentInviteCode.objects.filter(pk=body["id"], school=school).exists()


def test_a_school_admin_may_issue_one_too(make_school, make_user, make_student, api_client_for):
    school = make_school()
    admin = make_user(SCHOOL_ADMIN, school=school)

    response = api_client_for(admin).post(
        ENDPOINT, {"student_id": make_student(school).id}, format="json"
    )

    assert response.status_code == 201


@pytest.mark.parametrize("role", [PARENT, SUPER_ADMIN])
def test_a_parent_and_a_super_admin_may_not_issue_one(
    make_school, make_user, make_student, api_client_for, role
):
    # A SuperAdmin does not hold teaching.parent.invite either: there is no
    # cross-tenant route to handing out access to a child.
    school = make_school()
    student = make_student(school)
    caller = make_user(role)

    response = api_client_for(caller).post(ENDPOINT, {"student_id": student.id}, format="json")

    assert response.status_code == 403
    assert not ParentInviteCode.objects.exists()


def test_a_teacher_cannot_issue_for_another_school_s_student(
    make_school, make_user, make_student, api_client_for
):
    mine, theirs = make_school("Mine"), make_school("Theirs")
    teacher = make_user(TEACHER, school=mine)
    outsider = make_student(theirs)

    response = api_client_for(teacher).post(ENDPOINT, {"student_id": outsider.id}, format="json")

    assert response.status_code == 400
    assert not ParentInviteCode.objects.exists()


def test_a_missing_student_answers_exactly_as_another_school_s_does(
    make_school, make_user, make_student, api_client_for
):
    # Otherwise the difference between the two answers is a cross-tenant roster
    # enumeration for anyone who can issue an invite.
    mine, theirs = make_school("Mine"), make_school("Theirs")
    client = api_client_for(make_user(TEACHER, school=mine))
    outsider = make_student(theirs)

    elsewhere = client.post(ENDPOINT, {"student_id": outsider.id}, format="json")
    nowhere = client.post(ENDPOINT, {"student_id": "student-does-not-exist"}, format="json")

    assert elsewhere.status_code == nowhere.status_code == 400
    assert elsewhere.data == nowhere.data


def test_a_suspended_school_cannot_enrol_new_parents(
    make_school, make_user, make_student, api_client_for
):
    school = make_school(status=School.Status.SUSPENDED)
    teacher = make_user(TEACHER, school=school)

    response = api_client_for(teacher).post(
        ENDPOINT, {"student_id": make_student(school).id}, format="json"
    )

    assert response.status_code == 403


def test_the_expiry_window_is_bounded(make_school, make_user, make_student, api_client_for):
    school = make_school()
    client = api_client_for(make_user(TEACHER, school=school))
    student = make_student(school)

    too_long = client.post(
        ENDPOINT, {"student_id": student.id, "expires_in_days": 365}, format="json"
    )

    assert too_long.status_code == 400


def test_an_unrecognised_field_is_refused_rather_than_dropped(
    make_school, make_user, make_student, api_client_for
):
    # max_uses is not a decision a request body gets to make. Silently ignoring
    # it would let a caller believe they had raised it.
    school = make_school()
    client = api_client_for(make_user(TEACHER, school=school))

    response = client.post(
        ENDPOINT, {"student_id": make_student(school).id, "max_uses": 5}, format="json"
    )

    assert response.status_code == 400


def test_issuing_is_audited_without_recording_the_code(
    make_school, make_user, make_student, api_client_for
):
    school = make_school()
    teacher = make_user(TEACHER, school=school)
    student = make_student(school)

    response = api_client_for(teacher).post(ENDPOINT, {"student_id": student.id}, format="json")

    event = AuditEvent.objects.get(action=ParentAction.INVITE_ISSUED)
    assert event.school_id == school.id
    assert event.actor_id == str(teacher.id)
    assert event.detail_json["studentId"] == student.id
    assert response.data["code"] not in str(event.detail_json)


def test_a_code_is_revocable_by_the_school(make_school, make_user, make_student, api_client_for):
    school = make_school()
    teacher = make_user(TEACHER, school=school)
    client = api_client_for(teacher)
    created = client.post(ENDPOINT, {"student_id": make_student(school).id}, format="json")

    response = client.post(f"{ENDPOINT}{created.data['id']}/revoke/", format="json")

    assert response.status_code == 200
    assert response.data["revoked_at"] is not None
    # The response to a revocation must not hand the code back.
    assert "code" not in response.data
    assert AuditEvent.objects.filter(action=ParentAction.INVITE_REVOKED).exists()


def test_another_school_cannot_revoke_a_code(
    make_school, make_user, make_student, make_invite, api_client_for
):
    mine, theirs = make_school("Mine"), make_school("Theirs")
    their_teacher = make_user(TEACHER, school=theirs)
    invite = make_invite(student=make_student(theirs), issuer=their_teacher)
    intruder = api_client_for(make_user(TEACHER, school=mine))

    response = intruder.post(f"{ENDPOINT}{invite.id}/revoke/", format="json")

    assert response.status_code == 404
    invite.refresh_from_db()
    assert invite.revoked_at is None


def test_a_code_cannot_be_read_back_after_it_is_issued(
    make_school, make_user, make_student, api_client_for
):
    # There is no list and no retrieve on purpose: an endpoint that returns a
    # live code lets anyone who can issue one harvest every code in the school.
    # Both are refused by the capability map rather than merely unrouted, which
    # is deny-by-default doing its job: an action nobody declared is denied.
    school = make_school()
    client = api_client_for(make_user(TEACHER, school=school))
    created = client.post(ENDPOINT, {"student_id": make_student(school).id}, format="json")

    assert client.get(ENDPOINT).status_code == 403
    assert client.get(f"{ENDPOINT}{created.data['id']}/").status_code == 403


# --- the code itself --------------------------------------------------------


def test_generated_codes_are_long_and_drawn_from_the_unambiguous_alphabet():
    code = generate_code()

    assert len(code) == CODE_LENGTH
    assert set(code) <= set(ALPHABET)
    # I/1 and O/0 are the pairs a person mistypes off a printed slip.
    assert not set("IO01") & set(ALPHABET)


def test_generated_codes_do_not_repeat():
    # 10 characters over 32 symbols is 50 bits; a collision in a thousand draws
    # would mean the generator is not what it claims to be.
    assert len({generate_code() for _ in range(1000)}) == 1000
