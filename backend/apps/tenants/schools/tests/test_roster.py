"""Managing a school's classes and students.

Plan row 17.4. Until this API existed the admin screens wrote their classes and
students into the workspace JSON blob, so nothing a school "created" was a row
any other part of the product could see - an assessment could not attach to it,
a parent invite could not name it.

What these tests pin is mostly refusal. The roster is the one surface where a
school types identifiers of its own (`teacher`, `class`) into a request, and an
id is the only thing the request carries: without a check, naming another
school's teacher or class silently attaches it.
"""

from __future__ import annotations

import pytest

from apps.accounts.roles import PARENT, SCHOOL_ADMIN, SUPER_ADMIN, TEACHER
from apps.tenants.schools.models import School, SchoolClass, Student

pytestmark = pytest.mark.django_db

CLASSES = "/api/v1/schools/classes/"
STUDENTS = "/api/v1/schools/students/"
IMPORT = "/api/v1/schools/students/import/"

CLASS_BODY = {"class_name": "6", "section": "c", "subject": "Mathematics"}


@pytest.fixture
def admin_of(make_school, make_user, api_client_for):
    """A school, its administrator, and a client for them."""

    def _make(status=None):
        school = make_school(status=status or School.Status.ACTIVE)
        user = make_user(SCHOOL_ADMIN, school=school)
        return school, api_client_for(user)

    return _make


# --- creating a class -------------------------------------------------------


def test_a_school_admin_creates_a_class(admin_of):
    school, client = admin_of()

    response = client.post(CLASSES, CLASS_BODY, format="json")

    assert response.status_code == 201
    body = response.json()
    # Sections are stored upper-case, so "6c" and "6C" are one class.
    assert (body["class_name"], body["section"], body["subject"]) == ("6", "C", "Mathematics")
    assert body["label"] == "Class 6C · Mathematics"
    created = SchoolClass.objects.get(pk=body["id"])
    assert created.school_id == school.id


def test_the_academic_year_defaults_to_the_current_one(admin_of):
    """A school office adding a class mid-term does not think about the year,
    and the year is part of the class's identity."""
    from apps.tenants.schools.serializers import current_academic_year

    _, client = admin_of()

    response = client.post(CLASSES, CLASS_BODY, format="json")

    assert response.json()["academic_year"] == current_academic_year()


def test_a_teacher_may_create_the_class_they_are_about_to_assess(
    make_school, make_user, api_client_for
):
    """Held by Teacher as well as SchoolAdmin, deliberately: routing the first
    step through an administrator would mean it needs two people."""
    school = make_school()
    client = api_client_for(make_user(TEACHER, school=school))

    assert client.post(CLASSES, CLASS_BODY, format="json").status_code == 201


def test_a_parent_has_no_business_in_a_roster(make_user, api_client_for):
    client = api_client_for(make_user(PARENT))

    assert client.get(CLASSES).status_code == 403
    assert client.post(CLASSES, CLASS_BODY, format="json").status_code == 403


@pytest.mark.parametrize(
    "field,value", [("class_name", "13"), ("class_name", "0"), ("section", ""), ("subject", "x")]
)
def test_a_class_outside_the_schema_is_refused_at_the_boundary(field, value, admin_of):
    """`classes_class_name_check` is in SQL; saying so here means the school is
    told what is wrong instead of meeting an IntegrityError."""
    _, client = admin_of()

    response = client.post(CLASSES, {**CLASS_BODY, field: value}, format="json")

    assert response.status_code == 400


def test_the_same_class_and_subject_cannot_be_created_twice(admin_of):
    """`classes_identity_key` (M19). The message has to be readable, because a
    double-clicked save is the ordinary way to reach it."""
    school, client = admin_of()
    client.post(CLASSES, CLASS_BODY, format="json")

    repeat = client.post(CLASSES, CLASS_BODY, format="json")

    assert repeat.status_code == 400
    assert "already exists" in str(repeat.json()).lower()
    assert SchoolClass.objects.filter(school_id=school.id).count() == 1


def test_the_same_class_with_another_subject_is_a_different_class(admin_of):
    """Subject is part of the identity: 6C Maths and 6C Science are two
    teaching units with different evidence."""
    school, client = admin_of()
    client.post(CLASSES, CLASS_BODY, format="json")

    other = client.post(CLASSES, {**CLASS_BODY, "subject": "Science"}, format="json")

    assert other.status_code == 201
    assert SchoolClass.objects.filter(school_id=school.id).count() == 2


# --- the identifiers a caller supplies --------------------------------------


