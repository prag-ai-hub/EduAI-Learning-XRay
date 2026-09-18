"""School serializers: the school itself, and the roster it manages."""

from __future__ import annotations

import re
from datetime import date

from django.utils import timezone
from rest_framework import serializers

from apps.accounts.roles import TEACHER
from apps.common.serializers import BaseSerializer

from .models import School, SchoolClass, Student


class SchoolSerializer(serializers.ModelSerializer):
    """Directory representation. Read-only: status changes go through the
    lifecycle actions, never a PATCH, so every transition is validated and
    audited."""

    # Annotated by the directory queryset. Absent on the single-object views,
    # where a count would cost a query nobody asked for - hence required=False.
    user_count = serializers.IntegerField(read_only=True, required=False)
    student_count = serializers.IntegerField(read_only=True, required=False)

    class Meta:
        model = School
        fields = [
            "id",
            "name",
            "city",
            "board",
            "status",
            "created_at",
            "approved_at",
            "approved_by",
            "suspended_at",
            "user_count",
            "student_count",
        ]
        # Only the model-backed fields: DRF rejects naming a declared field here.
        read_only_fields = [f for f in fields if not f.endswith("_count")]


class SchoolRegistrationSerializer(BaseSerializer):
    """'Register your school'.

    The caller supplies the school and their own administrator details. They do
    not choose a status - a new school is always Pending - and they do not
    choose a role.

    Nothing here is exempt from sanitisation, and `name` is the reason the base
    class does it. This value ends up in three places a raw string must not
    reach: an email subject line, the Super Admin approval screen, and a
    Postgres TEXT column.
    """

    name = serializers.CharField(max_length=200, trim_whitespace=True)
    city = serializers.CharField(max_length=120, required=False, allow_blank=True)
    board = serializers.CharField(max_length=120, required=False, allow_blank=True)
    admin_name = serializers.CharField(max_length=200, trim_whitespace=True)
    phone = serializers.CharField(max_length=32, required=False, allow_blank=True)

    # Lengths are measured after sanitisation, so a name of four zero-width
    # characters is now what it always was - empty.
    def validate_name(self, value: str) -> str:
        if len(value) < 3:
            raise serializers.ValidationError("Enter the school's full name.")
        return value

    def validate_admin_name(self, value: str) -> str:
        if len(value) < 2:
            raise serializers.ValidationError("Enter your full name.")
        return value


class SchoolProfileSerializer(BaseSerializer):
    """What a school may change about itself.

    Name, city and board - the three a school office corrects. `status` is
    absent on purpose and cannot be added here: the lifecycle is a state machine
    driven by approval decisions (see `SchoolDirectoryViewSet`), and a school
    that could PATCH its own status could approve itself.
    """

    name = serializers.CharField(max_length=200, required=False)
    city = serializers.CharField(max_length=120, required=False, allow_blank=True)
    board = serializers.CharField(max_length=120, required=False, allow_blank=True)

    def validate_name(self, value: str) -> str:
        if len(value.strip()) < 3:
            raise serializers.ValidationError("Enter the school's full name.")
        return value.strip()


class SchoolDecisionSerializer(BaseSerializer):
    """Why a school was rejected, suspended or reactivated.

    A reason is required because these actions are appealable: the school is
    told what happened, and the audit trail has to show a human made a judgement
    rather than a button being clicked.
    """

    # A reason is typed into a textarea and rendered into the body of an email,
    # never into a header, so paragraph breaks are content here.
    MULTILINE_FIELDS = ("reason",)

    reason = serializers.CharField(max_length=500, trim_whitespace=True)

    def validate_reason(self, value: str) -> str:
        if len(value) < 10:
            raise serializers.ValidationError(
                "Give a reason of at least 10 characters - it is shown to the school."
            )
        return value


# ---------------------------------------------------------------------------
# The roster: classes and the students on them (plan row 17.4)
# ---------------------------------------------------------------------------

#: `classes_class_name_check` in SQL. Stated here too so a school is told what
#: is wrong at the boundary rather than by an IntegrityError.
CLASS_NAME = re.compile(r"^([1-9]|1[0-2])$")

#: "2026-27". The column is free text; this is the shape the product writes.
ACADEMIC_YEAR = re.compile(r"^\d{4}-\d{2}$")


def current_academic_year(today: date | None = None) -> str:
    """The Indian school year containing `today`, as "2026-27".

    It turns over in June, which is when Indian schools start one. A class
    created in March belongs to the year that began the previous June.
    """
    today = today or timezone.localdate()
    start = today.year if today.month >= 6 else today.year - 1
    return f"{start}-{str(start + 1)[-2:]}"


