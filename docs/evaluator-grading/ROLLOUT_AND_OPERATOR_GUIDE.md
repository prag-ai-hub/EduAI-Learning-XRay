# Rollout and operator guide

1. Apply `20260819000000_evaluator_grading_foundation.sql` to the configured Supabase project. Until it is applied, the server uses the existing append-only audit ledger as a compatibility store so evaluator submission remains safe and idempotent.
2. Confirm the four new tables exist and service-role access is available only to server routes.
3. Analyse a disposable assessment and confirm the evaluator workspace lists every printed question.
4. Verify an unchecked question, an over-maximum award, a disallowed increment, and a non-zero not-attempted answer are rejected.
5. Submit the corrected evaluation twice and confirm the second request replays the existing version rather than creating a duplicate.
6. Confirm all four reports begin only after successful submission and retain the submitted score.
7. Roll back the application if required; the additive tables can remain. Do not delete evaluation versions because they are audit records.

Operational limitation: moderation, finalized publication, per-page evidence, scan rejection, and integrity queues are not enabled in this increment. Continue existing authorized school procedures for those cases and do not treat a `submitted` version as a board-approved result.
