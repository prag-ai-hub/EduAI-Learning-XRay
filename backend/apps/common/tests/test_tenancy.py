"""Tenant isolation, and the two narrow doors through it.

The rule under test throughout: a SuperAdmin has no implicit cross-tenant
access. Without it the role quietly becomes "can read every school's student
data" - which is exactly the failure the role matrix §4 was written to stop.
"""

import pytest
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from apps.accounts import roles
from apps.accounts.authentication import SupabasePrincipal
from apps.audit.models import AuditEvent
from apps.common.tenancy import (
    CROSS_TENANT_READ,
    SuperAdminScope,
    TenantScopedQuerySetMixin,
    granted_school_ids,
    require_active_school,
    require_linked_child,
    require_school_scope,
)
from apps.parents.models import ParentStudentLink
from apps.schools.models import School, Student

pytestmark = pytest.mark.django_db


def principal_for(user):
    return SupabasePrincipal(
        id=str(user.id),
        email=user.email,
        role=user.role,
        school_id=user.school_id,
        status=user.status,
    )


# --- require_school_scope ---------------------------------------------------


def test_a_teacher_may_act_on_their_own_school(make_school, make_user):
    school = make_school()
    require_school_scope(principal_for(make_user(roles.TEACHER, school=school)), school.id)


def test_a_teacher_may_not_reach_another_school(make_school, make_user):
    mine, theirs = make_school("Mine"), make_school("Theirs")
    caller = principal_for(make_user(roles.TEACHER, school=mine))
    with pytest.raises(PermissionDenied, match="another school"):
        require_school_scope(caller, theirs.id)


def test_a_missing_school_is_a_bad_request_not_a_silent_pass(make_school, make_user):
    caller = principal_for(make_user(roles.TEACHER, school=make_school()))
    with pytest.raises(ValidationError):
        require_school_scope(caller, None)
    with pytest.raises(ValidationError):
        require_school_scope(caller, "")


def test_a_super_admin_without_a_grant_is_refused(make_school, make_user):
    school = make_school()
    caller = principal_for(make_user(roles.SUPER_ADMIN))
    with pytest.raises(PermissionDenied, match="active support grant"):
        require_school_scope(caller, school.id)


def test_a_super_admin_with_a_live_grant_is_allowed(make_school, make_user, make_grant):
    school = make_school()
    admin = make_user(roles.SUPER_ADMIN)
    make_grant(admin, school)
    require_school_scope(principal_for(admin), school.id)


def test_a_cross_tenant_read_writes_an_audit_row(make_school, make_user, make_grant):
    school = make_school()
    admin = make_user(roles.SUPER_ADMIN)
    grant = make_grant(admin, school, reason="Investigating a duplicated invoice")

    require_school_scope(principal_for(admin), school.id)

    event = AuditEvent.objects.get(action=CROSS_TENANT_READ, school_id=school.id)
    assert event.actor_id == str(admin.id)
    assert event.entity_type == "school"
    assert event.detail_json["grantId"] == str(grant.id)
    assert event.detail_json["reason"] == "Investigating a duplicated invoice"
    # The trail records why access was possible, never the data it reached.
    assert "student" not in str(event.detail_json).lower()


def test_an_expired_grant_does_not_authorise(make_school, make_user, make_grant):
    school = make_school()
    admin = make_user(roles.SUPER_ADMIN)
    make_grant(admin, school, hours=-1)
    with pytest.raises(PermissionDenied, match="active support grant"):
        require_school_scope(principal_for(admin), school.id)


def test_a_revoked_grant_does_not_authorise(make_school, make_user, make_grant):
    school = make_school()
    admin = make_user(roles.SUPER_ADMIN)
    grant = make_grant(admin, school)
    grant.revoked_at = timezone.now()
    grant.save(update_fields=["revoked_at"])
    with pytest.raises(PermissionDenied, match="active support grant"):
        require_school_scope(principal_for(admin), school.id)


def test_a_grant_for_one_school_does_not_open_another(make_school, make_user, make_grant):
    granted, other = make_school("Granted"), make_school("Other")
    admin = make_user(roles.SUPER_ADMIN)
    make_grant(admin, granted)
    require_school_scope(principal_for(admin), granted.id)
    with pytest.raises(PermissionDenied):
        require_school_scope(principal_for(admin), other.id)


def test_another_super_admins_grant_does_not_transfer(make_school, make_user, make_grant):
    school = make_school()
    holder, other = make_user(roles.SUPER_ADMIN), make_user(roles.SUPER_ADMIN)
    make_grant(holder, school)
    with pytest.raises(PermissionDenied):
        require_school_scope(principal_for(other), school.id)


# --- require_linked_child ---------------------------------------------------


def test_a_parent_reaches_only_a_linked_child(make_school, make_user, make_student, make_link):
    school = make_school()
    parent = make_user(roles.PARENT)
    mine, theirs = make_student(school, "Mine"), make_student(school, "Theirs")
    make_link(parent, mine)

    require_linked_child(principal_for(parent), mine.id)
    with pytest.raises(PermissionDenied, match="do not have access"):
        require_linked_child(principal_for(parent), theirs.id)


def test_a_revoked_link_grants_nothing(make_school, make_user, make_student, make_link):
    school = make_school()
    parent = make_user(roles.PARENT)
    student = make_student(school)
    make_link(parent, student, status=ParentStudentLink.Status.REVOKED)
    with pytest.raises(PermissionDenied):
        require_linked_child(principal_for(parent), student.id)


