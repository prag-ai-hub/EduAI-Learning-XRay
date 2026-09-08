"""Linked children (Day 12 task 3).

Tenancy for a Parent is not `school_id` - they have none. It is
`parent_student_links`, applied by `parent_link_field` on the tenancy mixin, and
these tests are what proves the list is bounded by it rather than by anything a
view remembered to filter.
"""

import pytest

from apps.accounts.roles import PARENT, SCHOOL_ADMIN, SUPER_ADMIN, TEACHER
from apps.platform.audit.models import AuditEvent
from apps.tenants.parents.models import ParentStudentLink
from apps.tenants.parents.services import ParentAction

pytestmark = pytest.mark.django_db

CHILDREN = "/api/v1/parents/children/"


def names(response) -> list[str]:
    return [child["name"] for child in response.data["results"]]


def test_a_parent_sees_only_their_own_linked_children(
    make_school, make_user, make_student, make_link, api_client_for
):
    school = make_school()
    mine = make_student(school, name="Meera Rao")
    theirs = make_student(school, name="Arjun Nair")
    parent = make_user(PARENT)
    make_link(parent, mine)
    make_link(make_user(PARENT), theirs)

    response = api_client_for(parent).get(CHILDREN)

    assert response.status_code == 200
    assert names(response) == ["Meera Rao"]


def test_an_unlinked_parent_sees_nothing(make_school, make_user, make_student, api_client_for):
    school = make_school()
    make_student(school, name="Meera Rao")

    response = api_client_for(make_user(PARENT)).get(CHILDREN)

    assert response.status_code == 200
    assert response.data["results"] == []


def test_a_revoked_link_grants_nothing(
    make_school, make_user, make_student, make_link, api_client_for
):
    # The row survives revocation on purpose, so filtering on its existence
    # rather than its status would silently restore access.
    school = make_school()
    student = make_student(school, name="Meera Rao")
    parent = make_user(PARENT)
    make_link(parent, student, status=ParentStudentLink.Status.REVOKED)

    listed = api_client_for(parent).get(CHILDREN)
    fetched = api_client_for(parent).get(f"{CHILDREN}{student.id}/")

    assert listed.data["results"] == []
    assert fetched.status_code == 403


def test_a_parent_of_one_child_cannot_read_another_by_id(
    make_school, make_user, make_student, make_link, api_client_for
):
    school = make_school()
    parent = make_user(PARENT)
    make_link(parent, make_student(school, name="Meera Rao"))
    someone_else = make_student(school, name="Arjun Nair")

    response = api_client_for(parent).get(f"{CHILDREN}{someone_else.id}/")

    assert response.status_code == 403


def test_a_child_that_does_not_exist_answers_exactly_as_another_child_does(
    make_school, make_user, make_student, make_link, api_client_for
):
    # Otherwise the parent portal is a way to test which student ids a school
    # has issued.
    school = make_school()
    parent = make_user(PARENT)
    make_link(parent, make_student(school))
    client = api_client_for(parent)

    real = client.get(f"{CHILDREN}{make_student(school, name='Arjun Nair').id}/")
    imaginary = client.get(f"{CHILDREN}student-does-not-exist/")

    assert real.status_code == imaginary.status_code == 403
    assert real.data == imaginary.data


def test_a_parent_may_hold_children_at_more_than_one_school(
    make_school, make_user, make_student, make_link, api_client_for
):
    # A parent has no school_id, so two schools is the ordinary case rather than
    # a special one. Any rule that reached for a tenant id would break here.
    first, second = make_school("Nehru Vidyalaya"), make_school("St Xavier's")
    parent = make_user(PARENT)
    make_link(parent, make_student(first, name="Meera Rao"))
    make_link(parent, make_student(second, name="Kabir Rao"))

    response = api_client_for(parent).get(CHILDREN)

    assert sorted(names(response)) == ["Kabir Rao", "Meera Rao"]
    assert {child["school_name"] for child in response.data["results"]} == {
        "Nehru Vidyalaya",
        "St Xavier's",
    }


def test_a_child_carries_their_class_and_the_caller_s_own_relationship(
    make_school, make_class, make_user, make_student, make_link, api_client_for
):
    school = make_school()
    student = make_student(school, name="Meera Rao")
    student.school_class = make_class(school, class_name="7", section="B")
    student.save(update_fields=["school_class"])
    parent = make_user(PARENT)
    make_link(parent, student)

    child = api_client_for(parent).get(CHILDREN).data["results"][0]

    assert child["class_name"] == "Class 7B"
    assert child["relationship"] == "Mother"
    assert child["linked_at"] is not None
    # Matrix §2, "Parent portal": no teacher names, no class averages, no
    # rankings, no siblings.
    assert set(child) == {
        "id",
        "name",
        "roll_number",
        "status",
        "class_name",
        "school_name",
        "relationship",
        "linked_at",
    }


@pytest.mark.parametrize("role", [TEACHER, SCHOOL_ADMIN, SUPER_ADMIN])
def test_no_one_but_a_parent_may_list_children(make_school, make_user, api_client_for, role):
    school = make_school()
    caller = make_user(role, school=school if role in (TEACHER, SCHOOL_ADMIN) else None)

    assert api_client_for(caller).get(CHILDREN).status_code == 403


# --- unlinking --------------------------------------------------------------


def test_a_parent_may_unlink_themselves(
    make_school, make_user, make_student, make_link, api_client_for
):
    school = make_school()
    student = make_student(school, name="Meera Rao")
    parent = make_user(PARENT)
    link = make_link(parent, student)
    client = api_client_for(parent)

    response = client.post(f"{CHILDREN}{student.id}/unlink/", format="json")

    assert response.status_code == 204
    link.refresh_from_db()
    assert link.status == ParentStudentLink.Status.REVOKED
    assert link.revoked_by_id == parent.id
    assert client.get(CHILDREN).data["results"] == []
    assert AuditEvent.objects.filter(action=ParentAction.LINK_REVOKED).exists()


def test_a_parent_cannot_unlink_someone_else_s_child(
    make_school, make_user, make_student, make_link, api_client_for
):
    school = make_school()
    student = make_student(school, name="Arjun Nair")
    other_parent = make_user(PARENT)
    link = make_link(other_parent, student)
    intruder = make_user(PARENT)
    make_link(intruder, make_student(school, name="Meera Rao"))

    response = api_client_for(intruder).post(f"{CHILDREN}{student.id}/unlink/", format="json")

    assert response.status_code == 403
    link.refresh_from_db()
    assert link.status == ParentStudentLink.Status.ACTIVE
