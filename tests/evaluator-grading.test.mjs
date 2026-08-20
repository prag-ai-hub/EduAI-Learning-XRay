import test from "node:test";
import assert from "node:assert/strict";
import { validateEvaluationSubmission } from "../lib/evaluator-grading.ts";

const valid = () => ({
  assessmentId: "assessment-1", fileId: "file-1", studentName: "Student One", assessmentVersion: 1,
  expectedMaxMarks: 2, evaluatorConfirmation: true, idempotencyKey: "evaluation:assessment-1:file-1:v1",
  pages: [{ pageNumber: 1, disposition: "contains_reviewed_answer" }],
  questions: [
    { id: "q1", label: "Question 1", attemptState: "attempted", awardedMarks: 1.5, maxMarks: 2, allowedIncrement: .5, evidence: "The method is correct; the final value is incomplete.", rationale: "One step is missing.", confidence: .82, aiDisposition: "edited", reviewed: true },
  ],
});

test("server validation recomputes a valid evaluator total", () => {
  const result = validateEvaluationSubmission(valid());
  assert.equal(result.valid, true);
  assert.equal(result.totalAwarded, 1.5);
  assert.equal(result.totalMaximum, 2);
});

test("submission is blocked until every question is reviewed", () => {
  const input = valid(); input.questions[0].reviewed = false;
  const result = validateEvaluationSubmission(input);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(error => error.includes("evaluator review is required")));
});

test("not attempted remains distinct and cannot receive marks", () => {
  const input = valid(); input.questions[0].attemptState = "not_attempted"; input.questions[0].awardedMarks = .5;
  const result = validateEvaluationSubmission(input);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(error => error.includes("not attempted must award zero")));
});

test("invalid increments and mismatched assessment totals are rejected", () => {
  const input = valid(); input.questions[0].awardedMarks = 1.3; input.expectedMaxMarks = 3;
  const result = validateEvaluationSubmission(input);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(error => error.includes("increments of 0.5")));
  assert.ok(result.errors.some(error => error.includes("do not match the assessment total")));
});

test("malformed AI increment metadata falls back to half marks", () => {
  const input = valid(); input.questions[0].allowedIncrement = 3.5;
  const result = validateEvaluationSubmission(input);
  assert.equal(result.valid, true);
  assert.ok(!result.errors.some(error => error.includes("increments of 3.5")));
});