class SchoolClassSerializer(serializers.ModelSerializer):
    """One teaching unit: a class, its section, and the subject taught to it.

    Subject is part of the identity, not a label on it. "6C Mathematics" and
    "6C Science" are two rows because an assessment attaches to one of them, and
    `classes_identity_key` (M19) enforces that pairing is unique per year.

    `teacher` is validated against the caller's own school. Without that check a
    school administrator could name any user id in the product and quietly
    attach another school's teacher to their class - the id is the only thing
    the request carries, and nothing downstream would question it.
    """

    teacher_name = serializers.CharField(source="teacher.name", read_only=True, default=None)
    #: Annotated by the list queryset. `default` matters on create and update,
    #: where there is no annotation and a client would otherwise read undefined.
    student_count = serializers.IntegerField(read_only=True, default=0)
    label = serializers.SerializerMethodField()

    class Meta:
        model = SchoolClass
        fields = [
            "id",
            "academic_year",
            "class_name",
            "section",
            "subject",
            "teacher",
            "teacher_name",
            "student_count",
            "label",
        ]
        read_only_fields = ["id"]
        extra_kwargs = {"teacher": {"required": False, "allow_null": True}}

    def get_label(self, instance: SchoolClass) -> str:
        return f"Class {instance.class_name}{instance.section} · {instance.subject}"

    def validate_class_name(self, value: str) -> str:
        value = value.strip()
        if not CLASS_NAME.match(value):
            raise serializers.ValidationError("Use a class from 1 to 12.")
        return value

    def validate_section(self, value: str) -> str:
        value = value.strip().upper()
        if not value or len(value) > 4:
            raise serializers.ValidationError("Use a short section, such as A.")
        return value

    def validate_subject(self, value: str) -> str:
        value = value.strip()
        if len(value) < 2:
            raise serializers.ValidationError("Name the subject.")
        return value

    def validate_academic_year(self, value: str) -> str:
        value = value.strip()
        if not ACADEMIC_YEAR.match(value):
            raise serializers.ValidationError("Use the form 2026-27.")
        return value

    def validate_teacher(self, teacher):
        """A teacher of this school, or nobody."""
        if teacher is None:
            return None
        school_id = self.context["school_id"]
        if str(teacher.school_id) != str(school_id):
            # The same answer as a teacher who does not exist: naming an id from
            # another school must not confirm that it is real.
            raise serializers.ValidationError("No such teacher at this school.")
        if teacher.role != TEACHER:
            raise serializers.ValidationError("Only a teacher can be assigned to a class.")
        return teacher


class StudentSerializer(serializers.ModelSerializer):
    """A child on a school's roster.

    `school_class` is optional because a school imports its roster before it has
    finished setting up its classes, and a student with no class is a student
    the product can still show. It is validated against the caller's school for
    the same reason `teacher` is.

    `status` is Active or Inactive, and a student is never deleted through this
    API - see the viewset for why.
    """

    class_label = serializers.SerializerMethodField()

    class Meta:
        model = Student
        fields = ["id", "name", "roll_number", "status", "school_class", "class_label"]
        read_only_fields = ["id"]
        extra_kwargs = {
            "school_class": {"required": False, "allow_null": True},
            "roll_number": {"required": False, "allow_blank": True, "allow_null": True},
            # A default, not just "not required": absent means Active, and the
            # column is constrained to Active/Inactive (M19), so letting it fall
            # through to the model's empty string is a check violation.
            "status": {"required": False, "default": Student.ACTIVE},
        }

    def get_class_label(self, instance: Student) -> str | None:
        school_class = instance.school_class
        if school_class is None:
            return None
        return f"Class {school_class.class_name}{school_class.section} · {school_class.subject}"

    def validate_name(self, value: str) -> str:
        value = value.strip()
        if len(value) < 2:
            raise serializers.ValidationError("Enter the student's full name.")
        return value

    def validate_roll_number(self, value):
        return (value or "").strip() or None

    def validate_status(self, value: str) -> str:
        value = (value or "").strip() or Student.ACTIVE
        if value not in (Student.ACTIVE, Student.INACTIVE):
            raise serializers.ValidationError("A student is Active or Inactive.")
        return value

    def validate_school_class(self, school_class):
        if school_class is None:
            return None
        if str(school_class.school_id) != str(self.context["school_id"]):
            raise serializers.ValidationError("No such class at this school.")
        return school_class


class RosterRowSerializer(BaseSerializer):
    """One line of an imported roster.

    The class is named the way a spreadsheet names it - "6C" - because that is
    what a school office types. Resolving it to a `classes` row is the
    importer's job, and it refuses rather than guesses when "6C" matches more
    than one subject.
    """

    name = serializers.CharField(max_length=200)
    roll_number = serializers.CharField(
        max_length=40, required=False, allow_blank=True, allow_null=True
    )
    class_label = serializers.CharField(
        max_length=40, required=False, allow_blank=True, allow_null=True
    )


class RosterImportSerializer(BaseSerializer):
    """A whole roster, imported in one request.

    Bounded at 500 rows: a request that takes a minute to validate is one a
    proxy will cut in half, and a school with more students imports per class.
    """

    MAX_ROWS = 500

    rows = serializers.ListField(child=RosterRowSerializer(), allow_empty=False)

    def validate_rows(self, rows):
        if len(rows) > self.MAX_ROWS:
            raise serializers.ValidationError(
                f"Import at most {self.MAX_ROWS} rows at a time; this file has {len(rows)}."
            )
        return rows
