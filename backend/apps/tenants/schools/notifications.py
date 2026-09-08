"""Registration and lifecycle emails.

Two rules, both learned from the audit trail's design:

  * **Sending must never block the decision.** A Super Admin approving a school
    is not undone because SMTP timed out. Failures are logged loudly and
    swallowed, exactly like the audit write.
  * **Nothing sensitive is logged.** The recipient count and the template name,
    never the address or the body.

Recipients are the school's active administrators. A suspended or disabled
account is skipped: telling a disabled administrator about a status change is
noise at best, and at worst it is mail to an address that lost access for a
reason.
"""

from __future__ import annotations

import logging

from django.conf import settings
from django.core.mail import send_mail
from django.template.loader import render_to_string

from apps.accounts.models import User
from apps.accounts.roles import SCHOOL_ADMIN

logger = logging.getLogger(__name__)

SUBJECTS = {
    "registered": "We have received your school registration",
    "approved": "{school} is approved and active",
    "rejected": "About your registration for {school}",
    "suspended": "{school} has been suspended",
    "reactivated": "{school} has been reactivated",
}


def administrators(school) -> list[User]:
    return list(
        User.objects.filter(
            school_id=school.id,
            role=SCHOOL_ADMIN,
            status=User.Status.ACTIVE,
            disabled_at__isnull=True,
        ).only("email", "name")
    )


def notify(school, event: str, *, reason: str = "", recipients=None) -> int:
    """Send one lifecycle email per administrator. Returns the number sent."""
    if event not in SUBJECTS:
        raise ValueError(f"unknown notification event: {event}")

    people = recipients if recipients is not None else administrators(school)
    if not people:
        logger.warning("school.%s: no active administrator to notify for %s", event, school.id)
        return 0

    subject = SUBJECTS[event].format(school=school.name)
    sent = 0
    for person in people:
        if not (person.email or "").strip():
            continue
        try:
            body = render_to_string(
                f"emails/schools/{event}.txt",
                {
                    "name": person.name or "there",
                    "school": school,
                    "reason": reason,
                    "frontend_url": settings.FRONTEND_URL,
                },
            )
            send_mail(
                subject,
                body,
                settings.DEFAULT_FROM_EMAIL,
                [person.email],
                fail_silently=False,
            )
            sent += 1
        except Exception:  # noqa: BLE001 - a decision is not undone by SMTP
            logger.exception("school.%s notification failed for school %s", event, school.id)

    # Count and template only: the address and the body stay out of the log.
    logger.info("school.%s notified %d administrator(s) for %s", event, sent, school.id)
    return sent
