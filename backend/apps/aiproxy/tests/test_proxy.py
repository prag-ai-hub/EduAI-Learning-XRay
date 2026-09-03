"""The proxy holds the key, and the provider never sees a child's name."""

from unittest.mock import patch

import httpx
import pytest
from django.test import override_settings
from rest_framework.test import APIClient

from apps.accounts.roles import PARENT, SCHOOL_ADMIN, SUPER_ADMIN, TEACHER

pytestmark = pytest.mark.django_db

URL = "/api/v1/ai/completions"
CONFIGURED = {"OPENAI_API_KEY": "sk-test-not-a-real-key", "OPENAI_MODEL": "gpt-test"}


def provider_reply(content="Revise fractions.", status=200):
    def _post(self, url, **kwargs):
        _post.sent = kwargs.get("json")
        _post.headers = kwargs.get("headers")
        return httpx.Response(
            status,
            json={
                "choices": [{"message": {"content": content}}],
                "model": "gpt-test",
                "usage": {"prompt_tokens": 11, "completion_tokens": 5},
            },
            request=httpx.Request("POST", url),
        )

    return _post


def body(**over):
    return {"messages": [{"role": "user", "content": "Grade this."}], **over}


# --- who may use it ---------------------------------------------------------


@override_settings(**CONFIGURED)
def test_a_teacher_may_use_the_proxy(make_school, make_user, api_client_for):
    with patch.object(httpx.Client, "post", provider_reply()):
        response = api_client_for(make_user(TEACHER, school=make_school())).post(
            URL, body(), format="json"
        )
    assert response.status_code == 200
    assert response.json()["content"] == "Revise fractions."


@pytest.mark.parametrize("role", [SUPER_ADMIN, SCHOOL_ADMIN, PARENT])
@override_settings(**CONFIGURED)
def test_no_other_role_may_spend_the_ai_budget(make_school, make_user, api_client_for, role):
    user = make_user(role, school=make_school() if role == SCHOOL_ADMIN else None)
    assert api_client_for(user).post(URL, body(), format="json").status_code == 403


def test_an_anonymous_caller_is_refused():
    assert APIClient().post(URL, body(), format="json").status_code in (401, 403)


# --- the key never escapes --------------------------------------------------


@override_settings(**CONFIGURED)
def test_the_api_key_is_never_returned(make_school, make_user, api_client_for):
    with patch.object(httpx.Client, "post", provider_reply()):
        response = api_client_for(make_user(TEACHER, school=make_school())).post(
            URL, body(), format="json"
        )
    assert "sk-test-not-a-real-key" not in response.content.decode()


@override_settings(**CONFIGURED)
def test_the_caller_cannot_choose_the_model(make_school, make_user, api_client_for):
    # Naming the model would turn the proxy into an open tap on someone's bill.
    sender = provider_reply()
    with patch.object(httpx.Client, "post", sender):
        response = api_client_for(make_user(TEACHER, school=make_school())).post(
            URL, body(model="gpt-4-expensive"), format="json"
        )
    assert response.status_code == 400
    assert "model" in str(response.json())


@override_settings(OPENAI_API_KEY="", OPENAI_MODEL="")
def test_an_unconfigured_environment_says_so(make_school, make_user, api_client_for):
    response = api_client_for(make_user(TEACHER, school=make_school())).post(
        URL, body(), format="json"
    )
    assert response.status_code == 503


# --- redaction ---------------------------------------------------------------


@override_settings(**CONFIGURED)
def test_a_student_name_never_reaches_the_provider(make_school, make_user, api_client_for):
    sender = provider_reply(content="[STUDENT_NAME_1] should revise fractions.")
    with patch.object(httpx.Client, "post", sender):
        response = api_client_for(make_user(TEACHER, school=make_school())).post(
            URL,
            body(
                messages=[{"role": "user", "content": "Grade Aarav Rao's paper."}],
                redact={"student_name": "Aarav Rao"},
            ),
            format="json",
        )

    assert response.status_code == 200
    outgoing = str(sender.sent)
    assert "Aarav" not in outgoing, "the name reached the provider"
    assert "[STUDENT_NAME_1]" in outgoing
    # ...and the caller still gets readable text back.
    assert response.json()["content"] == "Aarav Rao should revise fractions."


@override_settings(**CONFIGURED)
def test_the_request_is_refused_if_redaction_fails(make_school, make_user, api_client_for):
    # Sending the name anyway is not an acceptable fallback.
    with patch("apps.aiproxy.scrubbing.Redaction.scrub", side_effect=lambda text: text):
        with patch.object(httpx.Client, "post", provider_reply()) as sender:
            response = api_client_for(make_user(TEACHER, school=make_school())).post(
                URL,
                body(
                    messages=[{"role": "user", "content": "Grade Aarav Rao's paper."}],
                    redact={"student_name": "Aarav Rao"},
                ),
                format="json",
            )
    assert response.status_code == 500
    assert not getattr(sender, "sent", None), "the request was sent despite a failed scrub"


# --- provider failures -------------------------------------------------------


@override_settings(**CONFIGURED)
def test_a_provider_error_becomes_a_bad_gateway(make_school, make_user, api_client_for):
    with patch.object(httpx.Client, "post", provider_reply(status=500)):
        response = api_client_for(make_user(TEACHER, school=make_school())).post(
            URL, body(), format="json"
        )
    assert response.status_code == 502


