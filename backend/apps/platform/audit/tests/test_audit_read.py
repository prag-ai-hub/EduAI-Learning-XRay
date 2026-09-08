"""Reading the audit trail: who may, which rows, and what comes back in them.

Rows are written through the real `services.record()` wherever possible, so
these tests bind to the shape actually stored rather than to a hand-built row
that could drift away from it.
"""

from __future__ import annotations

import json
import uuid
from datetime import timedelta
from urllib.parse import quote

import pytest
from django.utils import timezone

from apps.accounts.roles import PARENT, SCHOOL_ADMIN, SUPER_ADMIN, TEACHER
from apps.platform.audit.models import AuditEvent
from apps.platform.audit.services import Action, record

pytestmark = pytest.mark.django_db

LIST = "/api/v1/audit/events/"


def write_event(school, action, *, actor=None, entity_type="school", detail=None, created_at=None):
    """One row, written by the production writer, optionally backdated.

    `record()` lets Postgres fill `created_at` with now(), which inside a test
    transaction is the same instant for every row - so anything about ordering
    or a date range has to set the column itself afterwards.
    """
    before = set(AuditEvent.objects.values_list("id", flat=True))
    record(
        action=action,
        school_id=school.id,
        actor_id=str(actor.id) if actor is not None else None,
        entity_type=entity_type,
        detail=detail,
    )
    event = AuditEvent.objects.exclude(id__in=before).get()
    if created_at is not None:
        AuditEvent.objects.filter(pk=event.pk).update(created_at=created_at)
        event.refresh_from_db()
    return event


@pytest.fixture
def trail(make_school, make_user):
    """Two schools with a history each, and the four kinds of caller."""
    school = make_school("Nehru Vidyalaya")
    other = make_school("Gandhi Public School")
    admin = make_user(SCHOOL_ADMIN, school=school)
    teacher = make_user(TEACHER, school=school)
    reviewer = make_user(SUPER_ADMIN)
    now = timezone.now()

    events = {
        "registered": write_event(
            school,
            Action.SCHOOL_REGISTERED,
            actor=admin,
            detail={"name": school.name, "city": "Pune", "board": "CBSE"},
            created_at=now - timedelta(days=3),
        ),
        "approved": write_event(
            school,
            Action.SCHOOL_APPROVED,
            actor=reviewer,
            detail={"from": "Pending", "to": "Active"},
            created_at=now - timedelta(days=2),
        ),
        "suspended": write_event(
            school,
            Action.SCHOOL_SUSPENDED,
            actor=reviewer,
            detail={"from": "Active", "to": "Suspended", "reason": "Repeated billing disputes."},
            created_at=now - timedelta(days=1),
        ),
        # What the older Next.js surface appends to the same table: an
        # evaluation snapshot carrying a named child's marks and AI rationale.
        "evaluation": write_event(
            school,
            "evaluation.submitted",
            actor=teacher,
            entity_type="evaluation_version",
            detail={
                "assessmentId": "assessment-1",
                "snapshot": {
                    "studentName": "Meera Iyer",
                    "questions": [{"id": "q1", "rationale": "Missed the second step."}],
                },
            },
            created_at=now - timedelta(hours=1),
        ),
        "other": write_event(other, Action.SCHOOL_REGISTERED, detail={"name": other.name}),
    }
    return {
        "school": school,
        "other": other,
        "admin": admin,
        "teacher": teacher,
        "reviewer": reviewer,
        "events": events,
        "now": now,
    }


def moment(value) -> str:
    """A timestamp as a client would send it - `+00:00` is not a query string."""
    return quote(value.isoformat(), safe="")


def rows(response):
    assert response.status_code == 200, response.json()
    return response.json()["results"]


def actions(response):
    return [row["action"] for row in rows(response)]


# --- who may read the trail -------------------------------------------------


def test_a_school_admin_reads_their_own_school_and_nothing_else(trail, api_client_for):
    response = api_client_for(trail["admin"]).get(LIST)
    seen = rows(response)
    assert seen, "the school's own history should be visible"
    assert {row["school_id"] for row in seen} == {trail["school"].id}
    assert trail["events"]["other"].id not in {row["id"] for row in seen}


@pytest.mark.parametrize("role", [TEACHER, PARENT])
def test_teachers_and_parents_are_denied(trail, make_school, make_user, api_client_for, role):
    # Neither role holds platform.audit.read, so the refusal is at the
    # capability, before any question of which rows.
    user = make_user(role, school=trail["school"] if role == TEACHER else None)
    assert api_client_for(user).get(LIST).status_code == 403


