"""Parent self-sign-up - the one profile a person creates for themselves.

What is asserted here is mostly what the endpoint refuses. Creating the row is
two lines; the reasons it must not create certain rows are the whole design:

  * the email is the token's, never the body's, because an email-bound invite
    code is matched against it;
  * an account that already belongs to a school cannot become a parent;
  * a Parent carries no school, which the database also enforces;
  * the account it creates reaches nothing until a code is redeemed.

The last one is the reason this endpoint can be identity-only at all, so it is
asserted end to end rather than argued for in a comment.
"""

from __future__ import annotations

import uuid

import pytest
from django.core.cache import cache

from apps.accounts.models import User
from apps.accounts.roles import PARENT, SCHOOL_ADMIN, SUPER_ADMIN, TEACHER

pytestmark = pytest.mark.django_db

URL = "/api/v1/accounts/parents"
PAYLOAD = {"name": "A. Kulkarni", "phone": "+91 98765 43210"}


@pytest.fixture(autouse=True)
def _clear_throttle_history():
    """The 'auth' scope is 10/min and its counters live in the cache.

    Several tests here post more than once, and a bucket leaked from a previous
    module would fail them for a reason that has nothing to do with the code
    under test.
    """
    cache.clear()
    yield
    cache.clear()


# --- creating the account ---------------------------------------------------


def test_a_new_account_can_sign_up_as_a_parent(make_identity, api_client_for):
    subject, email = make_identity()
    response = api_client_for(identity=(subject, email)).post(URL, PAYLOAD, format="json")

    assert response.status_code == 201
    body = response.json()
    assert body["created"] is True
    assert body["profile"]["role"] == PARENT
    assert body["profile"]["id"] == subject


def test_signup_creates_the_profile_row(make_identity, api_client_for):
    subject, email = make_identity()
    api_client_for(identity=(subject, email)).post(URL, PAYLOAD, format="json")

    profile = User.objects.get(pk=subject)
    assert profile.role == PARENT
    assert profile.name == "A. Kulkarni"
    assert profile.status == User.Status.ACTIVE
    # users_role_school_scope_check: a Parent must not carry a school. The
    # constraint would refuse the write; this is the assertion that the view
    # never asks it to.
    assert profile.school_id is None
    # Signing up must not hand out credits before anyone has paid.
    assert profile.total_credits == 0


def test_the_email_comes_from_the_token_not_the_body(make_identity, api_client_for):
    """The security property the whole endpoint hangs on.

    `redeem_parent_invite_code` matches an email-bound code against
    `public.users.email`. A caller who could name themselves could claim a code
    issued to somebody else's address, which is the one thing binding a code to
    an address is for.
    """
    subject, email = make_identity()
    response = api_client_for(identity=(subject, email)).post(
        URL, {**PAYLOAD, "email": "someone.else@school.test"}, format="json"
    )

    # Strict fields: an undeclared key is refused rather than ignored, so the
    # attempt is visible instead of silently doing nothing.
    assert response.status_code == 400
    assert "email" in response.json()["error"]["detail"]
    assert not User.objects.filter(pk=subject).exists()


def test_the_stored_email_is_the_verified_one(make_identity, api_client_for):
    subject, email = make_identity()
    api_client_for(identity=(subject, email)).post(URL, PAYLOAD, format="json")

    assert User.objects.get(pk=subject).email == email


def test_a_name_is_required(make_identity, api_client_for):
    subject, email = make_identity()
    response = api_client_for(identity=(subject, email)).post(URL, {}, format="json")

    assert response.status_code == 400
    assert not User.objects.filter(pk=subject).exists()


def test_a_name_of_invisible_characters_is_not_a_name(make_identity, api_client_for):
    """Sanitisation runs before length validation, so this is empty by the time
    `validate_name` sees it - not a two-character name."""
    subject, email = make_identity()
    response = api_client_for(identity=(subject, email)).post(URL, {"name": "​​​​"}, format="json")

    assert response.status_code == 400
    assert not User.objects.filter(pk=subject).exists()


