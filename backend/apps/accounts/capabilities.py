"""What each role may do, transcribed from the role & permission matrix.

Source of truth: ../../../docs/plan/01-ROLE-PERMISSION-MATRIX.md §2.

Authority in this product does NOT flow downward. A SchoolAdmin outranks a
Teacher administratively yet cannot grade, and a SuperAdmin cannot either -
"teacher authority over marks is the product's core promise and must not be
delegable upward" (matrix §2). So this is a capability map, not a rank ladder:
asking "does this role outrank that one" would quietly hand grading to admins.

Two layers, kept separate on purpose:

  * A capability answers "may this role do this KIND of thing at all?"
  * Tenancy answers "on WHICH rows?" - see apps/common/tenancy.py.

The matrix marks some cells with a half-circle: a SuperAdmin may reach school
administration only under a support-access grant, and a Teacher only within
their own classes. Those cells still appear here, because the restriction is a
scope question, not a capability question. `–` cells are absent entirely.
"""

from __future__ import annotations

from types import MappingProxyType

from .roles import PARENT, SCHOOL_ADMIN, SUPER_ADMIN, TEACHER


class Capability:
    """Namespaced capability identifiers. Values are stable and may be logged."""

    # --- Platform administration (matrix §2, "Platform administration") ------
    PLATFORM_SCHOOLS_LIST = "platform.schools.list"
    PLATFORM_SCHOOL_APPROVE = "platform.school.approve"
    PLATFORM_SCHOOL_SUSPEND = "platform.school.suspend"
    PLATFORM_PLANS_MANAGE = "platform.plans.manage"
    PLATFORM_ANALYTICS_READ = "platform.analytics.read"
    PLATFORM_AUDIT_READ = "platform.audit.read"
    PLATFORM_SUPPORT_ACCESS = "platform.support_access"

    # --- School administration ----------------------------------------------
    SCHOOL_PROFILE_EDIT = "school.profile.edit"
    SCHOOL_USERS_INVITE = "school.users.invite"
    SCHOOL_USERS_DISABLE = "school.users.disable"
    SCHOOL_CREDITS_ALLOCATE = "school.credits.allocate"
    SCHOOL_CLASSES_MANAGE = "school.classes.manage"
    SCHOOL_ROSTER_MANAGE = "school.roster.manage"
    SCHOOL_ACADEMIC_YEARS_MANAGE = "school.academic_years.manage"
    SCHOOL_REPORTS_READ = "school.reports.read"
    SCHOOL_SUBSCRIPTION_MANAGE = "school.subscription.manage"
    SCHOOL_PAYMENTS_READ = "school.payments.read"

    # --- Teaching workflow ---------------------------------------------------
    TEACHING_ASSESSMENT_CREATE = "teaching.assessment.create"
    TEACHING_EVIDENCE_UPLOAD = "teaching.evidence.upload"
    TEACHING_OCR_RUN = "teaching.ocr.run"
    TEACHING_GRADING_RUN = "teaching.grading.run"
    TEACHING_EVALUATION_SUBMIT = "teaching.evaluation.submit"
    TEACHING_RESOURCES_GENERATE = "teaching.resources.generate"
    TEACHING_INTERVENTION_MANAGE = "teaching.intervention.manage"
    TEACHING_PARENT_INVITE = "teaching.parent.invite"
    TEACHING_ASSESSMENT_DELETE = "teaching.assessment.delete"

    # --- Student data & reports ---------------------------------------------
    STUDENT_REPORT_READ = "student.report.read"
    STUDENT_RESOURCES_READ = "student.resources.read"
    STUDENT_RAW_FILE_READ = "student.raw_file.read"
    STUDENT_OCR_TEXT_READ = "student.ocr_text.read"
    STUDENT_AI_RATIONALE_READ = "student.ai_rationale.read"
    STUDENT_MASTERY_IDENTIFIED_READ = "student.mastery.identified.read"
    STUDENT_MASTERY_DEIDENTIFIED_READ = "student.mastery.deidentified.read"

    # --- Payments -------------------------------------------------------------
    PAYMENT_B2B_CHECKOUT = "payment.b2b.checkout"
    PAYMENT_B2C_CHECKOUT = "payment.b2c.checkout"
    PAYMENT_HISTORY_READ = "payment.history.read"
    PAYMENT_INVOICE_DOWNLOAD = "payment.invoice.download"
    PAYMENT_REFUND_ISSUE = "payment.refund.issue"

    # --- AI proxy -------------------------------------------------------------
    # Server-side model access. Held by the roles that do teaching work, because
    # every AI call in this product is part of producing or diagnosing student
    # work - and because the key being proxied is billable.
    AI_COMPLETION_RUN = "ai.completion.run"
    AI_OCR_RUN = "ai.ocr.run"

    # --- Parent portal ---------------------------------------------------------
    PARENT_CHILD_LINK = "parent.child.link"
    PARENT_CHILDREN_LIST = "parent.children.list"
    PARENT_CHILD_REPORTS_READ = "parent.child.reports.read"
    PARENT_CHILD_UNLINK = "parent.child.unlink"


C = Capability