def test_an_anonymous_caller_cannot_read_the_trail():
    from rest_framework.test import APIClient

    assert APIClient().get(LIST).status_code in (401, 403)


def test_a_super_admin_reads_every_school_without_a_support_grant(trail, api_client_for):
    # The deliberate SuperAdminScope.ALL - see the view's module docstring. The
    # reviewer holds no grant over either school.
    seen = rows(api_client_for(trail["reviewer"]).get(LIST))
    school_ids = {row["school_id"] for row in seen}
    assert {trail["school"].id, trail["other"].id} <= school_ids


def test_a_school_admin_cannot_retrieve_another_schools_row(trail, api_client_for):
    other = trail["events"]["other"]
    response = api_client_for(trail["admin"]).get(f"{LIST}{other.id}/")
    assert response.status_code == 404
    assert api_client_for(trail["reviewer"]).get(f"{LIST}{other.id}/").status_code == 200


# --- what a row discloses ---------------------------------------------------


def test_a_row_this_service_wrote_keeps_its_detail(trail, api_client_for):
    seen = rows(api_client_for(trail["admin"]).get(f"{LIST}?action={Action.SCHOOL_SUSPENDED}"))
    assert len(seen) == 1
    assert seen[0]["detail"] == {
        "from": "Active",
        "to": "Suspended",
        "reason": "Repeated billing disputes.",
    }
    assert seen[0]["detail_redacted"] is False
    assert seen[0]["actor_id"] == str(trail["reviewer"].id)


@pytest.mark.parametrize("reader", ["admin", "reviewer"])
def test_a_foreign_rows_payload_is_never_returned(trail, api_client_for, reader):
    # The Next.js evaluation row holds a child's name and the AI rationale.
    # Neither reader may have it out of this endpoint, grant or no grant.
    response = api_client_for(trail[reader]).get(f"{LIST}?action=evaluation.submitted")
    seen = rows(response)
    assert [row["id"] for row in seen] == [trail["events"]["evaluation"].id]
    assert seen[0]["detail"] == {}
    assert seen[0]["detail_redacted"] is True
    body = json.dumps(response.json())
    assert "Meera Iyer" not in body
    assert "rationale" not in body
    # The row is still usable as evidence that the submission happened.
    assert seen[0]["entity_type"] == "evaluation_version"


# --- filtering --------------------------------------------------------------


def test_action_filters_exactly_rather_than_by_prefix(trail, api_client_for):
    client = api_client_for(trail["admin"])
    assert actions(client.get(f"{LIST}?action={Action.SCHOOL_APPROVED}")) == [
        Action.SCHOOL_APPROVED
    ]
    # "school" is a prefix of four stored actions and must match none of them.
    assert rows(client.get(f"{LIST}?action=school")) == []


def test_entity_type_narrows(trail, api_client_for):
    seen = rows(api_client_for(trail["admin"]).get(f"{LIST}?entity_type=evaluation_version"))
    assert [row["id"] for row in seen] == [trail["events"]["evaluation"].id]


def test_actor_id_narrows_to_one_actor(trail, api_client_for):
    reviewer = trail["reviewer"]
    seen = rows(api_client_for(trail["admin"]).get(f"{LIST}?actor_id={reviewer.id}"))
    assert {row["actor_id"] for row in seen} == {str(reviewer.id)}
    assert sorted(row["action"] for row in seen) == sorted(
        [Action.SCHOOL_APPROVED, Action.SCHOOL_SUSPENDED]
    )


def test_an_actor_id_is_canonicalised_before_it_is_matched(trail, api_client_for):
    # The column is text, so an upper-case uuid would match nothing unless the
    # filter normalises it first.
    shouted = str(trail["reviewer"].id).upper()
    seen = rows(api_client_for(trail["admin"]).get(f"{LIST}?actor_id={shouted}"))
    assert len(seen) == 2


def test_the_created_at_range_narrows_at_both_ends(trail, api_client_for):
    client = api_client_for(trail["admin"])
    now = trail["now"]
    since = moment(now - timedelta(days=2, hours=1))
    until = moment(now - timedelta(hours=12))

    assert set(actions(client.get(f"{LIST}?created_from={since}"))) == {
        Action.SCHOOL_APPROVED,
        Action.SCHOOL_SUSPENDED,
        "evaluation.submitted",
    }
    assert set(actions(client.get(f"{LIST}?created_to={until}"))) == {
        Action.SCHOOL_REGISTERED,
        Action.SCHOOL_APPROVED,
        Action.SCHOOL_SUSPENDED,
    }
    assert set(actions(client.get(f"{LIST}?created_from={since}&created_to={until}"))) == {
        Action.SCHOOL_APPROVED,
        Action.SCHOOL_SUSPENDED,
    }


