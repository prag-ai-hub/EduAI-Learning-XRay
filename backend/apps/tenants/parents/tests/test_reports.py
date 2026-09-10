"""What a parent may read about a child (Day 13 task 3).

The role matrix is at its strictest here, and this is the surface most likely to
leak. A parent sees teacher-approved output: the score, the feedback, the
learning gaps and the generated resources. They do not see the raw scan, the OCR
transcript or the per-question AI rationale - those are absent from the role
rather than scoped to their own children (matrix §2, "Deliberate restrictions"),
because the product's claim is that the teacher, not the model, is the author of
the mark.

So the assertions below are not only "the right rows came back". They search the
whole serialised response for two canaries the fixtures plant - the OCR
transcript, and another child's name inside an intervention plan - because a
leak of that kind arrives as an extra key nobody asked for, and a field-by-field
assertion would not see it.
"""

import json

import pytest

from apps.accounts.roles import PARENT, SCHOOL_ADMIN, TEACHER

from .conftest import OCR_CANARY, OTHER_CHILD_CANARY

pytestmark = pytest.mark.django_db

REPORTS = "/api/v1/parents/reports"
CHILDREN = "/api/v1/parents/children/"


def body(response) -> str:
    return json.dumps(response.data, default=str)


@pytest.fixture
def linked_child(make_school, make_class, make_user, make_student, make_link):
    """A parent, their child in a class, and one published, graded assessment."""

    def _make(make_published_result, make_intervention=None, *, published=True):
        school = make_school()
        student = make_student(school, name="Meera Rao")
        student.school_class = make_class(school)
        student.save(update_fields=["school_class"])
        parent = make_user(PARENT)
        make_link(parent, student)
        assessment_id = make_published_result(student, published=published)
        if make_intervention is not None:
            make_intervention(assessment_id)
        return school, student, parent, assessment_id

    return _make


def test_a_parent_reads_their_child_s_approved_result(
    linked_child, make_published_result, api_client_for
):
    _, student, parent, _ = linked_child(make_published_result)

    response = api_client_for(parent).get(REPORTS)

    assert response.status_code == 200
    children = response.data["children"]
    assert len(children) == 1
    assert children[0]["studentId"] == student.id
    assert children[0]["className"] == "Class 7B"
    result = children[0]["results"][0]
    assert result["title"] == "Fractions - unit test"
    assert float(result["score"]) == 14.5
    assert result["gaps"] == [{"concept": "Comparing fractions"}]
    assert children[0]["resources"][0]["title"] == "Practice: comparing fractions"


def test_the_response_carries_no_ocr_text_and_no_ai_rationale(
    linked_child, make_published_result, make_intervention, api_client_for
):
    _, _, parent, _ = linked_child(make_published_result, make_intervention)
    client = api_client_for(parent)

    everything = body(client.get(REPORTS))
    one_child = body(client.get(f"{CHILDREN}{_child_id(client)}/reports/"))

    assert OCR_CANARY not in everything
    assert OCR_CANARY not in one_child


def test_an_intervention_plan_never_names_another_child(
    linked_child, make_published_result, make_intervention, api_client_for
):
    # interventions.plan_json belongs to a concept across a class and may name
    # the group it applies to. The columns selected describe the plan's shape
    # and schedule; the plan itself is not one of them.
    _, _, parent, _ = linked_child(make_published_result, make_intervention)

    response = api_client_for(parent).get(REPORTS)

    child = response.data["children"][0]
    assert child["classInterventions"][0]["concept"] == "Comparing fractions"
    assert child["classInterventions"][0]["status"] == "Planned"
    assert OTHER_CHILD_CANARY not in body(response)


def test_an_unpublished_result_is_not_a_parent_s_to_read(
    linked_child, make_published_result, api_client_for
):
    # published_at is what the teacher sets on approving. Until then the mark is
    # a draft, and a draft the parent has already seen cannot be withdrawn.
    _, _, parent, _ = linked_child(make_published_result, published=False)

    response = api_client_for(parent).get(REPORTS)

    assert response.data["children"][0]["results"] == []
    assert response.data["children"][0]["resources"] == []


def test_an_unlinked_parent_reads_nothing(
    make_school, make_user, make_student, make_published_result, api_client_for
):
    school = make_school()
    make_published_result(make_student(school, name="Meera Rao"))

    response = api_client_for(make_user(PARENT)).get(REPORTS)

    assert response.status_code == 200
    assert response.data["children"] == []


