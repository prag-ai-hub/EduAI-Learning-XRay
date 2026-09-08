"""Fixtures for the parent portal.

Three of the tables these tests need - `assessments`, `grade_results` and
`interventions` - have no Django model in this service. They belong to the
teaching surface, and the parent portal only reads them, so they are seeded with
SQL rather than by mapping tables this app has no business owning.

The seeded rows carry two deliberate canaries: `ocr_text` on the graded result,
and another child's name inside `interventions.plan_json`. Both are material the
role matrix keeps from a parent, and both are asserted absent from every parent
response rather than merely "not selected".
"""

from __future__ import annotations

import json
import uuid
from datetime import timedelta

import pytest
from django.core.cache import cache
from django.db import connection
from django.utils import timezone

#: Two strings that must never appear in anything a parent is sent.
OCR_CANARY = "RAW-OCR-TRANSCRIPT-CANARY"
OTHER_CHILD_CANARY = "Sibling-Of-Nobody-Canary"


@pytest.fixture(autouse=True)
def _clear_throttle_history():
    """Redemption is throttled per account, and the counters live in the cache.

    Every test here uses a fresh parent, so buckets do not collide - but a
    leaked one would fail the next run for no reason, and a cleared cache makes
    the throttle test deterministic rather than dependent on what ran before it.
    """
    cache.clear()
    yield
    cache.clear()


@pytest.fixture
def make_class(db):
    def _make(school, class_name="7", section="B", subject="Mathematics"):
        from apps.tenants.schools.models import SchoolClass

        now = timezone.now()
        return SchoolClass.objects.create(
            id=f"cls-{uuid.uuid4().hex[:20]}",
            school=school,
            academic_year="2026-27",
            class_name=class_name,
            section=section,
            subject=subject,
            created_at=now,
            updated_at=now,
        )

    return _make


@pytest.fixture
def make_invite(db):
    """A code in whatever state a test needs it in.

    `expires_at > created_at` is a CHECK, so an already-expired code is
    backdated rather than born expired - the same trick `make_grant` uses.
    """

    def _make(
        *,
        student,
        issuer,
        code=None,
        expires_in=timedelta(days=14),
        email=None,
        max_uses=1,
        used_count=0,
        revoked_at=None,
        relationship=None,
    ):
        from apps.tenants.parents.models import ParentInviteCode, Relationship
        from apps.tenants.parents.services import generate_code

        now = timezone.now()
        expires_at = now + expires_in
        created_at = min(now, expires_at - timedelta(minutes=1))
        return ParentInviteCode.objects.create(
            id=uuid.uuid4(),
            code=code or generate_code(),
            school_id=student.school_id,
            student_id=student.id,
            created_by_id=issuer.id,
            email=email,
            relationship=relationship or Relationship.MOTHER,
            max_uses=max_uses,
            used_count=used_count,
            expires_at=expires_at,
            revoked_at=revoked_at,
            created_at=created_at,
        )

    return _make


@pytest.fixture
def make_published_result(db):
    """One assessment, one graded result for a student, one generated resource.

    `published_at` is what `parent_child_reports` filters on, so `published`
    controls whether the parent should see this at all.
    """

    def _make(
        student,
        *,
        title="Fractions - unit test",
        subject="Mathematics",
        score="14.50",
        max_marks="20.00",
        feedback="Equivalent fractions are secure; comparison needs another pass.",
        gaps=None,
        published=True,
    ):
        assessment_id = f"asmt-{uuid.uuid4().hex[:16]}"
        result_id = f"gr-{uuid.uuid4().hex[:16]}"
        resource_id = f"res-{uuid.uuid4().hex[:16]}"
        published_at = timezone.now() if published else None

        with connection.cursor() as cursor:
            cursor.execute(
                """
                insert into public.assessments
                  (id, school_id, class_id, title, activity_type, subject, max_marks,
                   assessment_date, stage, version, quality, published)
                values (%s, %s, %s, %s, 'Assessment', %s, %s, current_date, 'report', 1, 0, true)
                """,
                [
                    assessment_id,
                    student.school_id,
                    student.school_class_id,
                    title,
                    subject,
                    max_marks,
                ],
            )
            cursor.execute(
                """
                insert into public.grade_results
                  (id, school_id, assessment_id, file_id, student_id, student_name,
                   score, max_marks, feedback, gaps_json, ocr_text,
                   question_decisions_json, teacher_status, grading_version, published_at)
                values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s, %s::jsonb,
                        'Approved', 1, %s)
                """,
                [
                    result_id,
                    student.school_id,
                    assessment_id,
                    f"file-{uuid.uuid4().hex[:12]}",
                    student.id,
                    student.name,
                    score,
                    max_marks,
                    feedback,
                    json.dumps(gaps if gaps is not None else [{"concept": "Comparing fractions"}]),
                    OCR_CANARY,
                    json.dumps([{"question": 1, "rationale": OCR_CANARY}]),
                    published_at,
                ],
            )
            cursor.execute(
                """
                insert into public.resources
                  (id, school_id, assessment_id, student_id, student_name, title,
                   resource_type, status, content_json, published_at)
                values (%s, %s, %s, %s, %s, 'Practice: comparing fractions',
                        'Worksheet', 'Saved', %s::jsonb, %s)
                """,
                [
                    resource_id,
                    student.school_id,
                    assessment_id,
                    student.id,
                    student.name,
                    json.dumps({"content": "Six graded practice questions."}),
                    published_at,
                ],
            )
        return assessment_id

    return _make


@pytest.fixture
def make_intervention(db):
    """An intervention on an assessment, with another child named in its plan."""

    def _make(assessment_id, *, concept="Comparing fractions", status="Planned"):
        intervention_id = f"iv-{uuid.uuid4().hex[:16]}"
        with connection.cursor() as cursor:
            cursor.execute(
                """
                insert into public.interventions
                  (id, assessment_id, concept, format, duration, status,
                   followup_date, plan_json)
                values (%s, %s, %s, 'Guided practice', '15 minutes', %s,
                        current_date + 7, %s::jsonb)
                """,
                [
                    intervention_id,
                    assessment_id,
                    concept,
                    status,
                    json.dumps({"group": [OTHER_CHILD_CANARY]}),
                ],
            )
        return intervention_id

    return _make