def test_a_teacher_from_another_school_cannot_be_assigned(admin_of, make_school, make_user):
    """The security case for this endpoint. The request carries an id and
    nothing else; unchecked, it attaches a stranger to the class."""
    school, client = admin_of()
    outsider = make_user(TEACHER, school=make_school(name="Another School"))

    response = client.post(CLASSES, {**CLASS_BODY, "teacher": str(outsider.id)}, format="json")

    assert response.status_code == 400
    # The same answer as a teacher who does not exist: naming an id from another
    # school must not confirm that it is real.
    assert "no such teacher" in str(response.json()).lower()
    assert not SchoolClass.objects.filter(school_id=school.id).exists()


def test_a_school_admin_cannot_be_assigned_to_teach(admin_of, make_school, make_user):
    school, client = admin_of()
    colleague = make_user(SCHOOL_ADMIN, school=school)

    response = client.post(CLASSES, {**CLASS_BODY, "teacher": str(colleague.id)}, format="json")

    assert response.status_code == 400


def test_a_teacher_of_this_school_is_accepted(admin_of, make_user):
    school, client = admin_of()
    teacher = make_user(TEACHER, school=school)

    response = client.post(CLASSES, {**CLASS_BODY, "teacher": str(teacher.id)}, format="json")

    assert response.status_code == 201
    assert response.json()["teacher_name"] == teacher.name


def test_the_school_on_the_row_is_the_callers_own(admin_of, make_school):
    """A `school` in the body is ignored, not trusted."""
    school, client = admin_of()
    victim = make_school(name="Victim School")

    response = client.post(CLASSES, {**CLASS_BODY, "school": victim.id}, format="json")

    assert response.status_code == 201
    assert SchoolClass.objects.get(pk=response.json()["id"]).school_id == school.id


# --- tenancy ----------------------------------------------------------------


def test_one_school_never_sees_another_schools_classes(
    admin_of, make_school, make_user, api_client_for
):
    first_school, first = admin_of()
    first.post(CLASSES, CLASS_BODY, format="json")
    second_school = make_school(name="Second School")
    second = api_client_for(make_user(SCHOOL_ADMIN, school=second_school))

    assert second.get(CLASSES).json()["results"] == []
    assert len(first.get(CLASSES).json()["results"]) == 1


def test_another_schools_class_cannot_be_edited_by_id(
    admin_of, make_school, make_user, api_client_for
):
    _, first = admin_of()
    theirs = first.post(CLASSES, CLASS_BODY, format="json").json()["id"]
    outsider = api_client_for(make_user(SCHOOL_ADMIN, school=make_school(name="Second")))

    response = outsider.patch(f"{CLASSES}{theirs}/", {"subject": "Hijacked"}, format="json")

    assert response.status_code == 404
    assert SchoolClass.objects.get(pk=theirs).subject == "Mathematics"


def test_a_super_admin_must_name_a_school_and_hold_a_grant(make_user, api_client_for):
    """Matrix §4: no implicit cross-tenant reach, and the read is audited."""
    client = api_client_for(make_user(SUPER_ADMIN))

    assert client.get(CLASSES).status_code == 400  # which school?
    assert client.get(f"{CLASSES}?school=school-nobody-granted").status_code == 403


# --- the school lifecycle ---------------------------------------------------


@pytest.mark.parametrize("status", [School.Status.PENDING, School.Status.SUSPENDED])
def test_a_school_that_is_not_active_cannot_change_its_roster(status, admin_of):
    """Matrix §5: reads stay open, writes are refused."""
    _, client = admin_of(status=status)

    assert client.post(CLASSES, CLASS_BODY, format="json").status_code == 403
    assert client.get(CLASSES).status_code == 200


# --- students ---------------------------------------------------------------


def test_a_student_is_added_to_the_roster(admin_of):
    _, client = admin_of()

    response = client.post(STUDENTS, {"name": "Meera Rao", "roll_number": "7B-14"}, format="json")

    assert response.status_code == 201
    assert response.json()["status"] == Student.ACTIVE


def test_a_student_can_be_attached_to_a_class(admin_of):
    _, client = admin_of()
    school_class = client.post(CLASSES, CLASS_BODY, format="json").json()

    response = client.post(
        STUDENTS, {"name": "Meera Rao", "school_class": school_class["id"]}, format="json"
    )

    assert response.status_code == 201
    assert response.json()["class_label"] == "Class 6C · Mathematics"


def test_a_class_from_another_school_cannot_be_named(
    admin_of, make_school, make_user, api_client_for
):
    _, first = admin_of()
    theirs = first.post(CLASSES, CLASS_BODY, format="json").json()["id"]
    second = api_client_for(make_user(SCHOOL_ADMIN, school=make_school(name="Second")))

    response = second.post(STUDENTS, {"name": "Intruder", "school_class": theirs}, format="json")

    assert response.status_code == 400
    assert "no such class" in str(response.json()).lower()


