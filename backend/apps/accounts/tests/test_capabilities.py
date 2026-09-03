"""The capability map is the role matrix in code. These tests pin the claims
the matrix makes most emphatically - the ones a refactor is most likely to
quietly undo.

Source: docs/plan/01-ROLE-PERMISSION-MATRIX.md §2.
"""

import pytest

from apps.accounts import roles
from apps.accounts.capabilities import (
    ALL_CAPABILITIES,
    ROLE_CAPABILITIES,
    capabilities_for,
    role_has,
)
from apps.accounts.capabilities import (
    Capability as C,
)


def test_every_role_has_an_entry():
    assert set(ROLE_CAPABILITIES) == set(roles.ALL_ROLES)


def test_an_unknown_or_missing_role_holds_nothing():
    for value in (None, "", "root", "Admin"):
        assert capabilities_for(value) == frozenset()


def test_no_map_references_a_capability_that_does_not_exist():
    for role, held in ROLE_CAPABILITIES.items():
        unknown = held - ALL_CAPABILITIES
        assert not unknown, f"{role} references undefined {sorted(unknown)}"


# --- the restrictions the matrix states in prose ---------------------------


@pytest.mark.parametrize("role", [roles.SUPER_ADMIN, roles.SCHOOL_ADMIN, roles.PARENT])
def test_only_a_teacher_may_grade_or_submit_an_evaluation(role):
    # "Teacher authority over marks is the product's core promise and must not
    # be delegable upward." An admin outranks a teacher and still cannot grade.
    assert not role_has(role, C.TEACHING_GRADING_RUN)
    assert not role_has(role, C.TEACHING_EVALUATION_SUBMIT)


def test_a_teacher_may_grade():
    assert role_has(roles.TEACHER, C.TEACHING_GRADING_RUN)
    assert role_has(roles.TEACHER, C.TEACHING_EVALUATION_SUBMIT)


@pytest.mark.parametrize(
    "capability",
    [C.STUDENT_RAW_FILE_READ, C.STUDENT_OCR_TEXT_READ, C.STUDENT_AI_RATIONALE_READ],
)
def test_only_a_teacher_sees_raw_scans_ocr_text_or_ai_rationale(capability):
    # Parents see teacher-approved output only; this is what preserves "the
    # teacher is the author of the mark".
    assert role_has(roles.TEACHER, capability)
    for role in (roles.SUPER_ADMIN, roles.SCHOOL_ADMIN, roles.PARENT):
        assert not role_has(role, capability)


def test_a_super_admin_sees_no_deidentified_gap_in_the_map():
    # Cross-school aggregates are de-identified; identifiable access is a scope
    # question handled by a support grant, not by withholding the capability.
    assert role_has(roles.SUPER_ADMIN, C.STUDENT_MASTERY_DEIDENTIFIED_READ)
    assert not role_has(roles.PARENT, C.STUDENT_MASTERY_DEIDENTIFIED_READ)


def test_platform_administration_belongs_to_the_super_admin_alone():
    platform = {
        C.PLATFORM_SCHOOLS_LIST,
        C.PLATFORM_SCHOOL_APPROVE,
        C.PLATFORM_SCHOOL_SUSPEND,
        C.PLATFORM_PLANS_MANAGE,
        C.PLATFORM_ANALYTICS_READ,
        C.PLATFORM_SUPPORT_ACCESS,
    }
    assert platform <= capabilities_for(roles.SUPER_ADMIN)
    for role in (roles.SCHOOL_ADMIN, roles.TEACHER, roles.PARENT):
        assert not (platform & capabilities_for(role))


def test_checkout_paths_do_not_overlap():
    # B2B is the school admin's, B2C is the parent's, and neither may start the
    # other's.
    assert role_has(roles.SCHOOL_ADMIN, C.PAYMENT_B2B_CHECKOUT)
    assert not role_has(roles.SCHOOL_ADMIN, C.PAYMENT_B2C_CHECKOUT)
    assert role_has(roles.PARENT, C.PAYMENT_B2C_CHECKOUT)
    assert not role_has(roles.PARENT, C.PAYMENT_B2B_CHECKOUT)


def test_only_a_super_admin_issues_refunds():
    assert role_has(roles.SUPER_ADMIN, C.PAYMENT_REFUND_ISSUE)
    for role in (roles.SCHOOL_ADMIN, roles.TEACHER, roles.PARENT):
        assert not role_has(role, C.PAYMENT_REFUND_ISSUE)


def test_a_teacher_holds_no_billing_or_platform_capability():
    held = capabilities_for(roles.TEACHER)
    assert not any(c.startswith("payment.") for c in held)
    assert not any(c.startswith("platform.") for c in held)


def test_parent_portal_capabilities_are_the_parents_alone():
    parent_only = {
        C.PARENT_CHILD_LINK,
        C.PARENT_CHILDREN_LIST,
        C.PARENT_CHILD_REPORTS_READ,
        C.PARENT_CHILD_UNLINK,
    }
    assert parent_only <= capabilities_for(roles.PARENT)
    for role in (roles.SUPER_ADMIN, roles.SCHOOL_ADMIN, roles.TEACHER):
        assert not (parent_only & capabilities_for(role))
