"""Writing the audit trail.

One helper, used by every privileged action, so the shape of a row is decided
once. Two rules, both from the security checklist:

  * **Never store a sensitive payload.** Record enough to reconstruct the
    decision - who, what, which entity, what changed - and nothing that carries
    student PII, a prompt, or card data.
  * **Never let auditing deny an authorised action.** A failed audit write is
    logged loudly and swallowed. A silent gap in the trail is bad; refusing a
    legitimate approval because the trail is unavailable is worse.

Day 8 builds the read side (admin action history). This is the write side.
"""

from __future__ import annotations

import logging
import uuid

logger = logging.getLogger(__name__)


def record(
    *,
    action: str,
    school_id: str,
    entity_type: str,
    entity_id: str | None = None,
    actor_id: str | None = None,
    detail: dict | None = None,
) -> None:
    """Append one row to `public.audit_events`. Never raises."""
    from .models import AuditEvent

    try:
        AuditEvent.objects.create(
            id=str(uuid.uuid4()),
            school_id=school_id,
            actor_id=actor_id,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id or school_id,
            detail_json=detail or {},
        )
    except Exception:  # noqa: BLE001 - auditing must not deny the action
        logger.exception("audit write failed: %s on %s:%s", action, entity_type, entity_id)


class Action:
    """Action names. Stable strings - they are queried and reported on."""

    SCHOOL_REGISTERED = "school.registered"
    SCHOOL_APPROVED = "school.approved"
    SCHOOL_REJECTED = "school.rejected"
    SCHOOL_SUSPENDED = "school.suspended"
    SCHOOL_REACTIVATED = "school.reactivated"
    SUPPORT_CROSS_TENANT_READ = "support.cross_tenant_read"
