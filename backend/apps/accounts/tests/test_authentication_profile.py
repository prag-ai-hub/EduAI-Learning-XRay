"""The token proves identity; the database decides authority.

`app_metadata.role` in a Supabase token can be stale - a role change or a
disabled account takes effect in the database at once, but not in a token
already sitting in a browser tab. These tests pin that the profile, not the
token, is what the request is authorised against.
"""

import dataclasses
import time

import jwt
import pytest
from django.conf import settings
from rest_framework.exceptions import AuthenticationFailed, PermissionDenied
from rest_framework.test import APIRequestFactory

from apps.accounts import roles
from apps.accounts.authentication import SupabaseJWTAuthentication
from apps.accounts.models import User

pytestmark = pytest.mark.django_db


def token_for(user_id, **overrides) -> str:
    claims = {
        "sub": str(user_id),
        "email": "whatever@school.test",
        "aud": "authenticated",
        "exp": int(time.time()) + 3600,
    }
    claims.update(overrides)
    return jwt.encode(claims, settings.SUPABASE_JWT_SECRET, algorithm="HS256")


def authenticate(raw):
    request = APIRequestFactory().get("/api/v1/", HTTP_AUTHORIZATION=f"Bearer {raw}")
    return SupabaseJWTAuthentication().authenticate(request)


def test_a_valid_token_resolves_the_profile(make_school, make_user):
    school = make_school()
    teacher = make_user(roles.TEACHER, school=school)

    principal, _ = authenticate(token_for(teacher.id))

    assert principal.id == str(teacher.id)
    assert principal.email == teacher.email
    assert principal.role == roles.TEACHER
    assert principal.school_id == school.id
    assert principal.is_authenticated is True
    assert principal.is_super_admin is False


def test_role_comes_from_the_database_not_the_token(make_school, make_user):
    # The attack this closes: mint or keep a token claiming SuperAdmin while the
    # profile row says Teacher.
    school = make_school()
    teacher = make_user(roles.TEACHER, school=school)

    principal, _ = authenticate(
        token_for(teacher.id, app_metadata={"role": "SuperAdmin", "school_id": "other"})
    )

    assert principal.role == roles.TEACHER
    assert principal.school_id == school.id
    assert principal.is_super_admin is False


def test_a_token_for_an_unknown_subject_is_refused(make_school):
    # Valid signature, no profile row: the identity exists in Supabase but
    # signup was never completed. 403, because a fresh token will not help.
    import uuid

    with pytest.raises(PermissionDenied, match="Complete your profile"):
        authenticate(token_for(uuid.uuid4()))


def test_a_disabled_account_is_refused(make_school, make_user):
    school = make_school()
    teacher = make_user(roles.TEACHER, school=school, status=User.Status.DISABLED)
    with pytest.raises(PermissionDenied, match="disabled"):
        authenticate(token_for(teacher.id))


def test_an_account_with_disabled_at_set_is_refused(make_school, make_user):
    from django.utils import timezone

    school = make_school()
    teacher = make_user(roles.TEACHER, school=school, disabled_at=timezone.now())
    # status is still Active - disabled_at alone must be enough to stop them.
    assert teacher.status == User.Status.ACTIVE
    with pytest.raises(PermissionDenied, match="disabled"):
        authenticate(token_for(teacher.id))


def test_a_super_admin_resolves_with_no_school(make_user):
    admin = make_user(roles.SUPER_ADMIN)
    principal, _ = authenticate(token_for(admin.id))
    assert principal.is_super_admin is True
    assert principal.school_id is None


def test_a_parent_resolves_with_no_school(make_user):
    parent = make_user(roles.PARENT)
    principal, _ = authenticate(token_for(parent.id))
    assert principal.is_parent is True
    assert principal.school_id is None


def test_an_expired_token_never_reaches_the_database(make_school, make_user):
    school = make_school()
    teacher = make_user(roles.TEACHER, school=school)
    with pytest.raises(AuthenticationFailed):
        authenticate(token_for(teacher.id, exp=int(time.time()) - 1))


def test_the_principal_cannot_be_mutated(make_school, make_user):
    # A handler must not be able to widen its own authority mid-request.
    school = make_school()
    principal, _ = authenticate(token_for(make_user(roles.TEACHER, school=school).id))
    with pytest.raises(dataclasses.FrozenInstanceError):
        principal.role = roles.SUPER_ADMIN


def test_capabilities_follow_the_resolved_role(make_school, make_user):
    from apps.accounts.capabilities import Capability as C

    school = make_school()
    teacher_principal, _ = authenticate(token_for(make_user(roles.TEACHER, school=school).id))
    admin_principal, _ = authenticate(token_for(make_user(roles.SUPER_ADMIN).id))

    assert teacher_principal.can(C.TEACHING_GRADING_RUN)
    assert not admin_principal.can(C.TEACHING_GRADING_RUN)
    assert admin_principal.can(C.PLATFORM_SCHOOL_APPROVE)
    assert not teacher_principal.can(C.PLATFORM_SCHOOL_APPROVE)
