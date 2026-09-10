"""Issuing, redeeming and revoking the link between a parent and a child.

`parent_student_links` is the only path from a parent to a student, so this
module is the whole authorisation surface of the B2C product. Three decisions
shape it.

**The database owns redemption.** M8 ships
`public.redeem_parent_invite_code(uuid, text)`, which takes the code row `FOR
UPDATE`, checks it, inserts the link and increments `used_count` in one
statement. Reimplementing that in Python would reintroduce exactly the race it
was written to close: two concurrent redeems of a single-use code both read
`used_count = 0` and both insert. So Python calls the function and never
duplicates its rules.

**Every refusal looks the same from outside.** The function distinguishes five
failure modes and says which in its error message. A caller must not learn any
of them: "already used" tells an attacker the code was real, and "issued to a
different email address" turns the code into an oracle for whether an address
holds an account. `redeem()` therefore collapses all of them into one
`InviteRefused`, and records the real reason in the audit trail, where only the
school can see it.

**A code is a bearer credential, and is treated as one.** Whoever holds it can
link themselves to the child it names - that is the point of handing it to a
parent, and it is also the risk. What bounds the damage is that it is
unguessable (`secrets`, 50 bits), single-use, short-lived, revocable, optionally
bound to one email address by the SQL function, and that every redemption is
attributable in `audit_events`. A code that reaches the wrong person can be
found and undone; a code that can be guessed cannot.
"""

from __future__ import annotations

import json
import logging
import secrets
import uuid
from dataclasses import dataclass
from datetime import timedelta

from django.db import DatabaseError, IntegrityError, connection, transaction
from django.db.models import OuterRef, Subquery
from django.utils import timezone
from rest_framework.exceptions import APIException, ValidationError

from apps.platform.audit.services import record

from .models import ParentInviteCode, ParentStudentLink

logger = logging.getLogger(__name__)


class ParentAction:
    """Audit action names for the parent portal.

    They live here rather than in `apps.platform.audit.services.Action` only
    because that module belongs to another surface; they follow its convention
    and are stable strings that get queried.
    """

    INVITE_ISSUED = "parent.invite.issued"
    INVITE_REVOKED = "parent.invite.revoked"
    LINK_REDEEMED = "parent.link.redeemed"
    LINK_REFUSED = "parent.link.refused"
    LINK_REVOKED = "parent.link.revoked"


class InviteRefused(APIException):
    """One answer for every reason a code cannot be redeemed.

    Wrong, malformed, expired, exhausted, revoked, or issued to a different
    address: all of them produce this, with this wording. A caller who can tell
    those apart can enumerate live codes, and can use a code as an oracle for
    which email addresses have accounts.
    """

    status_code = 400
    default_detail = "That invite code cannot be used. Ask the school for a new one."
    default_code = "invite_refused"


# --- issuing ----------------------------------------------------------------

#: Uppercase alphanumerics minus the pairs a person mistypes when copying a code
#: off a printed slip: I/1 and O/0. `parent_invite_codes_code_check` accepts
#: `^[A-Z0-9]{6,12}$`, and this is a subset of that.
ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

#: 10 characters over a 32-symbol alphabet is 50 bits. The constraint permits
#: six, which is only 30 bits - enough to be worth grinding at, and the reason
#: length is decided here rather than left to the minimum the database allows.
CODE_LENGTH = 10

#: How many times to retry on the unique index before giving up. At 50 bits a
#: collision is a lottery win, so a second failure means something else is
#: wrong and an error is more honest than a third attempt.
_CODE_ATTEMPTS = 3

DEFAULT_EXPIRY_DAYS = 14
MAX_EXPIRY_DAYS = 30


def generate_code() -> str:
    """An unguessable code. `secrets`, never `random`.

    `random` is a Mersenne Twister seeded from the clock: 624 observed outputs
    reveal its state, and every code it will ever produce. These are printed on
    a slip and handed to a stranger.
    """
    return "".join(secrets.choice(ALPHABET) for _ in range(CODE_LENGTH))