def test_the_range_ends_are_inclusive(trail, api_client_for):
    at = moment(trail["events"]["approved"].created_at)
    seen = rows(api_client_for(trail["admin"]).get(f"{LIST}?created_from={at}&created_to={at}"))
    assert [row["id"] for row in seen] == [trail["events"]["approved"].id]


# --- rejection rather than silence ------------------------------------------


@pytest.mark.parametrize(
    "query",
    [
        "school_id=school-1",  # the one that would look like proof of nothing
        "actor=someone",
        "entity_id=school-1",
        "detail_json=x",
    ],
)
def test_an_unknown_filter_is_rejected_not_ignored(trail, api_client_for, query):
    response = api_client_for(trail["admin"]).get(f"{LIST}?{query}")
    assert response.status_code == 400
    key = query.split("=")[0]
    assert key in response.json()["error"]["detail"]


@pytest.mark.parametrize(
    "query",
    [
        "actor_id=not-a-uuid",
        "created_from=yesterday",
        "created_to=2026-13-45",
        "ordering=actor_id",
        "ordering=detail_json",
    ],
)
def test_an_unusable_filter_value_is_rejected(trail, api_client_for, query):
    assert api_client_for(trail["admin"]).get(f"{LIST}?{query}").status_code == 400


def test_an_over_long_term_is_refused_before_the_database(trail, api_client_for):
    response = api_client_for(trail["admin"]).get(f"{LIST}?action={'a' * 200}")
    assert response.status_code == 400


def test_the_trail_cannot_be_written_through(trail, api_client_for):
    client = api_client_for(trail["reviewer"])
    approved = trail["events"]["approved"]
    assert client.post(LIST, {"action": "invented"}, format="json").status_code in (403, 405)
    assert client.delete(f"{LIST}{approved.id}/").status_code in (403, 405)
    assert AuditEvent.objects.filter(pk=approved.pk).exists()


# --- ordering and paging ----------------------------------------------------


def test_the_default_order_is_newest_first(trail, api_client_for):
    assert actions(api_client_for(trail["admin"]).get(LIST)) == [
        "evaluation.submitted",
        Action.SCHOOL_SUSPENDED,
        Action.SCHOOL_APPROVED,
        Action.SCHOOL_REGISTERED,
    ]


def test_the_order_can_be_reversed(trail, api_client_for):
    assert actions(api_client_for(trail["admin"]).get(f"{LIST}?ordering=created_at"))[0] == (
        Action.SCHOOL_REGISTERED
    )


def test_the_list_is_paginated(trail, api_client_for):
    body = api_client_for(trail["admin"]).get(f"{LIST}?page_size=2").json()
    assert body["count"] == 4
    assert len(body["results"]) == 2
    assert body["next"]


def test_rows_sharing_a_timestamp_come_back_in_a_settled_order(trail, api_client_for):
    # now() is the transaction clock, so a burst of events all carry the same
    # created_at and the sort is decided entirely by the tiebreak. Without one
    # the database is free to return them in whatever order it scanned them,
    # and a page boundary landing inside the burst silently skips a row.
    school, admin = trail["school"], trail["admin"]
    written = [write_event(school, f"burst.{index}", actor=admin) for index in range(6)]
    shared = written[0].created_at
    assert {event.created_at for event in written} == {shared}

    seen = rows(api_client_for(admin).get(f"{LIST}?page_size=100"))
    burst = [row["id"] for row in seen if row["action"].startswith("burst.")]
    assert len(burst) == 6
    assert burst == sorted(burst), "equal timestamps must still have one settled order"


# --- the serialiser, directly -----------------------------------------------


def test_a_non_object_detail_is_treated_as_unvouched_for(make_school):
    from apps.platform.audit.serializers import visible_detail

    event = AuditEvent(
        id=str(uuid.uuid4()),
        school_id="school-x",
        action=Action.SCHOOL_APPROVED,
        entity_type="school",
        detail_json=["Meera Iyer"],
    )
    assert visible_detail(event) == ({}, True)
