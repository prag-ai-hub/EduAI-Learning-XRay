"""Directory filtering, search and ordering.

The whitelists matter as much as the features: a caller must not be able to
order by, or filter on, a column simply because it exists.
"""

import pytest

from apps.accounts.roles import SUPER_ADMIN, TEACHER
from apps.schools.models import School

pytestmark = pytest.mark.django_db

LIST = "/api/v1/schools/"


@pytest.fixture
def directory(make_school, make_user, make_student):
    pending = make_school("Nehru Vidyalaya", status=School.Status.PENDING)
    pending.city, pending.board = "Pune", "CBSE"
    pending.save(update_fields=["city", "board"])

    active = make_school("Gandhi Public School", status=School.Status.ACTIVE)
    active.city, active.board = "Mumbai", "ICSE"
    active.save(update_fields=["city", "board"])

    make_user(TEACHER, school=active)
    make_student(active)
    make_student(active)
    return {"pending": pending, "active": active}


def names(response):
    return [row["name"] for row in response.json()["results"]]


def test_search_matches_a_school_name(directory, make_user, api_client_for):
    response = api_client_for(make_user(SUPER_ADMIN)).get(f"{LIST}?search=nehru")
    assert names(response) == ["Nehru Vidyalaya"]


@pytest.mark.parametrize("term", ["pune", "PUNE", "Pun"])
def test_search_matches_city_case_insensitively(directory, make_user, api_client_for, term):
    assert names(api_client_for(make_user(SUPER_ADMIN)).get(f"{LIST}?search={term}")) == [
        "Nehru Vidyalaya"
    ]


def test_search_matches_board(directory, make_user, api_client_for):
    assert names(api_client_for(make_user(SUPER_ADMIN)).get(f"{LIST}?search=ICSE")) == [
        "Gandhi Public School"
    ]


def test_search_matches_a_school_id_exactly(directory, make_user, api_client_for):
    school = directory["active"]
    assert names(api_client_for(make_user(SUPER_ADMIN)).get(f"{LIST}?search={school.id}")) == [
        school.name
    ]


def test_a_partial_id_is_not_a_search(directory, make_user, api_client_for):
    # ids are `school-{uuid}`; substring-matching a partial uuid is a fishing
    # expedition, not a search.
    fragment = directory["active"].id[:20]
    assert names(api_client_for(make_user(SUPER_ADMIN)).get(f"{LIST}?search={fragment}")) == []


def test_filters_combine(directory, make_user, api_client_for):
    client = api_client_for(make_user(SUPER_ADMIN))
    assert names(client.get(f"{LIST}?status=Active&city=Mumbai")) == ["Gandhi Public School"]
    assert names(client.get(f"{LIST}?status=Pending&city=Mumbai")) == []


def test_an_unknown_status_is_refused_rather_than_ignored(directory, make_user, api_client_for):
    # Silently returning everything for a typo'd filter is how a reviewer sees
    # the wrong queue and approves the wrong school.
    response = api_client_for(make_user(SUPER_ADMIN)).get(f"{LIST}?status=Approved")
    assert response.status_code == 400
    assert "status" in str(response.json())


def test_ordering_is_whitelisted(directory, make_user, api_client_for):
    client = api_client_for(make_user(SUPER_ADMIN))
    assert client.get(f"{LIST}?ordering=name").status_code == 200
    assert client.get(f"{LIST}?ordering=-name").status_code == 200
    # Not a column a caller gets to sort by.
    assert client.get(f"{LIST}?ordering=settings_json").status_code == 400
    assert client.get(f"{LIST}?ordering=approved_by").status_code == 400


def test_ordering_by_name_is_applied(directory, make_user, api_client_for):
    ordered = names(api_client_for(make_user(SUPER_ADMIN)).get(f"{LIST}?ordering=name"))
    assert ordered == sorted(ordered)


def test_the_default_order_is_newest_first(directory, make_user, api_client_for):
    rows = api_client_for(make_user(SUPER_ADMIN)).get(LIST).json()["results"]
    dates = [row["created_at"] for row in rows]
    assert dates == sorted(dates, reverse=True)


def test_counts_are_per_school_and_not_multiplied(directory, make_user, api_client_for):
    # Two joins without distinct=True return the product of the counts, so a
    # school with 1 user and 2 students reports 2 and 2.
    rows = {
        r["name"]: r for r in api_client_for(make_user(SUPER_ADMIN)).get(LIST).json()["results"]
    }
    active = rows["Gandhi Public School"]
    assert active["user_count"] == 1
    assert active["student_count"] == 2
    assert rows["Nehru Vidyalaya"]["user_count"] == 0


def test_an_over_long_search_is_refused(directory, make_user, api_client_for):
    response = api_client_for(make_user(SUPER_ADMIN)).get(f"{LIST}?search={'x' * 200}")
    assert response.status_code == 400


def test_filtering_does_not_widen_who_may_look(directory, make_user, api_client_for):
    teacher = make_user(TEACHER, school=directory["active"])
    assert api_client_for(teacher).get(f"{LIST}?search=nehru").status_code == 403
