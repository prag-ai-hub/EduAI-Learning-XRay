"""Serializers for the accounts surface.

Only one thing is written through this app: a parent claiming their own profile
row. Everything else about an account - the role, the school, the credits - is
decided by a school or by the platform, and is served by the app that owns it.
"""

from __future__ import annotations

from rest_framework import serializers

from apps.common.serializers import BaseSerializer

from .models import User


class ParentSignupSerializer(BaseSerializer):
    """'Create a parent account'.

    The caller supplies their name and, optionally, a phone number. They do not
    supply an email - that comes from the verified token, never from the body,
    because the email is what an email-bound invite code is matched against.
    Letting the caller name themselves would turn a bound code into a code
    anyone could claim.

    They do not supply a role or a school either. Both are decided here: a
    parent is a Parent and has no school, which is what
    `users_role_school_scope_check` requires.
    """

    name = serializers.CharField(max_length=200, trim_whitespace=True)
    phone = serializers.CharField(max_length=32, required=False, allow_blank=True)

    # Lengths are measured after sanitisation, so a name of four zero-width
    # characters is now what it always was - empty.
    def validate_name(self, value: str) -> str:
        if len(value) < 2:
            raise serializers.ValidationError("Enter your full name.")
        return value


class ParentProfileSerializer(serializers.ModelSerializer):
    """The parent's own row, as they may see it.

    Narrow on purpose. A parent has no school, no credit balance worth
    reporting and no administrative state to inspect; this exists so the client
    can confirm which account it just created and render a name.
    """

    class Meta:
        model = User
        fields = ["id", "name", "email", "role", "phone", "status"]
        read_only_fields = fields
