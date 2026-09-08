"""Input sanitisation: what a typed string may contain by the time it lands.

Each threat here was reproduced against the unguarded code first, so every test
in the first half failed before apps/common/validators.py existed. The second
half is the other side of the bargain - the AI proxy carries prompt text and
base64 blobs where newlines, tabs and unusual Unicode are the content, and an
over-eager sanitiser there breaks grading rather than protecting anything.

Escapes rather than literals throughout: a real RLO in this file would reorder
the source you are reading.
"""

from __future__ import annotations

import unicodedata
import uuid
from unittest.mock import patch

import httpx
import pytest
from django.core import mail
from django.db.utils import DataError
from django.test import override_settings
from django.utils import timezone
from rest_framework import serializers

from apps.accounts.roles import SCHOOL_ADMIN, SUPER_ADMIN, TEACHER
from apps.common.serializers import BaseSerializer
from apps.common.validators import check_json_shape, sanitise_text
from apps.platform.aiproxy.serializers import CompletionSerializer, OcrSerializer
from apps.tenants.schools.models import School

pytestmark = pytest.mark.django_db

REGISTER = "/api/v1/schools/register"

RLO = "\u202e"  # right-to-left override
PDF_MARK = "\u202c"  # pop directional formatting
ZWSP = "\u200b"
ZWNJ = "\u200c"


def registration(name="Nehru Vidyalaya", **over):
    return {"name": name, "admin_name": "S. Rao", **over}


def register(make_identity, api_client_for, **over):
    subject, email = make_identity()
    return api_client_for(identity=(subject, email)).post(
        REGISTER, registration(**over), format="json"
    )


# --- what a NUL byte costs ---------------------------------------------------


def test_postgres_will_not_store_a_nul_byte(db):
    """The premise the guards are built on, asserted rather than assumed.

    A NUL that reaches a write is a DataError from the driver, which is a 500
    on a request that should have been a 400.
    """
    now = timezone.now()
    with pytest.raises(DataError):
        School.objects.create(
            id=f"school-{uuid.uuid4()}",
            name="Nehru\x00Vidyalaya",
            settings_json={},
            status=School.Status.PENDING,
            created_at=now,
            updated_at=now,
        )


def test_a_nul_byte_in_a_json_key_is_refused():
    # DRF's CharField refuses NUL in a *value*. A DictField's keys are not a
    # CharField and were validated by nothing at all.
    serializer = CompletionSerializer(
        data={
            "messages": [{"role": "user", "content": "Grade this."}],
            "response_format": {"ty\x00pe": "json_object"},
        }
    )
    assert not serializer.is_valid()
    assert "response_format" in serializer.errors


# --- deception on the approval screen ----------------------------------------


def test_a_bidi_override_in_a_school_name_is_refused(make_identity, api_client_for):
    # "Nehru <RLO>gnidnep" renders as "Nehru pending" to the Super Admin
    # deciding whether to approve it.
    response = register(make_identity, api_client_for, name=f"Nehru {RLO}gnidnep{PDF_MARK}")
    assert response.status_code == 400
    assert "name" in response.json()["error"]["detail"]


def test_a_bidi_override_in_a_decision_reason_is_refused(make_school, make_user, api_client_for):
    school = make_school(status=School.Status.PENDING)
    response = api_client_for(make_user(SUPER_ADMIN)).post(
        f"/api/v1/schools/{school.id}/reject/",
        {"reason": f"Billing {RLO}detupsid{PDF_MARK} repeatedly."},
        format="json",
    )
    assert response.status_code == 400
    school.refresh_from_db()
    assert school.status == School.Status.PENDING


@pytest.mark.parametrize("control", ["\x07", "\x1b", "\x0b", "\x85"])
def test_control_characters_in_a_school_name_are_refused(make_identity, api_client_for, control):
    response = register(make_identity, api_client_for, name=f"Nehru{control} Vidyalaya")
    assert response.status_code == 400


# --- newlines and the email header -------------------------------------------


def test_a_newline_in_a_school_name_is_refused(make_identity, api_client_for):
    response = register(
        make_identity, api_client_for, name="Nehru\nBcc: attacker@evil.test\nVidyalaya"
    )
    assert response.status_code == 400
    assert School.objects.filter(name__contains="attacker").count() == 0


def test_a_trailing_newline_is_absorbed_rather_than_refused(make_identity, api_client_for):
    # A name pasted out of a spreadsheet is an accident worth trimming. One
    # with a break in the middle of it is not.
    response = register(make_identity, api_client_for, name="Nehru Vidyalaya\n")
    assert response.status_code == 201
    assert response.json()["school"]["name"] == "Nehru Vidyalaya"


