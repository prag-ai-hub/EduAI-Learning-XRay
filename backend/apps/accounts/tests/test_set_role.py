"""`manage.py set_role` - how the first Super Admin is made.

There is no Django admin site here and `createsuperuser` writes a row nothing
reads, so this command is the mechanism. What it mostly does is refuse: the
schema's `users_role_school_scope_check` requires exactly SchoolAdmin and
Teacher to carry a school, and a role change is the most privileged edit in the
product, so it is audited.
"""

from __future__ import annotations

from io import StringIO

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError

from apps.accounts.roles import PARENT, SCHOOL_ADMIN, SUPER_ADMIN, TEACHER
from apps.platform.audit.models import AuditEvent
from apps.platform.audit.services import Action

pytestmark = pytest.mark.django_db


def run(*args, **options) -> str:
    out = StringIO()
    call_command("set_role", *args, stdout=out, stderr=out, **options)
    return out.getvalue()


def test_a_teacher_can_be_promoted_to_super_admin(make_school, make_user):
    """The real case: the first Super Admin is an ordinary account until
    somebody runs this."""
    user = make_user(TEACHER, school=make_school())

    run(user.email, SUPER_ADMIN)

    user.refresh_from_db()
    assert user.role == SUPER_ADMIN
    # `users_role_school_scope_check`: a SuperAdmin carries no school, so the
    # promotion drops it rather than leaving a row the database would refuse.
    assert user.school_id is None


def test_the_change_is_audited(make_school, make_user):
    user = make_user(TEACHER, school=make_school())

    run(user.email, SUPER_ADMIN)

    event = AuditEvent.objects.get(action=Action.ACCOUNT_ROLE_CHANGED, entity_id=str(user.id))
    assert event.detail_json["from"] == TEACHER
    assert event.detail_json["to"] == SUPER_ADMIN
    assert event.detail_json["via"] == "manage.py set_role"


def test_a_school_scoped_role_needs_a_school(make_user):
    user = make_user(SUPER_ADMIN)

    with pytest.raises(CommandError) as refused:
        run(user.email, TEACHER)

    assert "--school" in str(refused.value)
    user.refresh_from_db()
    assert user.role == SUPER_ADMIN


def test_a_school_that_does_not_exist_is_refused(make_school, make_user):
    user = make_user(TEACHER, school=make_school())

    with pytest.raises(CommandError) as refused:
        run(user.email, TEACHER, school="school-does-not-exist")

    assert "No school with id" in str(refused.value)


@pytest.mark.parametrize("role", [SUPER_ADMIN, PARENT])
def test_a_school_free_role_refuses_a_school(role, make_school, make_user):
    """The other half of the same constraint."""
    user = make_user(TEACHER, school=make_school())

    with pytest.raises(CommandError) as refused:
        run(user.email, role, school=user.school_id)

    assert "belongs to no school" in str(refused.value)


def test_moving_a_teacher_between_schools(make_school, make_user):
    user = make_user(TEACHER, school=make_school())
    destination = make_school(name="Destination School")

    run(user.email, TEACHER, school=destination.id)

    user.refresh_from_db()
    assert user.school_id == destination.id


def test_a_dry_run_writes_nothing(make_school, make_user):
    user = make_user(TEACHER, school=make_school())

    output = run(user.email, SUPER_ADMIN, dry_run=True)

    assert "Dry run" in output
    user.refresh_from_db()
    assert user.role == TEACHER
    assert not AuditEvent.objects.filter(action=Action.ACCOUNT_ROLE_CHANGED).exists()


def test_setting_the_role_somebody_already_has_is_a_no_op(make_user):
    user = make_user(SUPER_ADMIN)

    output = run(user.email, SUPER_ADMIN)

    assert "already" in output
    assert not AuditEvent.objects.filter(action=Action.ACCOUNT_ROLE_CHANGED).exists()


def test_promoting_someone_warns_about_what_a_super_admin_can_do(make_school, make_user):
    user = make_user(SCHOOL_ADMIN, school=make_school())

    output = run(user.email, SUPER_ADMIN)

    assert "support grant" in output


def test_changing_a_parents_role_says_their_child_links_are_untouched(make_school, make_user):
    """`parent_student_links` is not touched here. A stale link is a
    safeguarding matter for the school to revoke, not a tidy-up for a command
    line to do silently."""
    user = make_user(PARENT)

    output = run(user.email, TEACHER, school=make_school().id)

    assert "parent_student_links" in output


# --- the bootstrap case -----------------------------------------------------


def test_the_first_super_admin_is_made_from_an_account_with_no_profile(make_auth_user):
    """The case the command existed for and could not do.

    A Super Admin has no school, and school registration is the only thing that
    creates a profile row - so the first one signs up, has an identity and no
    profile, and nothing could give them a role.
    """
    from apps.accounts.models import User

    make_auth_user("founder@eduaihub.test")

    output = run("founder@eduaihub.test", SUPER_ADMIN, name="A. Founder")

    assert "no profile yet" in output
    profile = User.objects.get(email="founder@eduaihub.test")
    assert profile.role == SUPER_ADMIN
    assert profile.school_id is None
    assert profile.name == "A. Founder"
    assert profile.total_credits == 0


def test_the_created_profile_is_audited_as_created(make_auth_user):
    make_auth_user("founder2@eduaihub.test")

    run("founder2@eduaihub.test", SUPER_ADMIN)

    event = AuditEvent.objects.get(action=Action.ACCOUNT_ROLE_CHANGED)
    assert event.detail_json["created"] is True
    assert event.detail_json["from"] is None


def test_the_name_defaults_to_the_local_part(make_auth_user):
    from apps.accounts.models import User

    make_auth_user("ops.lead@eduaihub.test")

    run("ops.lead@eduaihub.test", SUPER_ADMIN)

    assert User.objects.get(email="ops.lead@eduaihub.test").name == "ops.lead"


def test_an_address_that_never_signed_up_is_still_refused():
    """Django cannot create the identity - only Supabase can."""
    with pytest.raises(CommandError) as refused:
        run("stranger@example.test", SUPER_ADMIN)

    assert "sign up through the product first" in str(refused.value)


def test_a_dry_run_creates_no_profile(make_auth_user):
    from apps.accounts.models import User

    make_auth_user("founder3@eduaihub.test")

    run("founder3@eduaihub.test", SUPER_ADMIN, dry_run=True)

    assert not User.objects.filter(email="founder3@eduaihub.test").exists()
