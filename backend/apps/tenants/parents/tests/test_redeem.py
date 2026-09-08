"""Redeeming an invite code (Day 11 task 3).

This is the only way a `parent_student_links` row is created from outside the
school, so it is the endpoint the whole B2C product's authorisation rests on.
Four properties are tested here because each one, missing, is a distinct
vulnerability:

  * every refusal is identical, or the endpoint is an oracle for which codes
    exist and which addresses hold accounts;
  * redeeming twice returns the same link, or a retried request duplicates
    access;
  * a spent code stays spent, or a slip left on a kitchen table is reusable;
  * only a Parent may redeem, at the capability and again at the table.
"""

from datetime import timedelta

import pytest

from apps.accounts.roles import PARENT, SCHOOL_ADMIN, TEACHER
from apps.platform.audit.models import AuditEvent
from apps.tenants.parents.models import ParentInviteCode, ParentStudentLink
from apps.tenants.parents.services import ParentAction

pytestmark = pytest.mark.django_db

ENDPOINT = "/api/v1/parents/links/redeem"


@pytest.fixture
def issued(make_school, make_user, make_student, make_invite):
    """A live code, and everything it points at."""

    def _make(**overrides):
        school = make_school()
        teacher = make_user(TEACHER, school=school)
        student = make_student(school, name="Meera Rao")
        invite = make_invite(student=student, issuer=teacher, **overrides)
        return school, student, invite

    return _make


def test_a_parent_redeems_a_code_and_is_linked_to_the_child(issued, make_user, api_client_for):
    school, student, invite = issued()
    parent = make_user(PARENT)

    response = api_client_for(parent).post(ENDPOINT, {"code": invite.code}, format="json")

    assert response.status_code == 201
    assert response.data["child"]["name"] == "Meera Rao"
    assert response.data["link"]["relationship"] == "Mother"

    link = ParentStudentLink.objects.get(parent_user_id=parent.id, student_id=student.id)
    assert link.status == ParentStudentLink.Status.ACTIVE
    assert link.school_id == school.id
    assert link.linked_via == ParentStudentLink.LinkedVia.INVITE_CODE

    invite.refresh_from_db()
    assert invite.used_count == 1


def test_a_code_is_accepted_in_any_case_and_with_stray_spacing(issued, make_user, api_client_for):
    # A parent retypes what is on a slip. Case and padding are not the secret.
    _, _, invite = issued()
    parent = make_user(PARENT)

    response = api_client_for(parent).post(
        ENDPOINT, {"code": f"  {invite.code.lower()} "}, format="json"
    )

    assert response.status_code == 201


def test_redeeming_twice_returns_the_same_link_rather_than_a_second(
    issued, make_user, api_client_for
):
    _, student, invite = issued()
    parent = make_user(PARENT)
    client = api_client_for(parent)

    first = client.post(ENDPOINT, {"code": invite.code}, format="json")
    second = client.post(ENDPOINT, {"code": invite.code}, format="json")

    assert first.status_code == second.status_code == 201
    assert first.data["link"]["id"] == second.data["link"]["id"]
    assert ParentStudentLink.objects.filter(parent_user_id=parent.id).count() == 1
    invite.refresh_from_db()
    assert invite.used_count == 1


def test_a_single_use_code_cannot_be_spent_by_a_second_parent(issued, make_user, api_client_for):
    _, _, invite = issued()
    first, second = make_user(PARENT), make_user(PARENT)

    claimed = api_client_for(first).post(ENDPOINT, {"code": invite.code}, format="json")
    refused = api_client_for(second).post(ENDPOINT, {"code": invite.code}, format="json")

    assert claimed.status_code == 201

    assert refused.status_code == 400
    assert not ParentStudentLink.objects.filter(parent_user_id=second.id).exists()


# --- every refusal looks the same -------------------------------------------


def _refusals(issued, make_user, api_client_for):
    """One response per failure mode, each from a fresh parent and code."""
    parent = make_user(PARENT)
    client = api_client_for(parent)
    answers = {}

    answers["nonexistent"] = client.post(ENDPOINT, {"code": "ZZZZZZZZZZ"}, format="json")
    answers["malformed"] = client.post(ENDPOINT, {"code": "not a code!"}, format="json")

    _, _, expired = issued(expires_in=timedelta(days=-1))
    answers["expired"] = client.post(ENDPOINT, {"code": expired.code}, format="json")

    _, _, spent = issued(used_count=1)
    answers["spent"] = client.post(ENDPOINT, {"code": spent.code}, format="json")

    from django.utils import timezone

    _, _, revoked = issued(revoked_at=timezone.now())
    answers["revoked"] = client.post(ENDPOINT, {"code": revoked.code}, format="json")

    _, _, bound = issued(email="someone.else@home.test")
    answers["email_bound"] = client.post(ENDPOINT, {"code": bound.code}, format="json")

    return parent, answers


def test_every_way_a_code_can_fail_produces_the_identical_answer(issued, make_user, api_client_for):
    parent, answers = _refusals(issued, make_user, api_client_for)

    assert {response.status_code for response in answers.values()} == {400}
    bodies = {str(response.data) for response in answers.values()}
    assert len(bodies) == 1, f"refusals are distinguishable: {answers}"
    assert not ParentStudentLink.objects.filter(parent_user_id=parent.id).exists()


