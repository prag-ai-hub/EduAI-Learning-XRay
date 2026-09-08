"""The validation boundary for the parent portal.

Two of these are worth reading before changing.

`RedeemSerializer` deliberately validates almost nothing. Every field rule it
could carry - a length, a character class - is a distinguishable rejection, and
a distinguishable rejection is how a caller learns what a real code looks like
and which guesses were closer. The code shape is checked in one place, by the
database, and every way of getting it wrong comes back as the same
`InviteRefused`. See apps/tenants/parents/services.py.

`ChildSerializer` is a whitelist over `students`, not a projection of it. The
role matrix (§2, "Parent portal") gives a parent their own children and denies
them teacher names, class averages and other children's rows, so what a parent
may see about a child is enumerated here rather than derived from the model.
"""

from __future__ import annotations

from rest_framework import serializers

from apps.common.serializers import BaseModelSerializer, BaseSerializer
from apps.tenants.schools.models import Student

from . import services
from .models import ParentInviteCode, Relationship


class InviteCodeCreateSerializer(BaseSerializer):
    """What a Teacher or SchoolAdmin sends to invite a parent.

    `student_id` is the only thing the caller chooses about who the code is
    for, and the view checks it against their own roster. The school, the
    issuer, the code and its single use are all derived server-side: none of
    them is a decision a request body gets to make.
    """

    student_id = serializers.CharField(max_length=128)
    relationship = serializers.ChoiceField(
        choices=Relationship.choices, default=Relationship.GUARDIAN
    )
    # Optional, and the strongest control available on a bearer credential: the
    # SQL function refuses a redemption whose account holds a different address,
    # so a slip that goes astray is unusable rather than merely unlucky. Not
    # required, because a school sending a printed slip home often does not have
    # the address yet.
    email = serializers.EmailField(required=False, allow_blank=True, max_length=254)
    expires_in_days = serializers.IntegerField(
        required=False,
        min_value=1,
        max_value=services.MAX_EXPIRY_DAYS,
        default=services.DEFAULT_EXPIRY_DAYS,
    )


class InviteCodeSerializer(BaseModelSerializer):
    """An issued code, including the code itself.

    This is the one response that carries `code`. It is returned to the person
    who issued it, at the moment they issued it, and there is no endpoint that
    lists or re-reads it afterwards - a code that can be fetched again is a code
    that anyone with the issuer's capability can harvest for a whole school.
    """

    student_id = serializers.CharField(read_only=True)

    class Meta:
        model = ParentInviteCode
        fields = [
            "id",
            "code",
            "student_id",
            "relationship",
            "email",
            "max_uses",
            "used_count",
            "expires_at",
            "revoked_at",
            "created_at",
        ]
        # Only the model-backed names: DRF refuses to see a declared field here.
        read_only_fields = [f for f in fields if f != "student_id"]


class RevokedInviteCodeSerializer(BaseModelSerializer):
    """The same row after revocation, minus the code."""

    student_id = serializers.CharField(read_only=True)

    class Meta:
        model = ParentInviteCode
        fields = ["id", "student_id", "expires_at", "revoked_at", "created_at"]
        read_only_fields = [f for f in fields if f != "student_id"]


class RedeemSerializer(BaseSerializer):
    """A parent redeeming a code.

    `max_length` is generous on purpose: a real code is ten characters, and
    rejecting an eleven-character one here with a different message than the
    database gives back would separate "too long" from "wrong", which is exactly
    the distinction this endpoint refuses to make.
    """

    code = serializers.CharField(max_length=64, allow_blank=True, trim_whitespace=True)


class ChildSerializer(serializers.ModelSerializer):
    """One linked child, as their parent may see them.

    `relationship` and `linked_at` come from the annotation the view puts on the
    queryset; they belong to the link, not to the student.

    Note what is absent: no class teacher, no class average, no roster position,
    and no sibling. The matrix denies a parent all four, and the way to keep
    denying them is for this list to be the enumeration rather than a starting
    point.
    """

    class_name = serializers.SerializerMethodField()
    school_name = serializers.CharField(source="school.name", read_only=True)
    relationship = serializers.CharField(read_only=True)
    linked_at = serializers.DateTimeField(read_only=True)

    class Meta:
        model = Student
        fields = [
            "id",
            "name",
            "roll_number",
            "status",
            "class_name",
            "school_name",
            "relationship",
            "linked_at",
        ]
        # The declared fields above are already read-only; naming them here too
        # is what DRF asserts against.
        read_only_fields = ["id", "name", "roll_number", "status"]

    def get_class_name(self, student: Student) -> str | None:
        school_class = student.school_class
        if school_class is None:
            return None
        return f"Class {school_class.class_name}{school_class.section}".strip()


__all__ = [
    "ChildSerializer",
    "InviteCodeCreateSerializer",
    "InviteCodeSerializer",
    "RedeemSerializer",
    "RevokedInviteCodeSerializer",
]