def test_a_newline_in_a_name_would_lose_every_lifecycle_email(make_school, make_user):
    """Why the guard above is at the serializer and not in notifications.py.

    This is the harm, not the fix: it holds with or without the serializer
    guard, because it bypasses the serializer entirely. Django refuses a header
    containing a newline, `notify` swallows the failure so a decision is never
    undone by SMTP, and the school is simply never told what happened.
    """
    from apps.tenants.schools import notifications

    school = make_school(name="Nehru\nBcc: attacker@evil.test")
    make_user(SCHOOL_ADMIN, school=school)
    mail.outbox.clear()

    assert notifications.notify(school, "approved") == 0
    assert mail.outbox == []


# --- one value per name -------------------------------------------------------


def test_an_accented_name_is_stored_in_one_form(make_identity, api_client_for):
    # "Néhru" typed as e + combining acute, and "Néhru" typed as a single
    # codepoint, are one school, not two.
    decomposed = unicodedata.normalize("NFD", "Néhru Vidyalaya")
    response = register(make_identity, api_client_for, name=decomposed)
    assert response.status_code == 201
    stored = response.json()["school"]["name"]
    assert stored == unicodedata.normalize("NFC", "Néhru Vidyalaya")
    assert stored != decomposed


# --- invisible characters -----------------------------------------------------


def test_a_name_made_of_invisible_characters_is_not_a_name(make_identity, api_client_for):
    # Four zero-width spaces passed every "is it blank" and "is it long enough"
    # check the serializer had.
    response = register(make_identity, api_client_for, name=ZWSP * 4)
    assert response.status_code == 400
    assert "name" in response.json()["error"]["detail"]


def test_an_invisible_character_inside_a_name_is_removed(make_identity, api_client_for):
    response = register(make_identity, api_client_for, name=f"Neh{ZWSP}ru Vidyalaya")
    assert response.status_code == 201
    assert response.json()["school"]["name"] == "Nehru Vidyalaya"


def test_a_devanagari_joiner_is_content_and_survives(make_identity, api_client_for):
    # ZWNJ changes how a conjunct renders. Stripping it as "invisible" would
    # misspell the name of a school that writes in Devanagari.
    name = f"नेहरू{ZWNJ}विद्यालय"
    response = register(make_identity, api_client_for, name=name)
    assert response.status_code == 201
    assert response.json()["school"]["name"] == name


# --- the shape of a JSON body -------------------------------------------------


def test_a_deeply_nested_payload_is_refused():
    deep = cursor = {}
    for _ in range(40):
        cursor["a"] = {}
        cursor = cursor["a"]
    serializer = CompletionSerializer(
        data={"messages": [{"role": "user", "content": "x"}], "response_format": deep}
    )
    assert not serializer.is_valid()


def test_a_payload_carrying_too_many_values_is_refused():
    serializer = CompletionSerializer(
        data={
            "messages": [{"role": "user", "content": "x"}],
            "response_format": {f"k{index}": "v" for index in range(5000)},
        }
    )
    assert not serializer.is_valid()


def test_a_nesting_depth_a_grading_schema_needs_is_still_accepted():
    # The ceiling has to clear real use: a json_schema response format nests
    # around nine levels before anyone has done anything unusual.
    schema = {
        "type": "json_schema",
        "json_schema": {
            "name": "grade",
            "schema": {
                "type": "object",
                "properties": {
                    "questions": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {"marks": {"type": "integer"}},
                        },
                    }
                },
            },
        },
    }
    check_json_shape(schema)


def test_redact_bounds_the_number_of_labels():
    serializer = CompletionSerializer(
        data={
            "messages": [{"role": "user", "content": "x"}],
            "redact": {f"label_{index}": "Aarav Rao" for index in range(500)},
        }
    )
    assert not serializer.is_valid()
    assert "redact" in serializer.errors


def test_redact_bounds_the_length_of_a_label():
    serializer = CompletionSerializer(
        data={
            "messages": [{"role": "user", "content": "x"}],
            "redact": {"k" * 5000: "Aarav Rao"},
        }
    )
    assert not serializer.is_valid()
    assert "redact" in serializer.errors


def test_a_handful_of_labels_is_still_accepted():
    serializer = CompletionSerializer(
        data={
            "messages": [{"role": "user", "content": "Grade Aarav Rao."}],
            "redact": {"student_name": "Aarav Rao", "parent_name": "M. Rao"},
        }
    )
    assert serializer.is_valid(), serializer.errors


