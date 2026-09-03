"""Permission classes for the four-tier hierarchy.

These answer only "may this role do this KIND of thing?". Which rows the caller
may touch is a separate question, answered by apps/common/tenancy.py. Keeping
them apart is what stops "SuperAdmin" quietly meaning "can read every school's
student data".

Deny by default: a view that declares no capability is refused, not opened. A
missing declaration is far more likely to be an oversight than an intent to
publish an endpoint.
"""

from __future__ import annotations

from rest_framework.permissions import BasePermission

from . import roles
from .capabilities import Capability


def _principal(request):
    user = getattr(request, "user", None)
    return user if getattr(user, "is_authenticated", False) else None


class HasCapability(BasePermission):
    """Grant when the caller's role holds every capability the view declares.

    A view declares its requirement in one of two ways::

        required_capabilities = {Capability.PLATFORM_SCHOOLS_LIST}

        capability_map = {                      # per DRF viewset action
            "list": Capability.PLATFORM_SCHOOLS_LIST,
            "partial_update": Capability.PLATFORM_SCHOOL_APPROVE,
        }

    `capability_map` wins when the action is present in it.
    """

    required_capabilities: frozenset[str] = frozenset()
    message = "Your role does not permit this action."

    def _required(self, view) -> frozenset[str] | None:
        action = getattr(view, "action", None)
        mapping = getattr(view, "capability_map", None)
        if mapping and action in mapping:
            declared = mapping[action]
            return frozenset({declared} if isinstance(declared, str) else declared)

        declared = getattr(view, "required_capabilities", None) or self.required_capabilities
        if isinstance(declared, str):
            return frozenset({declared})
        return frozenset(declared) if declared else None

    def has_permission(self, request, view) -> bool:
        principal = _principal(request)
        if principal is None:
            return False
        required = self._required(view)
        if not required:
            # Nothing declared. Refuse rather than fall open.
            return False
        return all(principal.can(capability) for capability in required)


def requires(*capabilities: str) -> type[HasCapability]:
    """Build a permission class for an inline declaration::

    permission_classes = [requires(Capability.PLATFORM_SCHOOL_APPROVE)]
    """
    required = frozenset(capabilities)
    if not required:
        raise ValueError("requires() needs at least one capability")
    unknown = required - _known_capabilities()
    if unknown:
        raise ValueError(f"unknown capability: {sorted(unknown)}")
    return type("Requires", (HasCapability,), {"required_capabilities": required})


def _known_capabilities() -> frozenset[str]:
    from .capabilities import ALL_CAPABILITIES

    return ALL_CAPABILITIES


class _ExactRole(BasePermission):
    """Role identity, not rank.

    There is no `IsTeacherOrAbove`: a SchoolAdmin is not a senior Teacher, and
    granting them teaching powers would contradict the matrix. Use a capability
    when the question is "may they do X"; use these only when the question is
    genuinely "is this account of that kind", such as routing a parent portal.
    """

    role: str = ""
    message = "This area is not available to your role."

    def has_permission(self, request, view) -> bool:
        principal = _principal(request)
        return principal is not None and principal.role == self.role


class IsSuperAdmin(_ExactRole):
    role = roles.SUPER_ADMIN


class IsSchoolAdmin(_ExactRole):
    role = roles.SCHOOL_ADMIN


class IsTeacher(_ExactRole):
    role = roles.TEACHER


class IsParent(_ExactRole):
    role = roles.PARENT


class IsAuthenticatedPrincipal(BasePermission):
    """A verified, enabled account. The floor for anything non-public."""

    def has_permission(self, request, view) -> bool:
        return _principal(request) is not None


__all__ = [
    "Capability",
    "HasCapability",
    "IsAuthenticatedPrincipal",
    "IsParent",
    "IsSchoolAdmin",
    "IsSuperAdmin",
    "IsTeacher",
    "requires",
]