def test_the_phone_is_optional(make_identity, api_client_for):
    subject, email = make_identity()
    response = api_client_for(identity=(subject, email)).post(
        URL, {"name": "A. Kulkarni"}, format="json"
    )

    assert response.status_code == 201
    assert User.objects.get(pk=subject).phone is None


# --- retrying ---------------------------------------------------------------


def test_signing_up_twice_returns_the_same_profile(make_identity, api_client_for):
    """The client calls this immediately before redeeming a code. A retry of a
    request whose response was lost must not look like a failure."""
    subject, email = make_identity()
    client = api_client_for(identity=(subject, email))

    first = client.post(URL, PAYLOAD, format="json")
    second = client.post(URL, {"name": "Someone Else"}, format="json")

    assert first.status_code == 201
    assert second.status_code == 200
    assert second.json()["created"] is False
    assert second.json()["profile"]["id"] == subject
    assert User.objects.filter(pk=subject).count() == 1
    # A second call is not an edit: the name from the first one stands.
    assert User.objects.get(pk=subject).name == "A. Kulkarni"


# --- refusing to convert an existing account --------------------------------


@pytest.mark.parametrize("role", [SCHOOL_ADMIN, TEACHER])
def test_a_school_account_cannot_become_a_parent(role, make_school, make_user, api_client_for):
    """A Teacher promoting themselves would shed their school - a Parent carries
    none - and land in a role whose scope is a set of links they could extend."""
    user = make_user(role, school=make_school())
    response = api_client_for(user).post(URL, PAYLOAD, format="json")

    assert response.status_code == 400
    user.refresh_from_db()
    assert user.role == role
    assert user.school_id is not None


def test_a_super_admin_cannot_become_a_parent(make_user, api_client_for):
    user = make_user(SUPER_ADMIN)
    response = api_client_for(user).post(URL, PAYLOAD, format="json")

    assert response.status_code == 400
    user.refresh_from_db()
    assert user.role == SUPER_ADMIN


def test_a_disabled_account_cannot_sign_up_again(make_user, api_client_for):
    """`SupabaseIdentityAuthentication` refuses a disabled row before the view
    runs, so a suspended account cannot start over as a parent."""
    from django.utils import timezone

    user = make_user(PARENT, status=User.Status.DISABLED, disabled_at=timezone.now())
    response = api_client_for(user).post(URL, PAYLOAD, format="json")

    assert response.status_code == 403


def test_an_anonymous_caller_is_refused(client):
    response = client.post(URL, PAYLOAD, content_type="application/json")

    assert response.status_code in (401, 403)
    assert not User.objects.filter(role=PARENT, name="A. Kulkarni").exists()


# --- what the account is worth on its own -----------------------------------


def test_a_fresh_parent_account_reaches_nothing(make_identity, api_client_for):
    """Why an identity-only endpoint is safe here.

    A Parent's capabilities are all scoped through `parent_student_links`. With
    no link the children list is empty, so creating the account grants access to
    nothing - the gate is the redemption endpoint, not this one.
    """
    subject, email = make_identity()
    client = api_client_for(identity=(subject, email))
    client.post(URL, PAYLOAD, format="json")

    children = client.get("/api/v1/parents/children/")
    assert children.status_code == 200
    assert children.json()["results"] == []


def test_a_fresh_parent_cannot_reach_a_child_they_have_not_linked(
    make_identity, make_school, make_student, api_client_for
):
    """And a real child they have not linked is indistinguishable from one that
    does not exist, so a fresh account cannot be used to enumerate a school's
    students."""
    student = make_student(make_school())
    subject, email = make_identity()
    client = api_client_for(identity=(subject, email))
    client.post(URL, PAYLOAD, format="json")

    real = client.get(f"/api/v1/parents/children/{student.id}/")
    invented = client.get(f"/api/v1/parents/children/student-{uuid.uuid4()}/")

    assert real.status_code == 403
    assert (real.status_code, real.json()) == (invented.status_code, invented.json())