def test_an_expired_and_an_already_redeemed_code_fail_identically(
    issued, make_user, api_client_for
):
    # Named separately because it is the case the plan calls out: "already used"
    # tells an attacker the code was real.
    client = api_client_for(make_user(PARENT))
    _, _, expired = issued(expires_in=timedelta(days=-1))
    _, _, spent = issued(used_count=1)

    first = client.post(ENDPOINT, {"code": expired.code}, format="json")
    second = client.post(ENDPOINT, {"code": spent.code}, format="json")

    assert first.status_code == second.status_code == 400
    assert first.data == second.data


def test_a_stolen_email_bound_code_is_refused_and_stays_unspent(issued, make_user, api_client_for):
    # The one control that survives a code reaching the wrong hands: the SQL
    # function compares the bound address to the redeeming account's own.
    _, _, invite = issued(email="rightful.parent@home.test")
    thief = make_user(PARENT)

    response = api_client_for(thief).post(ENDPOINT, {"code": invite.code}, format="json")

    assert response.status_code == 400
    invite.refresh_from_db()
    assert invite.used_count == 0


def test_the_bound_parent_can_still_redeem_it(issued, make_user, api_client_for):
    parent = make_user(PARENT)
    _, _, invite = issued(email=parent.email.upper())

    response = api_client_for(parent).post(ENDPOINT, {"code": invite.code}, format="json")

    assert response.status_code == 201


# --- who may redeem ---------------------------------------------------------


@pytest.mark.parametrize("role", [TEACHER, SCHOOL_ADMIN])
def test_school_staff_cannot_redeem_a_code(issued, make_school, make_user, api_client_for, role):
    school, student, invite = issued()
    staff = make_user(role, school=school)

    response = api_client_for(staff).post(ENDPOINT, {"code": invite.code}, format="json")

    assert response.status_code == 403
    assert not ParentStudentLink.objects.filter(student_id=student.id).exists()
    invite.refresh_from_db()
    assert invite.used_count == 0


def test_the_table_refuses_a_non_parent_even_if_a_view_ever_forgets(issued, make_school, make_user):
    # Defence in depth: M8's parent_student_links_role_check trigger. The
    # capability is the first line, this is the one that survives a future view.
    import uuid

    from django.db import DatabaseError, transaction
    from django.utils import timezone

    school, student, _ = issued()
    teacher = make_user(TEACHER, school=school)

    with pytest.raises(DatabaseError), transaction.atomic():
        ParentStudentLink.objects.create(
            id=uuid.uuid4(),
            parent_user=teacher,
            student=student,
            school=school,
            relationship="Guardian",
            status=ParentStudentLink.Status.ACTIVE,
            linked_via=ParentStudentLink.LinkedVia.ADMIN,
            created_at=timezone.now(),
        )


# --- the trail --------------------------------------------------------------


def test_a_redemption_is_audited_to_the_issuing_school(issued, make_user, api_client_for):
    school, student, invite = issued()
    parent = make_user(PARENT)

    api_client_for(parent).post(ENDPOINT, {"code": invite.code}, format="json")

    event = AuditEvent.objects.get(action=ParentAction.LINK_REDEEMED)
    assert event.school_id == school.id
    assert event.actor_id == str(parent.id)
    assert event.detail_json["studentId"] == student.id
    assert invite.code not in str(event.detail_json)


def test_a_refusal_is_audited_with_the_reason_the_caller_was_not_told(
    issued, make_user, api_client_for
):
    school, _, invite = issued(expires_in=timedelta(days=-1))
    parent = make_user(PARENT)

    api_client_for(parent).post(ENDPOINT, {"code": invite.code}, format="json")

    event = AuditEvent.objects.get(action=ParentAction.LINK_REFUSED)
    assert event.school_id == school.id
    assert event.detail_json["reason"] == "expired"


def test_a_guess_that_matches_nothing_writes_no_audit_row(make_user, api_client_for):
    # A row per guess would let an attacker fill audit_events, and there is no
    # school to attribute it to. The throttle is the control for this case.
    api_client_for(make_user(PARENT)).post(ENDPOINT, {"code": "ZZZZZZZZZZ"}, format="json")

    assert not AuditEvent.objects.filter(action=ParentAction.LINK_REFUSED).exists()


# --- brute force ------------------------------------------------------------


def test_redemption_attempts_are_rate_limited_per_account(make_user, api_client_for):
    client = api_client_for(make_user(PARENT))

    codes = [
        client.post(ENDPOINT, {"code": f"AAAAAAAAA{n}"}, format="json").status_code
        for n in range(12)
    ]

    assert codes[0] == 400  # a wrong code, not a throttle
    assert 429 in codes
    assert codes.count(400) == 10  # the declared rate: ten an hour


def test_one_parent_s_attempts_do_not_lock_out_another(make_user, api_client_for, issued):
    _, _, invite = issued()
    noisy = api_client_for(make_user(PARENT))
    for n in range(11):
        noisy.post(ENDPOINT, {"code": f"BBBBBBBBB{n}"}, format="json")

    quiet = api_client_for(make_user(PARENT))

    assert noisy.post(ENDPOINT, {"code": invite.code}, format="json").status_code == 429
    assert quiet.post(ENDPOINT, {"code": invite.code}, format="json").status_code == 201


def test_a_throttled_attempt_never_reaches_the_code(make_user, api_client_for, issued):
    _, _, invite = issued()
    client = api_client_for(make_user(PARENT))
    for n in range(10):
        client.post(ENDPOINT, {"code": f"CCCCCCCCC{n}"}, format="json")

    refused = client.post(ENDPOINT, {"code": invite.code}, format="json")

    assert refused.status_code == 429
    assert ParentInviteCode.objects.get(pk=invite.id).used_count == 0
