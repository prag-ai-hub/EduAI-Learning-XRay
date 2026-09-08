-- M17 — remove evaluation snapshots from the audit trail
--
-- `public.audit_events` is the append-only record of privileged actions. Its
-- contract, stated in backend/apps/platform/audit/services.py, is that
-- `detail_json` holds enough to reconstruct a decision and nothing that carries
-- student PII, a prompt, or card data.
--
-- One writer did not honour it. The compatibility branch of the evaluation
-- submit route - taken only where `evaluation_versions` did not yet exist -
-- wrote `detail_json.snapshot`: the whole canonical evaluation, carrying the
-- student's name, the per-question evidence and the AI rationale. The role
-- matrix (docs/plan/01-ROLE-PERMISSION-MATRIX.md §2) keeps exactly that
-- material from Parents and from an ungranted SuperAdmin, and every SchoolAdmin
-- can read their own school's audit rows.
--
-- The route no longer writes it. This removes what was already written.
--
-- Deliberately narrow:
--   * only `evaluation.submitted` rows, only the `snapshot` key. The sibling
--     keys - idempotencyKey, assessmentId, fileId, evaluation - are how the
--     compatibility branch replays an idempotent submission, and dropping them
--     would turn a repeated submit into a duplicate.
--   * rows are edited, never deleted. An audit row is a record that the action
--     happened; deleting it to fix its payload would destroy the evidence the
--     table exists to hold. `content_hash` inside `evaluation` still ties the
--     record to what was submitted, and is not reversible.
--
-- Idempotent: `- 'snapshot'` on an object without that key is a no-op, and the
-- WHERE clause stops matching once the purge has run, so re-applying does
-- nothing and touches no rows.

update public.audit_events
   set detail_json = detail_json - 'snapshot'
 where action = 'evaluation.submitted'
   and jsonb_typeof(detail_json) = 'object'
   and detail_json ? 'snapshot';

do $$
declare
  remaining bigint;
begin
  select count(*) into remaining
    from public.audit_events
   where action = 'evaluation.submitted'
     and jsonb_typeof(detail_json) = 'object'
     and detail_json ? 'snapshot';

  if remaining <> 0 then
    raise exception 'M17 left % audit_events row(s) still carrying a snapshot', remaining;
  end if;
end $$;
