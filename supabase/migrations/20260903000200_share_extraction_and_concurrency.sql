-- Resolves two baseline findings (docs/PROJECT_ANALYSIS.md §11 H3 and H6).
--
-- H6: /api/shares/[token] is a PUBLIC endpoint that loaded a teacher's ENTIRE
--     workspace_snapshots.state_json - every assessment, every OCR transcript,
--     every graded result for every student - in order to return one child's
--     report. Correct output, indefensible blast radius. The extraction now
--     happens inside Postgres and only the one student's slice leaves the
--     database.
--
-- H3: save_workspace_snapshot incremented a revision that no caller ever
--     checked, so two devices silently overwrote each other. The function now
--     accepts the revision the client last read and refuses a stale write.

-- ---------------------------------------------------------------------------
-- H6 — server-side extraction of one student's shared report
-- ---------------------------------------------------------------------------
create or replace function public.get_shared_student_report(
  p_workspace_id  text,
  p_assessment_id text,
  p_file_id       text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_assessment jsonb;
  v_result     jsonb;
  v_state      jsonb;
begin
  select state_json into v_state
    from public.workspace_snapshots
   where workspace_id = p_workspace_id;
  if v_state is null then return null; end if;

  select elem into v_assessment
    from jsonb_array_elements(coalesce(v_state->'assessments','[]'::jsonb)) elem
   where elem->>'id' = p_assessment_id
   limit 1;
  if v_assessment is null then return null; end if;

  v_result := v_assessment->'gradeResults'->p_file_id;
  if v_result is null then return null; end if;

  -- Only the fields the public page renders. Notably absent: ocrText,
  -- questionDecisions, AI rationale and every other student's result.
  return jsonb_build_object(
    'student', jsonb_build_object(
      'name', v_result->>'studentName',
      'className', 'Class ' || coalesce(v_assessment->>'className', v_assessment->>'grade', '')
                            || coalesce(v_assessment->>'section','')
    ),
    'assessment', jsonb_build_object(
      'id',       v_assessment->>'id',
      'title',    v_assessment->>'title',
      'subject',  v_assessment->>'subject',
      'date',     v_assessment->>'date',
      'score',    v_result->'score',
      'maxMarks', v_result->'maxMarks',
      'feedback', v_result->>'feedback',
      'gaps',     coalesce(v_result->'gaps','[]'::jsonb)
    ),
    'resources', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id',       r->>'id',
               'title',    r->>'title',
               'type',     r->>'type',
               'guide',    r->'guide',
               'content',  r->'content',
               'concepts', r->'concepts'))
        from jsonb_array_elements(coalesce(v_state->'resources','[]'::jsonb)) r
       where r->>'assessmentId' = p_assessment_id
         and r->>'studentName'  = v_result->>'studentName'
    ), '[]'::jsonb)
  );
end $$;

revoke all on function public.get_shared_student_report(text, text, text) from public, anon, authenticated;
grant execute on function public.get_shared_student_report(text, text, text) to service_role;

comment on function public.get_shared_student_report(text, text, text) is
  'Extracts one student''s shared report from a workspace snapshot inside the database, so a public share link never causes an entire teacher workspace to be read out.';

-- ---------------------------------------------------------------------------
-- H3 — optimistic concurrency on workspace writes
-- ---------------------------------------------------------------------------
create or replace function public.save_workspace_snapshot(
  p_workspace_id      text,
  p_state_json        jsonb,
  p_expected_revision bigint default null
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  current_revision bigint;
  next_revision    bigint;
begin
  select revision into current_revision
    from public.workspace_snapshots
   where workspace_id = p_workspace_id
   for update;

  -- Null means "first write" or a caller that has not adopted concurrency yet;
  -- such writes still succeed so the older client keeps working.
  if p_expected_revision is not null
     and current_revision is not null
     and current_revision <> p_expected_revision then
    raise exception 'workspace_revision_conflict: stored revision % does not match expected %',
      current_revision, p_expected_revision
      using errcode = '40001';
  end if;

  insert into public.workspace_snapshots (workspace_id, state_json, revision, updated_at)
  values (p_workspace_id, p_state_json, 1, now())
  on conflict (workspace_id) do update
  set state_json = excluded.state_json,
      revision   = public.workspace_snapshots.revision + 1,
      updated_at = now()
  returning revision into next_revision;

  return next_revision;
end $$;

revoke all on function public.save_workspace_snapshot(text, jsonb, bigint) from public, anon, authenticated;
grant execute on function public.save_workspace_snapshot(text, jsonb, bigint) to service_role;