def test_a_parent_reads_one_child_by_id(
    linked_child, make_published_result, make_intervention, api_client_for
):
    _, student, parent, _ = linked_child(make_published_result, make_intervention)

    response = api_client_for(parent).get(f"{CHILDREN}{student.id}/reports/")

    assert response.status_code == 200
    assert response.data["child"]["studentId"] == student.id
    assert len(response.data["child"]["results"]) == 1
    assert len(response.data["child"]["classInterventions"]) == 1


def test_each_sibling_url_returns_that_sibling(
    linked_child, make_published_result, make_student, make_link, api_client_for
):
    """One parent, two children, and each URL has to pick its own.

    Every other per-child test links a parent to a SINGLE child, so the filter
    in `_reports_for` could be deleted and they would all still pass while
    `children/{B}/reports/` answered with A's marks. A parent seeing another of
    their own children is a smaller breach than seeing a stranger's, which is
    why nothing caught it - but it is still the wrong child under the wrong URL.

    BOTH directions are asserted deliberately. The view returns `payload[0]`,
    so with the filter removed every request answers with whichever child the
    read model happens to order first; checking one URL passes or fails on that
    ordering rather than on the behaviour. Checking both cannot: one of them is
    always the child that does not sort first.
    """
    school, first, parent, _ = linked_child(make_published_result)

    second = make_student(school, name="Kabir Rao")
    second.school_class = first.school_class
    second.save(update_fields=["school_class"])
    make_link(parent, second)
    make_published_result(
        second,
        title="Photosynthesis - unit test",
        subject="Science",
        score="17.00",
        feedback="Chlorophyll is understood; the gas exchange step needs another pass.",
    )

    client = api_client_for(parent)
    for student, expected, sibling in (
        (first, "Fractions - unit test", "Photosynthesis"),
        (second, "Photosynthesis - unit test", "Fractions"),
    ):
        response = client.get(f"{CHILDREN}{student.id}/reports/")

        assert response.status_code == 200
        assert response.data["child"]["studentId"] == student.id
        assert [r["title"] for r in response.data["child"]["results"]] == [expected]
        assert sibling not in body(response), (
            f"{student.name}'s URL answered with their sibling's assessment"
        )


def test_a_parent_cannot_read_another_child_s_report_by_id(
    linked_child, make_published_result, make_student, api_client_for
):
    school, _, parent, _ = linked_child(make_published_result)
    stranger = make_student(school, name="Arjun Nair")
    make_published_result(stranger)

    response = api_client_for(parent).get(f"{CHILDREN}{stranger.id}/reports/")

    assert response.status_code == 403
    assert "Arjun" not in body(response)


def test_one_parent_s_report_call_never_returns_another_parent_s_child(
    make_school, make_user, make_student, make_link, make_published_result, api_client_for
):
    school = make_school()
    mine, theirs = make_student(school, name="Meera Rao"), make_student(school, name="Arjun Nair")
    parent = make_user(PARENT)
    make_link(parent, mine)
    make_link(make_user(PARENT), theirs)
    make_published_result(mine)
    make_published_result(theirs)

    response = api_client_for(parent).get(REPORTS)

    assert [child["studentName"] for child in response.data["children"]] == ["Meera Rao"]
    assert "Arjun Nair" not in body(response)


def test_a_revoked_link_ends_the_reading_too(linked_child, make_published_result, api_client_for):
    _, student, parent, _ = linked_child(make_published_result)
    client = api_client_for(parent)
    client.post(f"{CHILDREN}{student.id}/unlink/", format="json")

    assert client.get(REPORTS).data["children"] == []
    assert client.get(f"{CHILDREN}{student.id}/reports/").status_code == 403


@pytest.mark.parametrize("role", [TEACHER, SCHOOL_ADMIN])
def test_the_parent_report_surface_is_not_school_staff_s(
    make_school, make_user, api_client_for, role
):
    # Staff read student reports through the school surface, under their own
    # capability. parent.child.reports.read is not theirs to hold.
    caller = make_user(role, school=make_school())

    assert api_client_for(caller).get(REPORTS).status_code == 403


def _child_id(client) -> str:
    return client.get(CHILDREN).data["results"][0]["id"]