def test_two_students_cannot_share_a_roll_number(admin_of):
    """`students_roll_number_key` (M19)."""
    _, client = admin_of()
    client.post(STUDENTS, {"name": "First", "roll_number": "7B-14"}, format="json")

    clash = client.post(STUDENTS, {"name": "Second", "roll_number": "7B-14"}, format="json")

    assert clash.status_code == 400
    assert "roll number" in str(clash.json()).lower()


def test_students_without_roll_numbers_do_not_collide(admin_of):
    """The index is partial: a school that issues no roll numbers still has
    students, and two blanks are not a duplicate."""
    _, client = admin_of()

    first = client.post(STUDENTS, {"name": "First"}, format="json")
    second = client.post(STUDENTS, {"name": "Second", "roll_number": ""}, format="json")

    assert (first.status_code, second.status_code) == (201, 201)


def test_removing_a_student_marks_them_inactive_rather_than_deleting(admin_of):
    """Grade results, parent links and audit rows point at this id. Deleting it
    would strand a parent's reports."""
    _, client = admin_of()
    student = client.post(STUDENTS, {"name": "Meera Rao"}, format="json").json()

    response = client.delete(f"{STUDENTS}{student['id']}/")

    assert response.status_code == 200
    assert Student.objects.get(pk=student["id"]).status == Student.INACTIVE


def test_the_roster_can_be_filtered_by_class(admin_of):
    _, client = admin_of()
    maths = client.post(CLASSES, CLASS_BODY, format="json").json()
    science = client.post(CLASSES, {**CLASS_BODY, "subject": "Science"}, format="json").json()
    client.post(STUDENTS, {"name": "In Maths", "school_class": maths["id"]}, format="json")
    client.post(STUDENTS, {"name": "In Science", "school_class": science["id"]}, format="json")

    names = [row["name"] for row in client.get(f"{STUDENTS}?class={maths['id']}").json()["results"]]

    assert names == ["In Maths"]


# --- deleting a class -------------------------------------------------------


def test_a_class_with_students_is_not_deleted_from_under_them(admin_of):
    _, client = admin_of()
    school_class = client.post(CLASSES, CLASS_BODY, format="json").json()
    client.post(STUDENTS, {"name": "Meera Rao", "school_class": school_class["id"]}, format="json")

    response = client.delete(f"{CLASSES}{school_class['id']}/")

    assert response.status_code == 400
    assert "move them" in str(response.json()).lower()
    assert SchoolClass.objects.filter(pk=school_class["id"]).exists()


def test_an_empty_class_can_be_deleted(admin_of):
    school, client = admin_of()
    school_class = client.post(CLASSES, CLASS_BODY, format="json").json()

    assert client.delete(f"{CLASSES}{school_class['id']}/").status_code == 204
    assert not SchoolClass.objects.filter(school_id=school.id).exists()


# --- importing a roster -----------------------------------------------------


def test_a_roster_is_imported_in_one_request(admin_of):
    school, client = admin_of()
    client.post(CLASSES, CLASS_BODY, format="json")

    response = client.post(
        IMPORT,
        {
            "rows": [
                {"name": "Meera Rao", "roll_number": "1", "class_label": "6C"},
                {"name": "Arjun Nair", "roll_number": "2", "class_label": "6-c"},
            ]
        },
        format="json",
    )

    assert response.status_code == 201
    assert response.json() == {"created": 2, "updated": 0, "total": 2}
    # "6-c" and "6C" are the same class: a spreadsheet writes it either way.
    assert Student.objects.filter(school_id=school.id, school_class__isnull=False).count() == 2


def test_re_importing_a_corrected_file_updates_rather_than_duplicates(admin_of):
    """Fixing a typo and importing again is how a school office works. It must
    not produce a second child."""
    school, client = admin_of()
    client.post(IMPORT, {"rows": [{"name": "Mera Rao", "roll_number": "1"}]}, format="json")

    response = client.post(
        IMPORT, {"rows": [{"name": "Meera Rao", "roll_number": "1"}]}, format="json"
    )

    assert response.json() == {"created": 0, "updated": 1, "total": 1}
    roster = Student.objects.filter(school_id=school.id)
    assert roster.count() == 1
    assert roster.get().name == "Meera Rao"


def test_an_unknown_class_names_the_row_and_imports_nothing(admin_of):
    """One transaction: a bad row on line two leaves no half-imported roster."""
    school, client = admin_of()

    response = client.post(
        IMPORT,
        {
            "rows": [
                {"name": "Meera Rao", "roll_number": "1"},
                {"name": "Arjun Nair", "roll_number": "2", "class_label": "9Z"},
            ]
        },
        format="json",
    )

    assert response.status_code == 400
    assert "9Z" in str(response.json())
    assert "row" in str(response.json()).lower()
    assert not Student.objects.filter(school_id=school.id).exists()


