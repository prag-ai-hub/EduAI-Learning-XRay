"""No identifiable value may reach the model."""

import pytest

from apps.aiproxy.scrubbing import Redaction, scrub_messages


def test_a_value_is_replaced_by_a_placeholder():
    redaction = Redaction({"student_name": "Aarav Rao"})
    assert redaction.scrub("Student: Aarav Rao scored 8") == "Student: [STUDENT_NAME_1] scored 8"


def test_the_placeholder_maps_back_on_the_response():
    redaction = Redaction({"student_name": "Aarav Rao"})
    assert redaction.restore("[STUDENT_NAME_1] should revise fractions.") == (
        "Aarav Rao should revise fractions."
    )


def test_a_round_trip_is_lossless():
    redaction = Redaction({"student_name": "Aarav Rao"})
    original = "Aarav Rao wrote that Aarav Rao is confident."
    assert redaction.restore(redaction.scrub(original)) == original


def test_matching_ignores_case():
    # A model, or a teacher's own typing, will not preserve the exact casing.
    redaction = Redaction({"student_name": "Aarav Rao"})
    assert "Aarav" not in redaction.scrub("aarav rao and AARAV RAO")


def test_longer_values_are_replaced_first():
    # Replacing "Rao" first would leave "Aarav [SURNAME_1]" - half redacted.
    redaction = Redaction({"student_name": "Aarav Rao", "surname": "Rao"})
    scrubbed = redaction.scrub("Aarav Rao")
    assert "Aarav" not in scrubbed
    assert scrubbed.count("[") == 1


def test_every_message_body_is_scrubbed():
    redaction = Redaction({"student_name": "Aarav Rao"})
    messages = scrub_messages(
        [
            {"role": "system", "content": "Grade Aarav Rao fairly."},
            {"role": "user", "content": "Aarav Rao's answer sheet"},
        ],
        redaction,
    )
    assert all("Aarav" not in message["content"] for message in messages)
    assert [message["role"] for message in messages] == ["system", "user"]


def test_a_value_too_short_to_be_safe_is_ignored():
    # A one-character value would match inside half the words in the prompt.
    redaction = Redaction({"initial": "A"})
    assert not redaction
    assert redaction.scrub("A fair answer") == "A fair answer"


def test_blank_and_missing_values_are_ignored():
    assert not Redaction({"student_name": "  "})
    assert not Redaction({})
    assert not Redaction(None)


def test_leaked_reports_anything_that_survived():
    redaction = Redaction({"student_name": "Aarav Rao"})
    assert redaction.leaked("Aarav Rao") == ["Aarav Rao"]
    assert redaction.leaked(redaction.scrub("Aarav Rao")) == []


@pytest.mark.parametrize("label", ["student name", "student-name", "!!!"])
def test_labels_are_made_safe_for_a_placeholder(label):
    redaction = Redaction({label: "Aarav Rao"})
    placeholder = redaction.tokens[0]
    assert placeholder.startswith("[") and placeholder.endswith("]")
    assert " " not in placeholder