def issue_code(
    *,
    principal,
    student,
    relationship: str,
    email: str | None,
    expires_in_days: int,
) -> ParentInviteCode:
    """Create a single-use code for one student. Caller has already scoped it.

    `max_uses` is fixed at 1 rather than exposed. The column permits up to five,
    but a code that survives its first redemption is a code that can be reused
    by whoever else saw the slip, and two parents of one child are two invites
    with two relationships - not one code spent twice.
    """
    now = timezone.now()
    expires_at = now + timedelta(days=expires_in_days)

    for attempt in range(_CODE_ATTEMPTS):
        code = generate_code()
        try:
            # A savepoint per attempt: a unique violation would otherwise leave
            # the surrounding transaction unusable for the retry.
            with transaction.atomic():
                invite = ParentInviteCode.objects.create(
                    id=uuid.uuid4(),
                    code=code,
                    school_id=student.school_id,
                    student_id=student.id,
                    created_by_id=principal.id,
                    email=email or None,
                    relationship=relationship,
                    max_uses=1,
                    used_count=0,
                    expires_at=expires_at,
                    created_at=now,
                )
        except IntegrityError:
            if attempt == _CODE_ATTEMPTS - 1:
                raise
            continue
        break

    record(
        action=ParentAction.INVITE_ISSUED,
        school_id=invite.school_id,
        actor_id=principal.id,
        entity_type="parent_invite_code",
        entity_id=str(invite.id),
        # The code itself is never recorded. An audit row is readable by every
        # SchoolAdmin in the school; a live bearer credential in it would make
        # the trail a place to collect codes rather than to review decisions.
        detail={
            "studentId": invite.student_id,
            "relationship": invite.relationship,
            "expiresAt": invite.expires_at.isoformat(),
            "emailBound": bool(invite.email),
        },
    )
    return invite


def revoke_code(*, principal, invite: ParentInviteCode) -> ParentInviteCode:
    """Kill a code that has gone to the wrong place. Idempotent."""
    if invite.revoked_at is None:
        invite.revoked_at = timezone.now()
        invite.save(update_fields=["revoked_at"])
        record(
            action=ParentAction.INVITE_REVOKED,
            school_id=invite.school_id,
            actor_id=principal.id,
            entity_type="parent_invite_code",
            entity_id=str(invite.id),
            detail={"studentId": invite.student_id},
        )
    return invite


# --- redeeming --------------------------------------------------------------


@dataclass(frozen=True)
class RedeemedLink:
    """What the SQL function returns: the link, and what it points at."""

    link_id: str
    student_id: str
    school_id: str
    relationship: str


def normalise_code(value: str) -> str:
    """What the SQL function matches on: `upper(btrim(code))`."""
    return (value or "").strip().upper()


def redeem(*, principal, code: str) -> RedeemedLink:
    """Redeem a code into a link, or refuse without saying why.

    Replay is the SQL function's job and is deliberate: a parent who already
    holds this link gets that same link back rather than a second one, because
    `(parent_user_id, student_id)` is unique and because the retry of a request
    whose response was lost must not look like a failure.
    """
    candidate = normalise_code(code)

    try:
        # A savepoint. `raise exception` inside the function aborts the
        # transaction, and without one the request could not go on to write its
        # audit row.
        with transaction.atomic(), connection.cursor() as cursor:
            cursor.execute(
                "select out_link_id, out_student_id, out_school_id, out_relationship "
                "from public.redeem_parent_invite_code(%s::uuid, %s)",
                [str(principal.id), candidate],
            )
            row = cursor.fetchone()
    except DatabaseError as exc:
        _record_refusal(principal=principal, candidate=candidate, error=exc)
        raise InviteRefused() from exc

    if row is None:  # pragma: no cover - the function raises rather than return nothing
        _record_refusal(principal=principal, candidate=candidate, error=None)
        raise InviteRefused()

    link = RedeemedLink(
        link_id=str(row[0]), student_id=row[1], school_id=row[2], relationship=row[3]
    )
    record(
        action=ParentAction.LINK_REDEEMED,
        school_id=link.school_id,
        actor_id=principal.id,
        entity_type="parent_student_link",
        entity_id=link.link_id,
        detail={"studentId": link.student_id, "relationship": link.relationship},
    )
    return link


