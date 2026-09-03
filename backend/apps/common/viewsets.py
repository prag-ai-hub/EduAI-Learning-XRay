"""Viewset base classes.

Three things every endpoint in this service needs, bound together so none can
be forgotten independently:

  * a declared capability (apps/accounts/permissions.py) - what kind of thing,
  * tenant scoping (apps/common/tenancy.py)             - which rows,
  * a throttle scope (settings.REST_FRAMEWORK)          - how often.

Inherit `TenantScopedViewSet` for anything holding school data and
`PlatformViewSet` for the cross-tenant surfaces. A view that needs neither is
almost certainly missing a requirement rather than exempt from one.
"""

from __future__ import annotations

from rest_framework import viewsets

from apps.accounts.permissions import HasCapability

from .tenancy import SuperAdminScope, TenantScopedQuerySetMixin


class _Base(viewsets.GenericViewSet):
    permission_classes = [HasCapability]
    throttle_scope = "user"

    #: Declared per view - see HasCapability. Left empty here so that a view
    #: which declares nothing is denied rather than served.
    required_capabilities: frozenset[str] = frozenset()


class TenantScopedViewSet(TenantScopedQuerySetMixin, _Base, viewsets.ModelViewSet):
    """Read/write access to a school-scoped resource."""

    tenant_field = "school_id"
    super_admin_scope = SuperAdminScope.GRANTED


class ReadOnlyTenantScopedViewSet(TenantScopedQuerySetMixin, _Base, viewsets.ReadOnlyModelViewSet):
    """Read-only access to a school-scoped resource."""

    tenant_field = "school_id"
    super_admin_scope = SuperAdminScope.GRANTED


class PlatformViewSet(_Base, viewsets.ModelViewSet):
    """A cross-tenant resource: the school directory, plans, platform config.

    `tenant_field` is None because the rows carry no single tenant - not because
    the endpoint is unscoped. The capability is what limits it, and for these
    surfaces the matrix grants it to SuperAdmin alone.
    """

    tenant_field = None


class ReadOnlyPlatformViewSet(_Base, viewsets.ReadOnlyModelViewSet):
    """Read-only cross-tenant resource."""

    tenant_field = None