# Each row below is one row of the matrix. ✔ and ◐ both grant the capability;
# ◐ additionally needs a scope check, which tenancy.py applies. `–` is absent.
_SUPER_ADMIN = frozenset(
    {
        # Platform administration: ✔ across the board.
        C.PLATFORM_SCHOOLS_LIST,
        C.PLATFORM_SCHOOL_APPROVE,
        C.PLATFORM_SCHOOL_SUSPEND,
        C.PLATFORM_PLANS_MANAGE,
        C.PLATFORM_ANALYTICS_READ,
        C.PLATFORM_AUDIT_READ,
        C.PLATFORM_SUPPORT_ACCESS,
        # School administration: ◐ - only under a support-access grant.
        C.SCHOOL_PROFILE_EDIT,
        C.SCHOOL_USERS_INVITE,
        C.SCHOOL_USERS_DISABLE,
        C.SCHOOL_CREDITS_ALLOCATE,
        C.SCHOOL_CLASSES_MANAGE,
        C.SCHOOL_ROSTER_MANAGE,
        C.SCHOOL_ACADEMIC_YEARS_MANAGE,
        C.SCHOOL_REPORTS_READ,
        C.SCHOOL_SUBSCRIPTION_MANAGE,
        C.SCHOOL_PAYMENTS_READ,
        # Student data: ◐ identifiable only under a grant; de-identified is ✔.
        C.STUDENT_REPORT_READ,
        C.STUDENT_RESOURCES_READ,
        C.STUDENT_MASTERY_IDENTIFIED_READ,
        C.STUDENT_MASTERY_DEIDENTIFIED_READ,
        # Payments: ✔ all, plus refunds - the only role that may issue one.
        C.PAYMENT_HISTORY_READ,
        C.PAYMENT_INVOICE_DOWNLOAD,
        C.PAYMENT_REFUND_ISSUE,
    }
)

_SCHOOL_ADMIN = frozenset(
    {
        C.PLATFORM_AUDIT_READ,  # ◐ own school only
        C.SCHOOL_PROFILE_EDIT,
        C.SCHOOL_USERS_INVITE,
        C.SCHOOL_USERS_DISABLE,
        C.SCHOOL_CREDITS_ALLOCATE,
        C.SCHOOL_CLASSES_MANAGE,
        C.SCHOOL_ROSTER_MANAGE,
        C.SCHOOL_ACADEMIC_YEARS_MANAGE,
        C.SCHOOL_REPORTS_READ,
        C.SCHOOL_SUBSCRIPTION_MANAGE,
        C.SCHOOL_PAYMENTS_READ,
        C.TEACHING_PARENT_INVITE,
        C.TEACHING_ASSESSMENT_DELETE,  # ◐
        C.STUDENT_REPORT_READ,
        C.STUDENT_RESOURCES_READ,
        C.STUDENT_MASTERY_IDENTIFIED_READ,
        C.STUDENT_MASTERY_DEIDENTIFIED_READ,
        C.PAYMENT_B2B_CHECKOUT,
        C.PAYMENT_HISTORY_READ,
        C.PAYMENT_INVOICE_DOWNLOAD,
    }
)

_TEACHER = frozenset(
    {
        C.SCHOOL_CLASSES_MANAGE,
        C.SCHOOL_ROSTER_MANAGE,
        C.SCHOOL_REPORTS_READ,  # ◐ own classes
        C.TEACHING_ASSESSMENT_CREATE,
        C.TEACHING_EVIDENCE_UPLOAD,
        C.TEACHING_OCR_RUN,
        C.TEACHING_GRADING_RUN,
        C.TEACHING_EVALUATION_SUBMIT,
        C.TEACHING_RESOURCES_GENERATE,
        C.TEACHING_INTERVENTION_MANAGE,
        C.TEACHING_PARENT_INVITE,
        C.TEACHING_ASSESSMENT_DELETE,
        # The AI proxy: grading, OCR and resource generation are all teacher
        # work, and the key being proxied is billable.
        C.AI_COMPLETION_RUN,
        C.AI_OCR_RUN,
        C.STUDENT_REPORT_READ,
        C.STUDENT_RESOURCES_READ,
        C.STUDENT_RAW_FILE_READ,
        C.STUDENT_OCR_TEXT_READ,
        C.STUDENT_AI_RATIONALE_READ,
        C.STUDENT_MASTERY_IDENTIFIED_READ,
        C.STUDENT_MASTERY_DEIDENTIFIED_READ,
    }
)

_PARENT = frozenset(
    {
        # Only teacher-approved output, and only for a linked child. Parents never
        # see raw scans, OCR text or AI rationale - matrix §2, "Deliberate
        # restrictions" - so those three capabilities are absent, not scoped.
        C.STUDENT_REPORT_READ,
        C.STUDENT_RESOURCES_READ,
        C.STUDENT_MASTERY_IDENTIFIED_READ,
        C.PARENT_CHILD_LINK,
        C.PARENT_CHILDREN_LIST,
        C.PARENT_CHILD_REPORTS_READ,
        C.PARENT_CHILD_UNLINK,
        C.PAYMENT_B2C_CHECKOUT,
        C.PAYMENT_HISTORY_READ,
        C.PAYMENT_INVOICE_DOWNLOAD,
    }
)

ROLE_CAPABILITIES = MappingProxyType(
    {
        SUPER_ADMIN: _SUPER_ADMIN,
        SCHOOL_ADMIN: _SCHOOL_ADMIN,
        TEACHER: _TEACHER,
        PARENT: _PARENT,
    }
)

ALL_CAPABILITIES = frozenset(
    value
    for name, value in vars(Capability).items()
    if not name.startswith("_") and isinstance(value, str)
)


def capabilities_for(role: str | None) -> frozenset[str]:
    """Capabilities held by a role. An unknown or missing role holds none."""
    return ROLE_CAPABILITIES.get(role or "", frozenset())


def role_has(role: str | None, capability: str) -> bool:
    return capability in capabilities_for(role)
