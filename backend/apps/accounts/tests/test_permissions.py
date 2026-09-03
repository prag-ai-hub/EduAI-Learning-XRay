"""Permission classes: what kind of thing, not which rows."""

import pytest
from rest_framework.test import APIRequestFactory

from apps.accounts import roles
from apps.accounts.authentication import SupabasePrincipal
from apps.accounts.capabilities import Capability as C
from apps.accounts.permissions import (
    HasCapability,
    IsParent,
    IsSchoolAdmin,
    IsSuperAdmin,
    IsTeacher,
    requires,
)


def principal(role, school_id="school-1"):
    return SupabasePrincipal(
        id="11111111-1111-4111-8111-111111111111",
        email="someone@school.test",
        role=role,
        school_id=school_id if roles.is_school_scoped(role) else None,
        status="Active",
    )


def request_for(role=None):
    request = APIRequestFactory().get("/api/v1/")
    request.user = principal(role) if role else None
    return request


class View:
    def __init__(self, **attrs):
        self.__dict__.update(attrs)


# --- deny by default -------------------------------------------------------


def test_a_view_declaring_nothing_is_denied_not_opened():
    # A missing declaration is far likelier to be an oversight than an intent
    # to publish an endpoint.
    assert not HasCapability().has_permission(request_for(roles.SUPER_ADMIN), View())


def test_an_unauthenticated_caller_is_denied():
    view = View(required_capabilities={C.PLATFORM_SCHOOLS_LIST})
    assert not HasCapability().has_permission(request_for(None), view)


# --- capability checks -----------------------------------------------------


def test_the_declared_capability_is_enforced():
    view = View(required_capabilities={C.PLATFORM_SCHOOL_APPROVE})
    assert HasCapability().has_permission(request_for(roles.SUPER_ADMIN), view)
    for role in (roles.SCHOOL_ADMIN, roles.TEACHER, roles.PARENT):
        assert not HasCapability().has_permission(request_for(role), view)


def test_every_declared_capability_must_be_held():
    view = View(required_capabilities={C.SCHOOL_USERS_INVITE, C.PAYMENT_REFUND_ISSUE})
    # A SchoolAdmin may invite but may not refund, so the pair is refused.
    assert not HasCapability().has_permission(request_for(roles.SCHOOL_ADMIN), view)


def test_capability_map_selects_by_viewset_action():
    view = View(
        action="partial_update",
        capability_map={
            "list": C.PLATFORM_SCHOOLS_LIST,
            "partial_update": C.PLATFORM_SCHOOL_APPROVE,
        },
    )
    assert HasCapability().has_permission(request_for(roles.SUPER_ADMIN), view)
    assert not HasCapability().has_permission(request_for(roles.SCHOOL_ADMIN), view)


def test_an_action_absent_from_the_map_falls_back_to_the_view_declaration():
    view = View(
        action="destroy",
        capability_map={"list": C.PLATFORM_SCHOOLS_LIST},
        required_capabilities={C.PLATFORM_SCHOOL_SUSPEND},
    )
    assert HasCapability().has_permission(request_for(roles.SUPER_ADMIN), view)


def test_a_school_admin_cannot_reach_a_teaching_capability():
    # The regression this whole model exists to prevent.
    view = View(required_capabilities={C.TEACHING_GRADING_RUN})
    assert not HasCapability().has_permission(request_for(roles.SCHOOL_ADMIN), view)
    assert not HasCapability().has_permission(request_for(roles.SUPER_ADMIN), view)
    assert HasCapability().has_permission(request_for(roles.TEACHER), view)


# --- requires() ------------------------------------------------------------


def test_requires_builds_an_enforcing_class():
    permission = requires(C.PAYMENT_REFUND_ISSUE)()
    assert permission.has_permission(request_for(roles.SUPER_ADMIN), View())
    assert not permission.has_permission(request_for(roles.SCHOOL_ADMIN), View())


def test_requires_rejects_a_typo_at_import_time():
    # A misspelled capability would otherwise be a silently-denied endpoint.
    with pytest.raises(ValueError, match="unknown capability"):
        requires("platform.school.aprove")
    with pytest.raises(ValueError):
        requires()


# --- exact-role classes ----------------------------------------------------


@pytest.mark.parametrize(
    ("cls", "role"),
    [
        (IsSuperAdmin, roles.SUPER_ADMIN),
        (IsSchoolAdmin, roles.SCHOOL_ADMIN),
        (IsTeacher, roles.TEACHER),
        (IsParent, roles.PARENT),
    ],
)
def test_exact_role_classes_match_only_their_own_role(cls, role):
    permission = cls()
    for candidate in roles.ALL_ROLES:
        expected = candidate == role
        assert permission.has_permission(request_for(candidate), View()) is expected
