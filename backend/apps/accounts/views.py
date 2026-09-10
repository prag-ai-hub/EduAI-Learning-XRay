"""Parent self-sign-up - the one account a person creates for themselves.

Every other profile row in this product is created by someone with authority
over it. A SchoolAdmin's row is created alongside the school they registered; a
Teacher's is created by the invitation a SchoolAdmin sent. A Parent has neither:
the role matrix records their provisioning as "Self sign-up + invite code"
(docs/plan/01-ROLE-PERMISSION-MATRIX.md), because no school knows a parent's
email address until that parent tells them, and a school that had to enrol every
parent by hand would simply not do it.

So this endpoint exists, and the two halves of that matrix line are two separate
calls:

    POST /api/v1/accounts/parents        creates the profile - this file
    POST /api/v1/parents/links/redeem    links a child - apps/tenants/parents

Kept apart deliberately. Redemption is the security-critical half: it is
throttled per account, audited to the issuing school, and answers every refusal
identically so a code cannot be used as an oracle. Folding it in here would give
it a second entry point with a second throttle bucket, which is precisely the
bound it exists to hold. A parent linking a second child months later takes the
redemption path alone, so it has to work on its own regardless.

What the profile row is worth without a link is nothing. A Parent holds four
capabilities, and all four are scoped through `parent_student_links`: with no
link, `children` is empty and every report is a 404. The account is a place for
a link to attach to, not access to anything.
"""

from __future__ import annotations

import uuid

from django.db import IntegrityError
from django.utils import timezone
from rest_framework import status as http
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from .authentication import SupabaseIdentityAuthentication
from .models import User
from .permissions import IsAuthenticatedPrincipal
from .roles import PARENT
from .serializers import ParentProfileSerializer, ParentSignupSerializer


class ParentSignupView(APIView):
    """POST /api/v1/accounts/parents - 'Create a parent account'.

    Authenticated by Supabase identity alone, exactly as school registration is:
    the caller has just signed up, holds no role, and this endpoint is what
    gives them one. Django cannot create the identity itself - `public.users.id`
    carries a foreign key to `auth.users.id` - so signup happens in Supabase
    first and lands here second.

    Three properties:

      * **The email comes from the token.** An email-bound invite code is
        matched against `public.users.email` by
        `redeem_parent_invite_code`, so an address the caller could type would
        let anyone claim a code issued to somebody else. It is read from the
        verified claim and the body has no field for it.
      * **Idempotent.** Signing up twice returns the existing row rather than
        failing, because the client calls this immediately before redeeming a
        code and a retry of a request whose response was lost must not look
        like a failure.
      * **It never converts an existing account.** A caller who already has a
        row of any other role is refused. A Teacher promoting themselves to a
        Parent would shed their school - `users_role_school_scope_check`
        requires `school_id IS NULL` for a Parent - and would take their
        school's children with them into a role whose scope is a set of links
        they could then extend. The database would refuse the write; this
        refuses it first, with an answer a person can act on.

    Throttled on the `auth` scope: an identity-only surface that writes a row is
    worth rate limiting well below the default.
    """

    authentication_classes = [SupabaseIdentityAuthentication]
    permission_classes = [IsAuthenticatedPrincipal]
    throttle_scope = "auth"

    def post(self, request):
        serializer = ParentSignupSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        caller = request.user

        existing = User.objects.filter(pk=caller.id).first()
        if existing is not None:
            if existing.role != PARENT:
                raise ValidationError(
                    {
                        "detail": "This account already belongs to a school. Use a different "
                        "email address to create a parent account."
                    }
                )
            # Already a parent. Return the row rather than a second one; the
            # client's next call is the code redemption either way.
            return Response(
                {"profile": ParentProfileSerializer(existing).data, "created": False},
                status=http.HTTP_200_OK,
            )

        # An identity with no email is not a state Supabase produces for a
        # password or OAuth signup, but the claim is optional in the JWT and an
        # empty address would silently match no email-bound code at all - and
        # would collide with any other row that also stored "".
        email = (caller.email or "").strip()
        if not email:
            raise ValidationError(
                {"detail": "This sign-in carries no email address. Sign in with an email account."}
            )

        now = timezone.now()
        try:
            profile = User.objects.create(
                id=uuid.UUID(str(caller.id)),
                # No school. `users_role_school_scope_check` requires exactly
                # this for a Parent, and a parent reaches children through
                # `parent_student_links` instead.
                school=None,
                name=data["name"],
                email=email,
                role=PARENT,
                phone=data.get("phone") or None,
                status=User.Status.ACTIVE,
                profile_json={},
                total_credits=0,
                used_credits=0,
                created_at=now,
                updated_at=now,
            )
        except IntegrityError:
            # Two concurrent signups for one identity: the primary key decides.
            # Re-read rather than reporting a failure for a row that now exists.
            profile = User.objects.filter(pk=caller.id).first()
            if profile is None or profile.role != PARENT:
                raise
            return Response(
                {"profile": ParentProfileSerializer(profile).data, "created": False},
                status=http.HTTP_200_OK,
            )

        # No audit row. `audit_events.school_id` is not nullable and a parent
        # belongs to no school, so there is nowhere to file this. The event that
        # a school can and should see is the redemption, which
        # apps/tenants/parents/services.py records against the issuing school.
        return Response(
            {"profile": ParentProfileSerializer(profile).data, "created": True},
            status=http.HTTP_201_CREATED,
        )
