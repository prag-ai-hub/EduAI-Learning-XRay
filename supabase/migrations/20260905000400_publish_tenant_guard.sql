-- M16 — publish_student_result must not write into another school's rows
--
-- The upserts in M11 conflict on client-generated ids: assessments on `id`, and
-- grade_results on (assessment_id, file_id, grading_version). Neither included
-- school_id in its `do update set`, so an existing row kept its original owner
-- while its contents were replaced by the caller's.
--
-- A teacher at school B publishing an assessment id that already exists at
-- school A therefore overwrote school A's title, subject, marks, student name,
-- score, feedback, gaps and OCR text - silently, with a 200 response. The row
-- stayed owned by school A, so school A kept reading it and school B could not,
-- which is how this surfaced: a rehydration request answered 403 for the
-- teacher who had just published.
--
-- Assessment ids are generated client-side as `a${Date.now()}`, so a collision
-- across two schools is unlikely but entirely possible - and nothing prevented
-- one being supplied deliberately.
--
-- Publication is now refused when the target belongs to another school. This is
-- the same rule Day 5 applied to /api/admin/users, which the publish path
-- predated.

create or replace function public.publish_student_result(
  p_school_id  text,
  p_teacher_id uuid,
  p_assessment jsonb,
  p_result     jsonb,
  p_resources  jsonb default '[]'::jsonb
)
returns table(out_assessment_id text, out_student_id text, out_grade_result_id text, out_resources_published integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assessment_id text := p_assessment->>'id';
  v_file_id       text := p_result->>'fileId';
  v_class_id      text;
  v_student_id    text;
  v_grade_id      text;
  v_version       integer := greatest(1, coalesce((p_result->>'evaluationVersion')::integer, 1));
  v_count         integer := 0;
  v_owner         text;
  r               jsonb;
begin
  if p_school_id is null or v_assessment_id is null or v_file_id is null then
    raise exception 'publish_student_result requires a school, assessment id and file id';
  end if;

  -- Tenant guard. Checked before anything is written, so a refused publish
  -- leaves no partial state behind.
  select school_id into v_owner from public.assessments where id = v_assessment_id;
  if v_owner is not null and v_owner <> p_school_id then
    raise exception 'Assessment % belongs to another school', v_assessment_id
      using errcode = '42501';
  end if;

  select school_id into v_owner
    from public.grade_results
   where assessment_id = v_assessment_id and file_id = v_file_id and grading_version = v_version;
  if v_owner is not null and v_owner <> p_school_id then
    raise exception 'This result belongs to another school'
      using errcode = '42501';
  end if;

  v_class_id := public.resolve_class(
    p_school_id,
    coalesce(p_assessment->>'className', p_assessment->>'grade'),
    p_assessment->>'section',
    p_assessment->>'subject',
    null,
    p_teacher_id);

  v_student_id := public.resolve_student(
    p_school_id, v_class_id, p_result->>'studentName', p_result->>'rollNumber');

  insert into public.assessments (
    id, school_id, class_id, title, activity_type, subject, max_marks,
    assessment_date, stage, version, answer_key, rubric, quality, published)
  values (
    v_assessment_id, p_school_id, v_class_id,
    coalesce(nullif(p_assessment->>'title',''), 'Untitled assessment'),
    coalesce(nullif(p_assessment->>'type',''), 'Assessment'),
    coalesce(nullif(p_assessment->>'subject',''), 'General'),
    coalesce((p_assessment->>'maxMarks')::numeric, (p_result->>'maxMarks')::numeric, 0),
    coalesce((p_assessment->>'date')::date, current_date),
    coalesce(nullif(p_assessment->>'stage',''), 'review'),
    coalesce((p_assessment->>'version')::integer, 1),
    p_assessment->>'answerKey', p_assessment->>'rubric',
    coalesce((p_assessment->>'quality')::integer, 0),
    coalesce((p_assessment->>'published')::boolean, false))
  on conflict (id) do update set
    class_id = coalesce(excluded.class_id, public.assessments.class_id),
    title = excluded.title, subject = excluded.subject, max_marks = excluded.max_marks,
    stage = excluded.stage, version = excluded.version, updated_at = now();

  v_grade_id := 'gr-' || substr(md5(v_assessment_id || '|' || v_file_id || '|' || v_version), 1, 24);

  insert into public.grade_results (
    id, school_id, assessment_id, file_id, student_id, student_name,
    question_paper_file_id, score, max_marks, feedback, gaps_json,
    ocr_text, question_decisions_json, evaluation_version_id,
    teacher_status, grading_version, published_at)
  values (
    v_grade_id, p_school_id, v_assessment_id, v_file_id, v_student_id,
    coalesce(nullif(p_result->>'studentName',''), 'Student'),
    p_result->>'questionPaperFileId',
    coalesce((p_result->>'score')::numeric, 0),
    coalesce((p_result->>'maxMarks')::numeric, 0),
    p_result->>'feedback',
    coalesce(p_result->'gaps', '[]'::jsonb),
    p_result->>'ocrText',
    p_result->'questionDecisions',
    nullif(p_result->>'evaluationVersionId','')::uuid,
    coalesce(nullif(p_result->>'evaluationStatus',''), 'Draft'),
    v_version, now())
  on conflict (assessment_id, file_id, grading_version) do update set
    student_id = coalesce(excluded.student_id, public.grade_results.student_id),
    student_name = excluded.student_name, score = excluded.score,
    max_marks = excluded.max_marks, feedback = excluded.feedback,
    gaps_json = excluded.gaps_json, ocr_text = excluded.ocr_text,
    question_decisions_json = excluded.question_decisions_json,
    evaluation_version_id = coalesce(excluded.evaluation_version_id, public.grade_results.evaluation_version_id),
    teacher_status = excluded.teacher_status, published_at = now(), updated_at = now()
  returning id into v_grade_id;

  for r in select * from jsonb_array_elements(coalesce(p_resources, '[]'::jsonb))
  loop
    continue when coalesce(r->>'id','') = '';
    select school_id into v_owner from public.resources where id = r->>'id';
    if v_owner is not null and v_owner <> p_school_id then
      raise exception 'Resource % belongs to another school', r->>'id' using errcode = '42501';
    end if;
    insert into public.resources (
      id, school_id, assessment_id, student_id, student_name,
      title, resource_type, status, content_json, published_at)
    values (
      r->>'id', p_school_id, v_assessment_id, v_student_id, p_result->>'studentName',
      coalesce(nullif(r->>'title',''), 'Resource'),
      coalesce(nullif(r->>'type',''), 'Resource'),
      coalesce(nullif(r->>'status',''), 'Saved'),
      jsonb_strip_nulls(jsonb_build_object(
        'guide',    r->'guide',
        'content',  r->'content',
        'concepts', r->'concepts',
        'subject',  r->>'subject',
        'grade',    r->>'grade')),
      now())
    on conflict (id) do update set
      school_id = excluded.school_id, assessment_id = excluded.assessment_id,
      student_id = coalesce(excluded.student_id, public.resources.student_id),
      student_name = excluded.student_name, title = excluded.title,
      resource_type = excluded.resource_type, status = excluded.status,
      content_json = excluded.content_json, published_at = now(), updated_at = now();
    v_count := v_count + 1;
  end loop;

  return query select v_assessment_id, v_student_id, v_grade_id, v_count;
end $$;

revoke all on function public.publish_student_result(text,uuid,jsonb,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.publish_student_result(text,uuid,jsonb,jsonb,jsonb) to service_role;