def test_an_ambiguous_class_label_is_refused_rather_than_guessed(admin_of):
    """ "6C" is three rows when 6C is taught three subjects. Attaching the child
    to whichever sorted first would be a silent wrong answer."""
    school, client = admin_of()
    client.post(CLASSES, CLASS_BODY, format="json")
    client.post(CLASSES, {**CLASS_BODY, "subject": "Science"}, format="json")

    response = client.post(
        IMPORT, {"rows": [{"name": "Meera Rao", "class_label": "6C"}]}, format="json"
    )

    assert response.status_code == 400
    detail = str(response.json())
    assert "Mathematics" in detail and "Science" in detail
    assert not Student.objects.filter(school_id=school.id).exists()


def test_an_import_is_bounded(admin_of):
    _, client = admin_of()

    response = client.post(
        IMPORT, {"rows": [{"name": f"Student {n}"} for n in range(501)]}, format="json"
    )

    assert response.status_code == 400
    assert "500" in str(response.json())


def test_a_pending_school_cannot_import_a_roster(admin_of):
    _, client = admin_of(status=School.Status.PENDING)

    assert client.post(IMPORT, {"rows": [{"name": "Meera Rao"}]}, format="json").status_code == 403


def test_a_created_class_reports_a_student_count(admin_of):
    """`student_count` is annotated on the list query and absent on create, so a
    client reading it straight after creating a class would get undefined."""
    _, client = admin_of()

    response = client.post(CLASSES, CLASS_BODY, format="json")

    assert response.json()["student_count"] == 0


def test_two_schools_may_use_the_same_roll_number(admin_of, make_school, make_user, api_client_for):
    """The index is scoped to the school (M19). Every school numbers from 1, and
    a global constraint would make the second school to open unable to enrol."""
    _, first = admin_of()
    second = api_client_for(make_user(SCHOOL_ADMIN, school=make_school(name="Second School")))

    mine = first.post(STUDENTS, {"name": "Ours", "roll_number": "1"}, format="json")
    theirs = second.post(STUDENTS, {"name": "Theirs", "roll_number": "1"}, format="json")

    assert (mine.status_code, theirs.status_code) == (201, 201)


# --- the school's own profile -----------------------------------------------

MINE = "/api/v1/schools/mine"


def test_a_school_admin_corrects_their_school_details(admin_of):
    school, client = admin_of()

    response = client.patch(MINE, {"name": "Nehru Vidyalaya", "city": "Pune"}, format="json")

    assert response.status_code == 200
    school.refresh_from_db()
    assert (school.name, school.city) == ("Nehru Vidyalaya", "Pune")


def test_the_edit_is_audited(admin_of):
    from apps.platform.audit.models import AuditEvent
    from apps.platform.audit.services import Action

    school, client = admin_of()

    client.patch(MINE, {"name": "Renamed School"}, format="json")

    event = AuditEvent.objects.get(action=Action.SCHOOL_PROFILE_UPDATED, school_id=school.id)
    # The fields that changed, not the values: every administrator can read this.
    assert event.detail_json == {"fields": ["name"]}


def test_a_school_cannot_approve_itself_through_its_own_profile(admin_of):
    """`status` is not a field on the profile serializer, and the strict base
    refuses unknown keys - so this is a 400, not a silently ignored key."""
    school, client = admin_of(status=School.Status.ACTIVE)

    response = client.patch(MINE, {"status": School.Status.ACTIVE, "name": "X"}, format="json")

    assert response.status_code == 400
    assert "status" in str(response.json()).lower()


def test_a_teacher_cannot_rename_the_school(make_school, make_user, api_client_for):
    """Matrix: "Edit school profile / branding" is the SchoolAdmin's."""
    school = make_school(name="Unchanged")
    client = api_client_for(make_user(TEACHER, school=school))

    assert client.patch(MINE, {"name": "Teacher's Rename"}, format="json").status_code == 403
    school.refresh_from_db()
    assert school.name == "Unchanged"


def test_every_member_may_still_read_their_own_school(make_school, make_user, api_client_for):
    """Reading is not gated: "where does my registration stand" is a question
    every member of a school may ask."""
    school = make_school()
    client = api_client_for(make_user(TEACHER, school=school))

    response = client.get(MINE)

    assert response.status_code == 200
    assert response.json()["school"]["id"] == school.id


def test_a_pending_school_cannot_edit_its_own_profile(admin_of):
    """Matrix §5 again: reads stay open, writes are refused."""
    _, client = admin_of(status=School.Status.PENDING)

    assert client.patch(MINE, {"name": "Renamed"}, format="json").status_code == 403
    assert client.get(MINE).status_code == 200