#: Why a redemption failed, for the trail only. The caller is told none of this.
_REFUSAL_UNKNOWN = "no_such_code"
_REFUSAL_REVOKED = "revoked"
_REFUSAL_EXPIRED = "expired"
_REFUSAL_EXHAUSTED = "exhausted"
_REFUSAL_EMAIL = "email_mismatch"
_REFUSAL_OTHER = "rejected"


def _refusal_reason(*, principal, invite: ParentInviteCode | None) -> str:
    if invite is None:
        return _REFUSAL_UNKNOWN
    if invite.revoked_at is not None:
        return _REFUSAL_REVOKED
    if invite.expires_at <= timezone.now():
        return _REFUSAL_EXPIRED
    if invite.used_count >= invite.max_uses:
        return _REFUSAL_EXHAUSTED
    # No .strip(). This only classifies a refusal the DATABASE has already
    # made, and redeem_parent_invite_code compares `lower(v_code.email)` with
    # `lower(users.email)` untrimmed - so trimming here would let the audit
    # trail record "wrong address" for a code the function refused as expired,
    # or the reverse. The reason is only worth recording if it is the reason.
    if invite.email and invite.email.lower() != (principal.email or "").lower():
        return _REFUSAL_EMAIL
    return _REFUSAL_OTHER


def _record_refusal(*, principal, candidate: str, error: Exception | None) -> None:
    """Audit a failed redemption against the school that issued the code.

    Re-derived from the code row rather than parsed out of the Postgres error
    message: the message is prose that a future migration may reword, and a
    refusal classified by string matching would silently become "rejected" the
    day someone fixes a typo.

    A code that matches nothing belongs to no school, and `audit_events`
    requires one, so that case is logged rather than recorded. It is also the
    case a throttle - not a trail - is the right control for: it is what a brute
    force looks like, and writing a row per guess would hand an attacker a way
    to fill the table.
    """
    invite = ParentInviteCode.objects.filter(code=candidate).first()
    reason = _refusal_reason(principal=principal, invite=invite)

    if invite is None:
        logger.warning("parent.link.refused (%s) for actor %s", reason, principal.id)
        return

    record(
        action=ParentAction.LINK_REFUSED,
        school_id=invite.school_id,
        actor_id=principal.id,
        entity_type="parent_invite_code",
        entity_id=str(invite.id),
        detail={"studentId": invite.student_id, "reason": reason},
    )
    if error is not None:
        logger.info("parent.link.refused (%s) for actor %s", reason, principal.id)


# --- unlinking --------------------------------------------------------------


def revoke_link(*, principal, link: ParentStudentLink) -> ParentStudentLink:
    """A parent removing themselves from a child. Idempotent.

    The row is marked revoked, never deleted. `(parent_user_id, student_id)` is
    unique, so a deleted link and a revoked one differ in what happens next: the
    revoked row is what a later redemption reactivates, and it is the record
    that the access existed at all.
    """
    if link.status != ParentStudentLink.Status.REVOKED:
        link.status = ParentStudentLink.Status.REVOKED
        link.revoked_at = timezone.now()
        link.revoked_by_id = principal.id
        link.save(update_fields=["status", "revoked_at", "revoked_by"])
        record(
            action=ParentAction.LINK_REVOKED,
            school_id=link.school_id,
            actor_id=principal.id,
            entity_type="parent_student_link",
            entity_id=str(link.id),
            detail={"studentId": link.student_id, "by": "parent"},
        )
    return link


# --- reading ----------------------------------------------------------------


def child_reports(parent_id) -> list[dict]:
    """Every linked child's approved results and resources.

    `public.parent_child_reports` (M11) is the whitelist. It selects score,
    feedback, gaps and generated resources, and it does not select `ocr_text`,
    `question_decisions_json` or any evaluation rationale - the three things the
    role matrix keeps from parents entirely rather than merely scopes. Building
    the same shape from Django models would move that guarantee into a field
    list somebody has to remember, which is how it gets lost.

    It filters on `parent_student_links.status = 'active'` itself, so an
    unlinked or revoked parent gets an empty list rather than an error.
    """
    with connection.cursor() as cursor:
        cursor.execute("select public.parent_child_reports(%s::uuid)", [str(parent_id)])
        payload = cursor.fetchone()[0]
    # Django's Postgres backend hands jsonb back as text so that JSONField can
    # apply its own decoder; a raw cursor gets the string, not the structure.
    if isinstance(payload, str):
        payload = json.loads(payload)
    return payload or []


