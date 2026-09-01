# Evaluator grading implementation map

## Implemented first vertical slice

| Requirement | Implementation |
|---|---|
| Question-level AI proposals | `/api/grade` now returns every question, attempt state, marks, evidence, rationale, confidence, and optional criteria. |
| Explicit human accountability | The grading dialog opens an evaluator workspace. Every question must be marked reviewed; edits are recorded as an edited AI disposition. |
| Deterministic submission gate | `lib/evaluator-grading.ts` validates completeness, allowed increments, maximums, attempt-state semantics, evidence, rationales, page dispositions, and recomputed totals. |
| Server-owned total | `/api/evaluations/submit` ignores client aggregate totals and derives the score from question decisions. |
| Immutable version | `evaluation_versions` stores a canonical snapshot, SHA-256 hash, version number, evaluator, and submission time. Idempotency prevents duplicate submissions. |
| Traceability | Submission writes an append-only `evaluation.submitted` audit event. Grade results retain the evaluation version ID and question decisions. |
| Report gate | Background reports start only after the immutable submission succeeds. |
| Compatibility | Existing assessments and workspace snapshots remain readable. The schema is additive. |

## Explicitly deferred slices

- Page-image viewer, answer-region bounding boxes, page-by-page annotations, autosaved drafts, and conflict recovery.
- Scan rejection/remediation and restricted suspected-integrity case queues.
- Assignment leases, durable job queue, retries, dead letters, and reassignment.
- Moderator comparison, sampling/risk routing, amendment authorization, and calibration.
- Finalized/published lifecycle enforcement, mastery-observation regeneration, and stale report propagation.

These are not represented as complete in the UI or operator documentation.
