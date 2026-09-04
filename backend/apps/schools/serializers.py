"""School serializers."""

from __future__ import annotations

from rest_framework import serializers

from apps.common.serializers import BaseSerializer

from .models import School


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
    """

    name = serializers.CharField(max_length=200, trim_whitespace=True)
    city = serializers.CharField(max_length=120, required=False, allow_blank=True)
    board = serializers.CharField(max_length=120, required=False, allow_blank=True)
    admin_name = serializers.CharField(max_length=200, trim_whitespace=True)
    phone = serializers.CharField(max_length=32, required=False, allow_blank=True)

    def validate_name(self, value: str) -> str:
        if len(value.strip()) < 3:
            raise serializers.ValidationError("Enter the school's full name.")
        return value.strip()

    def validate_admin_name(self, value: str) -> str:
        if len(value.strip()) < 2:
            raise serializers.ValidationError("Enter your full name.")
        return value.strip()


class SchoolDecisionSerializer(BaseSerializer):
    """Why a school was rejected, suspended or reactivated.

    A reason is required because these actions are appealable: the school is
    told what happened, and the audit trail has to show a human made a judgement
    rather than a button being clicked.
    """

    reason = serializers.CharField(max_length=500, trim_whitespace=True)

    def validate_reason(self, value: str) -> str:
        if len(value.strip()) < 10:
            raise serializers.ValidationError(
                "Give a reason of at least 10 characters - it is shown to the school."
            )
        return value.strip()
