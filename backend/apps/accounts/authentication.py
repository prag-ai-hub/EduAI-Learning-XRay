"""Supabase-JWT verification and profile resolution.

Supabase Auth stays the identity provider for the whole product. Django does
not issue or store credentials; it verifies the Supabase-issued access token on
every request - signature, expiry and audience - and then loads the caller's
profile from `public.users`.

**The token proves identity, never authority.** `app_metadata.role` can be
stale: a role change or a disabled account takes effect in the database
immediately but not in a token already in a browser tab. So role, school and
account status are read from `public.users` on every request, which is what
`frontend/lib/authorization.ts` does too. The two services must not disagree
about who a caller is.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import jwt
from django.conf import settings
from rest_framework import authentication, exceptions

from .capabilities import capabilities_for
from .roles import PARENT, SUPER_ADMIN


@dataclass(frozen=True)
class SupabasePrincipal:
    """A verified caller. Deliberately not a Django ORM user.

    Identity lives in Supabase `auth.users`; the profile extension lives in
    `public.users`. Mapping this onto `django.contrib.auth.User` would create a
    third, competing definition of "a user".

    Frozen: a request handler must never be able to widen its own authority by
    assigning to `role` or `school_id`.
    """

    id: str
    email: str
    role: str
    school_id: str | None
    status: str
    claims: dict = field(default_factory=dict, repr=False)

    @property
    def pk(self) -> str:
        """DRF keys throttle buckets and several internals on `pk`."""
        return self.id

    @property
    def is_authenticated(self) -> bool:
        return True

    @property
    def is_anonymous(self) -> bool:
        return False

    @property
    def is_super_admin(self) -> bool:
        return self.role == SUPER_ADMIN

    @property
    def is_parent(self) -> bool:
        return self.role == PARENT

    @property
    def capabilities(self) -> frozenset[str]:
        return capabilities_for(self.role)

    def can(self, capability: str) -> bool:
        return capability in self.capabilities

    def __str__(self) -> str:
        return f"{self.email} ({self.role})"


class SupabaseJWTAuthentication(authentication.BaseAuthentication):
    """DRF authentication for `Authorization: Bearer <supabase jwt>`."""

    keyword = "Bearer"

    def authenticate(self, request):
        header = authentication.get_authorization_header(request).split()
        if not header or header[0].lower() != self.keyword.lower().encode():
            return None  # no credentials offered - let the permission class decide
        if len(header) != 2:
            raise exceptions.AuthenticationFailed("Malformed Authorization header.")

        claims = self._decode(header[1].decode())
        subject = claims.get("sub")
        if not subject:
            raise exceptions.AuthenticationFailed("Token carries no subject.")

        return (self._principal(subject, claims), header[1].decode())

    def _decode(self, token: str) -> dict:
        try:
            return jwt.decode(
                token,
                settings.SUPABASE_JWT_SECRET,
                algorithms=settings.SUPABASE_JWT_ALGORITHMS,
                audience=settings.SUPABASE_JWT_AUDIENCE,
                options={"require": ["exp", "sub"]},
            )
        except jwt.ExpiredSignatureError as exc:
            raise exceptions.AuthenticationFailed("Token has expired.") from exc
        except jwt.InvalidTokenError as exc:
            # One opaque message for every other failure mode. Telling a caller
            # *why* a token failed helps them forge the next one.
            raise exceptions.AuthenticationFailed("Invalid token.") from exc

    def _principal(self, subject: str, claims: dict) -> SupabasePrincipal:
        # Imported here: models load after apps are ready, and this module is
        # imported from settings via DEFAULT_AUTHENTICATION_CLASSES.
        from .models import User

        profile = (
            User.objects.filter(pk=subject)
            .only("id", "email", "role", "school_id", "status", "disabled_at")
            .first()
        )

        # A valid token with no profile row is a real, expected state: the
        # identity exists in Supabase but the user has not finished signing up.
        # It is 403, not 401 - retrying with a fresh token will not help.
        if profile is None:
            raise exceptions.PermissionDenied("Complete your profile before continuing.")
        if profile.status != User.Status.ACTIVE or profile.disabled_at is not None:
            raise exceptions.PermissionDenied(
                "This account is disabled. Contact your administrator."
            )

        return SupabasePrincipal(
            id=str(profile.id),
            email=profile.email,
            # From the database, never from the token: see the module docstring.
            role=profile.role,
            school_id=profile.school_id,
            status=profile.status,
            claims=claims,
        )

    def authenticate_header(self, request) -> str:
        return self.keyword


@dataclass(frozen=True)
class SupabaseIdentity:
    """A verified Supabase account that has no profile row yet.

    Exactly one endpoint needs this: school registration, which exists to
    *create* the profile. Everywhere else a missing profile is a 403, because a
    caller with no role should not be reaching an authorised surface.

    It holds no role and no capabilities, so a view that mistakenly accepts this
    principal cannot pass any capability check.
    """

    id: str
    email: str
    claims: dict = field(default_factory=dict, repr=False)

    role = None
    school_id = None

    @property
    def pk(self) -> str:
        return self.id

    @property
    def is_authenticated(self) -> bool:
        return True

    @property
    def is_anonymous(self) -> bool:
        return False

    @property
    def is_super_admin(self) -> bool:
        return False

    @property
    def is_parent(self) -> bool:
        return False

    @property
    def capabilities(self) -> frozenset[str]:
        return frozenset()

    def can(self, capability: str) -> bool:
        return False

    def __str__(self) -> str:
        return f"{self.email} (no profile)"


class SupabaseIdentityAuthentication(SupabaseJWTAuthentication):
    """Verify the token but do not require a profile.

    Used only by school registration. A disabled account is still refused - a
    suspended administrator must not be able to start over by registering a new
    school.
    """

    def _principal(self, subject: str, claims: dict):
        from .models import User

        profile = (
            User.objects.filter(pk=subject)
            .only("id", "email", "role", "school_id", "status", "disabled_at")
            .first()
        )
        if profile is None:
            return SupabaseIdentity(id=subject, email=claims.get("email") or "", claims=claims)
        if profile.status != User.Status.ACTIVE or profile.disabled_at is not None:
            raise exceptions.PermissionDenied(
                "This account is disabled. Contact your administrator."
            )
        return SupabasePrincipal(
            id=str(profile.id),
            email=profile.email,
            role=profile.role,
            school_id=profile.school_id,
            status=profile.status,
            claims=claims,
        )