def test_a_teacher_is_not_a_parent(make_school, make_user, make_student):
    school = make_school()
    teacher = make_user(roles.TEACHER, school=school)
    student = make_student(school)
    with pytest.raises(PermissionDenied, match="parent accounts"):
        require_linked_child(principal_for(teacher), student.id)


# --- require_active_school --------------------------------------------------


@pytest.mark.parametrize(
    "status",
    [School.Status.PENDING, School.Status.SUSPENDED, School.Status.CLOSED],
)
def test_a_school_that_is_not_active_blocks_writes(make_school, make_user, status):
    school = make_school(status=status)
    with pytest.raises(PermissionDenied):
        require_active_school(principal_for(make_user(roles.TEACHER, school=school)))


def test_an_active_school_permits_writes(make_school, make_user):
    school = make_school(status=School.Status.ACTIVE)
    require_active_school(principal_for(make_user(roles.TEACHER, school=school)))


def test_a_super_admin_is_not_gated_by_school_status(make_user):
    require_active_school(principal_for(make_user(roles.SUPER_ADMIN)))


# --- TenantScopedQuerySetMixin ---------------------------------------------


class _Base:
    def get_queryset(self):
        return self.queryset


def view_for(user, queryset=None, **attrs):
    class View(TenantScopedQuerySetMixin, _Base):
        pass

    view = View()
    view.request = type("R", (), {"user": principal_for(user)})()
    view.queryset = queryset if queryset is not None else Student.objects.all()
    for key, value in attrs.items():
        setattr(view, key, value)
    return view


def test_a_teacher_sees_only_their_own_school(make_school, make_user, make_student):
    mine, theirs = make_school("Mine"), make_school("Theirs")
    ours, hidden = make_student(mine), make_student(theirs)
    visible = view_for(make_user(roles.TEACHER, school=mine)).get_queryset()
    ids = set(visible.values_list("id", flat=True))
    assert ours.id in ids
    assert hidden.id not in ids


def test_a_super_admin_sees_nothing_without_a_grant(make_school, make_user, make_student):
    school = make_school()
    make_student(school)
    assert not view_for(make_user(roles.SUPER_ADMIN)).get_queryset().exists()


def test_a_super_admin_sees_only_granted_schools(make_school, make_user, make_student, make_grant):
    granted, other = make_school("Granted"), make_school("Other")
    seen, unseen = make_student(granted), make_student(other)
    admin = make_user(roles.SUPER_ADMIN)
    make_grant(admin, granted)

    ids = set(view_for(admin).get_queryset().values_list("id", flat=True))
    assert seen.id in ids
    assert unseen.id not in ids
    assert granted_school_ids(principal_for(admin)) == {granted.id}


def test_a_view_may_opt_a_super_admin_into_every_tenant(make_school, make_user, make_student):
    # Only for resources the matrix marks "✔ all", such as platform-wide
    # payment history.
    a, b = make_school("A"), make_school("B")
    one, two = make_student(a), make_student(b)
    view = view_for(make_user(roles.SUPER_ADMIN), super_admin_scope=SuperAdminScope.ALL)
    ids = set(view.get_queryset().values_list("id", flat=True))
    assert {one.id, two.id} <= ids


def test_a_parent_sees_nothing_until_the_view_says_how(
    make_school, make_user, make_student, make_link
):
    school = make_school()
    parent = make_user(roles.PARENT)
    student = make_student(school)
    make_link(parent, student)
    # No parent_link_field declared: deny rather than guess.
    assert not view_for(parent).get_queryset().exists()


def test_a_parent_with_a_declared_path_sees_linked_children_only(
    make_school, make_user, make_student, make_link
):
    school = make_school()
    parent = make_user(roles.PARENT)
    mine, classmate = make_student(school, "Mine"), make_student(school, "Classmate")
    make_link(parent, mine)

    view = view_for(parent, parent_link_field="id")
    ids = set(view.get_queryset().values_list("id", flat=True))
    assert ids == {mine.id}
    # The classmate shares the school and is still invisible: a parent's reach
    # is the link, never the tenant.
    assert classmate.id not in ids


def test_a_platform_resource_is_not_tenant_filtered(make_school, make_user):
    make_school("A")
    make_school("B")
    view = view_for(make_user(roles.SUPER_ADMIN), queryset=School.objects.all(), tenant_field=None)
    assert view.get_queryset().count() >= 2


def test_a_school_scoped_user_with_no_school_sees_nothing(make_school, make_user, make_student):
    # Defensive: the database constraint should make this unreachable, but a
    # missing school must never degrade into an unfiltered query.
    school = make_school()
    make_student(school)
    teacher = make_user(roles.TEACHER, school=school)
    teacher.school = None  # not saved - the constraint would reject it
    assert not view_for(teacher).get_queryset().exists()


def test_expired_grants_are_excluded_from_the_scope(
    make_school, make_user, make_student, make_grant
):
    school = make_school()
    make_student(school)
    admin = make_user(roles.SUPER_ADMIN)
    make_grant(admin, school, hours=-1)
    assert granted_school_ids(principal_for(admin)) == set()
    assert not view_for(admin).get_queryset().exists()
