"""Reading the audit trail.

The write side is apps/platform/audit/services.py, called by every school
lifecycle transition and every cross-tenant read. This is the read side: a
paginated, filterable, strictly read-only history. There is no create, no
update and no delete, because an append-only record that an administrator can
edit is not a record of anything.

Scoping is the part worth reading twice.

A SchoolAdmin sees their own school and nothing else - the ordinary tenant rule,
and the matrix's "◐ own school only" beside `platform.audit.read`.

A SuperAdmin sees every school, which is `SuperAdminScope.ALL` rather than the
`GRANTED` default, and that is a deliberate departure. The reasoning:

  * A support-access grant exists to gate reading a school's *student* data
    (matrix §4). An audit row is designed to hold none: it records who did what
    to which entity, and `services.record()` keeps a payload out of it.
  * Requiring a grant would make the trail readable only by someone who
    currently holds access to the school being examined. That inverts the point
    of the mechanism - the record of a support-grant read would become
    unreadable the moment that grant lapsed, so the one artefact that exists to
    hold a SuperAdmin to account could only be inspected under a live warrant
    over the school they may have wronged.
  * The matrix marks `platform.audit.read` ✔ for SuperAdmin, not ◐, unlike every
    school-administration cell around it.

Choosing ALL must not quietly widen what a grant was protecting, and on its own
it would: `detail_json` is free-form jsonb on a table the older Next.js surface
also writes, and one of its rows carries a full evaluation snapshot. The
serializer is what makes ALL defensible - it returns a per-action whitelist of
keys and drops the rest, so the grant-protected material has no path out through
this endpoint. See apps/platform/audit/serializers.py.

Reading the trail is not itself audited. A row per page view would bury the
actions the trail exists to show, and each read would generate the evidence for
the next one.
"""

from __future__ import annotations

from apps.accounts.capabilities import Capability
from apps.common.pagination import DefaultPagination
from apps.common.viewsets import ReadOnlyTenantScopedViewSet
from apps.tenants.schools.tenancy import SuperAdminScope

from . import filters
from .models import AuditEvent
from .serializers import AuditEventSerializer


class AuditTrailViewSet(ReadOnlyTenantScopedViewSet):
    """GET /api/v1/audit/events/ - the history of privileged actions.

    Teacher and Parent hold no `platform.audit.read` and are refused by the
    capability, before any question of rows arises.
    """

    queryset = AuditEvent.objects.all()
    serializer_class = AuditEventSerializer
    pagination_class = DefaultPagination
    lookup_value_regex = "[^/]+"  # audit ids are text, not integers
    required_capabilities = frozenset({Capability.PLATFORM_AUDIT_READ})
    throttle_scope = "user"

    tenant_field = "school_id"
    # See the module docstring. This is the deliberate exception to GRANTED, and
    # it holds only because the serializer redacts what a grant would protect.
    super_admin_scope = SuperAdminScope.ALL

    def get_queryset(self):
        queryset = super().get_queryset()
        if self.action != "list":
            # A single row is fetched by id; filtering it would only turn a 404
            # into a different 404, and `ordering` is meaningless on one row.
            return queryset
        return filters.apply(queryset, self.request.query_params)


__all__ = ["AuditTrailViewSet"]