@override_settings(**CONFIGURED)
def test_a_network_failure_becomes_a_bad_gateway(make_school, make_user, api_client_for):
    def explode(self, url, **kwargs):
        raise httpx.ConnectTimeout("no route")

    with patch.object(httpx.Client, "post", explode):
        response = api_client_for(make_user(TEACHER, school=make_school())).post(
            URL, body(), format="json"
        )
    assert response.status_code == 502


# --- logging -----------------------------------------------------------------


@override_settings(**CONFIGURED)
def test_logs_carry_metadata_but_never_the_prompt(make_school, make_user, api_client_for, caplog):
    with caplog.at_level("INFO"), patch.object(httpx.Client, "post", provider_reply()):
        api_client_for(make_user(TEACHER, school=make_school())).post(
            URL,
            body(messages=[{"role": "user", "content": "Aarav Rao wrote a poem."}]),
            format="json",
        )
    logged = " ".join(record.getMessage() for record in caplog.records)
    assert "prompt_tokens=11" in logged
    assert "Aarav" not in logged
    assert "poem" not in logged


# --- OCR ---------------------------------------------------------------------

OCR_URL = "/api/v1/ai/ocr"
PDF = "data:application/pdf;base64,JVBERi0xLjQK"


def ocr_reply():
    def _post(self, url, **kwargs):
        _post.sent = kwargs.get("json")
        return httpx.Response(
            200,
            json={"pages": [{"markdown": "Q1. 4/5"}, {"markdown": "Q2. 3/5"}]},
            request=httpx.Request("POST", url),
        )

    return _post


@override_settings(MISTRAL_API_KEY="mk-test")
def test_ocr_sends_the_document_shape_for_a_pdf(make_school, make_user, api_client_for):
    sender = ocr_reply()
    with patch.object(httpx.Client, "post", sender):
        response = api_client_for(make_user(TEACHER, school=make_school())).post(
            OCR_URL, {"kind": "document", "data_url": PDF}, format="json"
        )
    assert response.status_code == 200
    assert sender.sent["document"]["type"] == "document_url"
    # Page markers survive: the evaluator UI cites a page number per question.
    assert "--- Page 1 ---" in response.json()["text"]
    assert response.json()["pages"] == 2


@override_settings(MISTRAL_API_KEY="mk-test")
def test_ocr_sends_the_image_shape_for_a_scan(make_school, make_user, api_client_for):
    sender = ocr_reply()
    with patch.object(httpx.Client, "post", sender):
        api_client_for(make_user(TEACHER, school=make_school())).post(
            OCR_URL,
            {"kind": "image", "data_url": "data:image/jpeg;base64,/9j/4AAQ"},
            format="json",
        )
    assert sender.sent["document"]["type"] == "image_url"


@override_settings(MISTRAL_API_KEY="mk-test")
def test_ocr_refuses_a_fetchable_address(make_school, make_user, api_client_for):
    # Handing the provider a URL it can fetch later is a different exposure
    # from handing it bytes once.
    response = api_client_for(make_user(TEACHER, school=make_school())).post(
        OCR_URL,
        {"kind": "document", "data_url": "https://example.com/answer-sheet.pdf"},
        format="json",
    )
    assert response.status_code == 400


@override_settings(MISTRAL_API_KEY="")
def test_ocr_reports_an_unconfigured_environment(make_school, make_user, api_client_for):
    response = api_client_for(make_user(TEACHER, school=make_school())).post(
        OCR_URL, {"kind": "document", "data_url": PDF}, format="json"
    )
    assert response.status_code == 503


@override_settings(MISTRAL_API_KEY="mk-test")
def test_only_a_teacher_may_run_ocr(make_user, api_client_for):
    response = api_client_for(make_user(SUPER_ADMIN)).post(
        OCR_URL, {"kind": "document", "data_url": PDF}, format="json"
    )
    assert response.status_code == 403


# --- model verification ------------------------------------------------------

HEALTH_URL = "/api/v1/ai/health"


@override_settings(**CONFIGURED)
def test_health_reports_a_model_the_account_actually_has(make_school, make_user, api_client_for):
    def _get(self, url, **kwargs):
        return httpx.Response(200, json={"id": "gpt-test"}, request=httpx.Request("GET", url))

    with patch.object(httpx.Client, "get", _get):
        body = api_client_for(make_user(TEACHER, school=make_school())).get(HEALTH_URL).json()
    assert body["model"]["ok"] is True
    assert body["openai_configured"] is True


@override_settings(**CONFIGURED)
def test_health_catches_a_model_the_key_cannot_use(make_school, make_user, api_client_for):
    # The failure this exists for: a reachable provider with a wrong model id
    # fails every grading run while the service looks healthy.
    def _get(self, url, **kwargs):
        return httpx.Response(404, json={}, request=httpx.Request("GET", url))

    with patch.object(httpx.Client, "get", _get):
        body = api_client_for(make_user(TEACHER, school=make_school())).get(HEALTH_URL).json()
    assert body["model"]["ok"] is False
    assert "not available to this API key" in body["model"]["error"]


@override_settings(**CONFIGURED)
def test_health_is_not_open_to_reconnaissance(make_user, api_client_for):
    # Which providers an account holds is not public information.
    assert api_client_for(make_user(SUPER_ADMIN)).get(HEALTH_URL).status_code == 403