def interventions_by_student(student_ids: list[str]) -> dict[str, list[dict]]:
    """Interventions planned on the assessments a child was graded in.

    Not a Django query because `interventions` has no model here - it belongs to
    the teaching surface, and mapping it from this app would make the parent
    portal the owner of a table it only reads.

    `plan_json` is deliberately not selected. An intervention is planned for a
    concept across a class, so its plan may name the group it applies to; the
    columns returned describe the plan's shape and schedule and cannot carry
    another child. Reaching them through the child's own published results is
    what keeps this scoped: an assessment the child was never graded in is
    invisible.
    """
    if not student_ids:
        return {}

    with connection.cursor() as cursor:
        cursor.execute(
            """
            select distinct
                   g.student_id, i.id, i.concept, i.format, i.duration, i.status,
                   i.followup_date, a.title, a.subject
              from public.interventions i
              join public.assessments a  on a.id = i.assessment_id
              join public.grade_results g on g.assessment_id = i.assessment_id
             where g.student_id = any(%s)
               and g.published_at is not null
             order by i.followup_date desc nulls last, i.id
            """,
            [list(student_ids)],
        )
        rows = cursor.fetchall()

    grouped: dict[str, list[dict]] = {student_id: [] for student_id in student_ids}
    for student_id, *values in rows:
        keys = ("id", "concept", "format", "duration", "status", "followupDate", "title", "subject")
        entry = dict(zip(keys, values, strict=True))
        entry["followupDate"] = entry["followupDate"].isoformat() if entry["followupDate"] else None
        grouped.setdefault(student_id, []).append(entry)
    return grouped


def annotate_link(queryset, parent_id):
    """Carry each student's own link onto the student row.

    A subquery rather than a join: `relationship` and `created_at` belong to the
    link, and two parents of one child hold two different links, so joining
    would make the answer depend on which row came back first. Shared by the
    children list and by the response to a redemption, so both describe a child
    the same way.
    """
    links = ParentStudentLink.objects.filter(
        parent_user_id=parent_id,
        student_id=OuterRef("pk"),
        status=ParentStudentLink.Status.ACTIVE,
    )
    return queryset.annotate(
        relationship=Subquery(links.values("relationship")[:1]),
        linked_at=Subquery(links.values("created_at")[:1]),
    )


def active_link(*, parent_id, student_id: str) -> ParentStudentLink | None:
    return ParentStudentLink.objects.filter(
        parent_user_id=parent_id,
        student_id=student_id,
        status=ParentStudentLink.Status.ACTIVE,
    ).first()


def scoped_student(*, principal, student_id: str):
    """The student, if they are on the caller's own school roster.

    Deliberately one filter rather than a lookup followed by
    `require_school_scope`: splitting them would answer "no such student" and
    "not your school" differently, and the difference is a cross-tenant roster
    enumeration for anyone who can issue an invite.
    """
    from apps.tenants.schools.models import Student

    school_id = getattr(principal, "school_id", None)
    if not school_id:
        raise ValidationError({"detail": "Your profile is not assigned to a school."})
    student = Student.objects.filter(pk=student_id, school_id=school_id).first()
    if student is None:
        raise ValidationError({"student_id": "That student is not on your school's roster."})
    return student


__all__ = [
    "ALPHABET",
    "CODE_LENGTH",
    "DEFAULT_EXPIRY_DAYS",
    "MAX_EXPIRY_DAYS",
    "InviteRefused",
    "ParentAction",
    "RedeemedLink",
    "active_link",
    "annotate_link",
    "child_reports",
    "generate_code",
    "interventions_by_student",
    "issue_code",
    "normalise_code",
    "redeem",
    "revoke_code",
    "revoke_link",
    "scoped_student",
]