# --- covered without asking ---------------------------------------------------


def test_a_serializer_written_later_is_covered_by_default():
    """The property the base class exists for.

    Nothing below declares a validator, a sanitiser or an opt-in. This is the
    test that fails if someone moves the cleaning into a CharField subclass.
    """

    class LaterSerializer(BaseSerializer):
        title = serializers.CharField(max_length=100)

    assert not LaterSerializer(data={"title": f"Report {RLO}detcejer{PDF_MARK}"}).is_valid()
    assert not LaterSerializer(data={"title": "Report\nBcc: x@y.test"}).is_valid()
    assert not LaterSerializer(data={"title": ZWSP * 3}).is_valid()


def test_sanitise_text_allows_line_breaks_only_where_asked():
    assert sanitise_text("one\ntwo", multiline=True) == "one\ntwo"
    with pytest.raises(serializers.ValidationError):
        sanitise_text("one\ntwo")


# --- the AI proxy is not a school name ----------------------------------------

CONFIGURED = {"OPENAI_API_KEY": "sk-test-not-a-real-key", "OPENAI_MODEL": "gpt-test"}
AI_URL = "/api/v1/ai/completions"
OCR_URL = "/api/v1/ai/ocr"

# Everything a school name is refused for, and every one of them legitimate in
# a student's transcribed answer: hard line breaks, tabs, decomposed accents,
# indentation that carries meaning in the child's working.
PROMPT = f"Q1.\n\tx = 2\n\nQ2. Café\n{ZWSP}Working:  \n"


def provider_reply(content="Revise fractions."):
    def _post(self, url, **kwargs):
        _post.sent = kwargs.get("json")
        return httpx.Response(
            200,
            json={
                "choices": [{"message": {"content": content}}],
                "model": "gpt-test",
                "usage": {"prompt_tokens": 11, "completion_tokens": 5},
            },
            request=httpx.Request("POST", url),
        )

    return _post


@override_settings(**CONFIGURED)
def test_prompt_text_reaches_the_provider_byte_for_byte(make_school, make_user, api_client_for):
    # Grading is judged on exactly what the child wrote. Trimming or normalising
    # here would change the text being marked.
    sender = provider_reply()
    with patch.object(httpx.Client, "post", sender):
        response = api_client_for(make_user(TEACHER, school=make_school())).post(
            AI_URL, {"messages": [{"role": "user", "content": PROMPT}]}, format="json"
        )
    assert response.status_code == 200
    assert sender.sent["messages"][0]["content"] == PROMPT


@override_settings(**CONFIGURED)
def test_a_nested_exemption_is_not_overruled_by_its_parent():
    # The parent sanitising `messages` wholesale would undo MessageSerializer's
    # exemption before the child ever saw the payload.
    serializer = CompletionSerializer(data={"messages": [{"role": "user", "content": PROMPT}]})
    assert serializer.is_valid(), serializer.errors
    assert serializer.validated_data["messages"][0]["content"] == PROMPT


@override_settings(MISTRAL_API_KEY="mk-test")
def test_an_ocr_data_url_is_passed_through_unrewritten(make_school, make_user, api_client_for):
    # Base64 is positional. A stripped trailing character is a corrupt file.
    data_url = "data:application/pdf;base64,JVBERi0xLjQK  "

    def _post(self, url, **kwargs):
        _post.sent = kwargs.get("json")
        return httpx.Response(200, json={"pages": []}, request=httpx.Request("POST", url))

    with patch.object(httpx.Client, "post", _post):
        response = api_client_for(make_user(TEACHER, school=make_school())).post(
            OCR_URL, {"kind": "document", "data_url": data_url}, format="json"
        )
    assert response.status_code == 200
    assert _post.sent["document"]["document_url"] == data_url


def test_a_large_data_url_is_never_scanned_character_by_character():
    """The cost guard, asserted rather than trusted.

    A 15 MB blob run through the per-character Unicode pass would be paid for on
    every OCR call, to protect a value that is posted to a provider and never
    stored or rendered.
    """
    blob = "data:image/jpeg;base64," + ("A" * 1_000_000)
    seen = []

    def spy(value, *, multiline=False):
        seen.append(value)
        return value

    with patch("apps.common.serializers.sanitise", side_effect=spy):
        serializer = OcrSerializer(data={"kind": "image", "data_url": blob})
        assert serializer.is_valid(), serializer.errors

    assert serializer.validated_data["data_url"] == blob
    assert max((len(value) for value in seen if isinstance(value, str)), default=0) < 100
