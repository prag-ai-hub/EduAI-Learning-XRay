from rest_framework.test import APIClient


def test_health_is_reachable_without_a_token():
    # A liveness probe cannot hold credentials.
    response = APIClient().get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_health_reports_database_reachability_without_leaking_the_reason():
    body = APIClient().get("/health").json()
    assert body["database"] in {"ok", "unreachable"}
    # A connection string, host or driver error must never reach a caller.
    assert set(body) == {"status", "database"}


def test_an_unknown_route_is_not_served():
    assert APIClient().get("/api/v1/nope").status_code == 404
