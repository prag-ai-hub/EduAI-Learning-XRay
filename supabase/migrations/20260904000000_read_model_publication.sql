-- M11 — Normalized read model
--
-- Resolves H2 (docs/PROJECT_ANALYSIS.md §11): all application state lives in one
-- workspace_snapshots.state_json row capped at 4 MB. Measured against the real
-- data shapes that is ~31.7 KB per student per assessment, so the cap holds
-- about 129 student-assessments in total — one class of 30 over six
-- assessments exceeds it. Worse, the whole blob is re-uploaded 700 ms after any
-- edit, and the 413 surfaces in the UI as "Offline · queued" when nothing is
-- queued and no retry exists, so work is silently lost.
--
-- It is also why parents and SuperAdmin cannot read anything: a blob keyed by
-- one teacher is not queryable by anyone else.
--
-- This migration makes the finished, heavy data live in tables. The blob keeps
-- only drafts and a light reference.
--
-- Requires M5 (uuid identity), M7 (roles/school status), M8 (parent links).

-- ===========================================================================
-- Part 1 — Repair three defects that would corrupt or block publication
-- ===========================================================================

-- 1a. Scores are not integers. The evaluator awards half and quarter marks
--     (allowedIncrement is 0.25 / 0.5 / 1), so an integer column would round
--     14.5 to 14 or reject it outright.
alter table public.grade_results alter column score     type numeric(10,2);
alter table public.grade_results alter column max_marks type numeric(10,2);
alter table public.assessments   alter column max_marks type numeric(10,2);

-- 1b. grade_results.file_id references uploaded_files, but uploaded files live
--     in Supabase Storage under a client-generated id and uploaded_files is
--     never written. The foreign key would reject every publish.
alter table public.grade_results drop constraint if exists grade_results_file_id_fkey;

-- 1c. resources only linked to an intervention. Generated study guides and
--     worksheets belong to a student and an assessment, which is exactly what a
--     parent needs to query by.
alter table public.resources add column if not exists school_id     text references public.schools(id);
alter table public.resources add column if not exists assessment_id text references public.assessments(id) on delete cascade;
alter table public.resources add column if not exists student_id    text references public.students(id) on delete cascade;
alter table public.resources add column if not exists student_name  text;
alter table public.resources add column if not exists published_at  timestamptz;

alter table public.grade_results add column if not exists school_id             text references public.schools(id);
alter table public.grade_results add column if not exists ocr_text              text;
alter table public.grade_results add column if not exists question_decisions_json jsonb;
alter table public.grade_results add column if not exists evaluation_version_id uuid;
alter table public.grade_results add column if not exists published_at          timestamptz;

create index if not exists grade_results_school_idx    on public.grade_results(school_id);
create index if not exists grade_results_assessment_idx on public.grade_results(assessment_id);
create index if not exists resources_student_idx        on public.resources(student_id);
create index if not exists resources_school_idx         on public.resources(school_id);

-- ===========================================================================
-- Part 2 — Student identity
--
-- Today a student is free text: GradeResult.studentName is guessed from a
-- filename by guessStudentName(). "Mira Bose" and "mira  bose" are two people,
-- and a parent has nothing stable to link to. Publication has to resolve a name
-- to a durable record before it means anything.
-- ===========================================================================

create unique index if not exists students_school_class_name_idx
  on public.students (school_id, class_id, lower(btrim(regexp_replace(name, '\s+', ' ', 'g'))))
  where class_id is not null;

create unique index if not exists students_school_class_roll_idx
  on public.students (school_id, class_id, lower(btrim(roll_number)))
  where class_id is not null and roll_number is not null and btrim(roll_number) <> '';

create or replace function public.resolve_student(
  p_school_id text,
  p_class_id  text,
  p_name      text,
  p_roll      text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := btrim(regexp_replace(coalesce(p_name,''), '\s+', ' ', 'g'));
  v_roll text := nullif(btrim(coalesce(p_roll,'')), '');
  v_id   text;
begin
  if p_school_id is null or p_class_id is null or v_name = '' then
    return null;
  end if;

  -- A roll number is the school's own identifier and outranks a name that may
  -- have been guessed from a filename.
  if v_roll is not null then
    select id into v_id from public.students
     where school_id = p_school_id and class_id = p_class_id
       and lower(btrim(roll_number)) = lower(v_roll);
    if v_id is not null then
      update public.students set name = v_name, updated_at = now()
       where id = v_id and name <> v_name;
      return v_id;
    end if;
  end if;

  select id into v_id from public.students
   where school_id = p_school_id and class_id = p_class_id
     and lower(btrim(regexp_replace(name, '\s+', ' ', 'g'))) = lower(v_name);
  if v_id is not null then
    if v_roll is not null then
      update public.students set roll_number = v_roll, updated_at = now()
       where id = v_id and coalesce(roll_number,'') = '';
    end if;
    return v_id;
  end if;

  v_id := 'stu-' || replace(gen_random_uuid()::text, '-', '');
  insert into public.students (id, school_id, class_id, name, roll_number, status)
  values (v_id, p_school_id, p_class_id, v_name, v_roll, 'Active')
  on conflict do nothing;

  -- A concurrent publish may have inserted the same student first.
  if not found then
    select id into v_id from public.students
     where school_id = p_school_id and class_id = p_class_id
       and lower(btrim(regexp_replace(name, '\s+', ' ', 'g'))) = lower(v_name);
  end if;
  return v_id;
end $$;

-- Deterministic so repeated publishes of the same class converge on one row.
create or replace function public.resolve_class(
  p_school_id     text,
  p_class_name    text,
  p_section       text,
  p_subject       text,
  p_academic_year text default null,
  p_teacher_id    uuid default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_class   text := btrim(coalesce(p_class_name,''));
  v_section text := upper(btrim(coalesce(p_section,'')));
  v_subject text := btrim(coalesce(p_subject,''));
  v_id      text;
begin
  -- classes.class_name is constrained to 1..12 by M2. Legacy rows without a
  -- usable class are published without one rather than rejected.
  if p_school_id is null or v_class !~ '^([1-9]|1[0-2])$' or v_section = '' or v_subject = '' then
    return null;
  end if;

  v_id := 'cls-' || substr(md5(p_school_id || '|' || v_class || '|' || v_section || '|' || lower(v_subject)), 1, 24);

  insert into public.classes (id, school_id, academic_year, class_name, section, subject, teacher_id)
  values (v_id, p_school_id, coalesce(nullif(btrim(coalesce(p_academic_year,'')),''), '2026-27'),
          v_class, v_section, v_subject, p_teacher_id)
  on conflict (id) do update set updated_at = now();
  return v_id;
end $$;

-- ===========================================================================
-- Part 3 — Publication
--
-- One atomic call. Everything a student's report needs lands together, or
-- nothing does — a partially published result would show a parent a score with
-- no learning gaps.
-- ===========================================================================

create or replace function public.publish_student_result(
  p_school_id  text,
  p_teacher_id uuid,
  p_assessment jsonb,
  p_result     jsonb,
  p_resources  jsonb default '[]'::jsonb
)
-- OUT parameter names are deliberately prefixed. Unprefixed names like
-- assessment_id and student_id shadow columns of the tables written below, and
-- a column list inside ON CONFLICT cannot be table-qualified, so the shadowing
-- is unresolvable there. This is the same defect that made consume_credit
-- uncallable in M3 ("column reference used_credits is ambiguous").
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
  r               jsonb;
begin
  if p_school_id is null or v_assessment_id is null or v_file_id is null then
    raise exception 'publish_student_result requires a school, assessment id and file id';
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

-- ===========================================================================
-- Part 4 — Read paths
-- ===========================================================================

-- What a parent may see: teacher-approved output only. No OCR transcript, no
-- AI rationale, no other student — enforced by what this function selects, not
-- by the caller remembering to filter.
create or replace function public.parent_child_reports(p_parent_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(child order by child->>'studentName'), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'studentId',   s.id,
      'studentName', s.name,
      'rollNumber',  s.roll_number,
      'className',   'Class ' || coalesce(c.class_name,'') || coalesce(c.section,''),
      'schoolName',  sch.name,
      'results', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'assessmentId', g.assessment_id,
                 'title',        a.title,
                 'subject',      a.subject,
                 'date',         a.assessment_date,
                 'score',        g.score,
                 'maxMarks',     g.max_marks,
                 'feedback',     g.feedback,
                 'gaps',         g.gaps_json)
               order by a.assessment_date desc)
          from public.grade_results g
          join public.assessments a on a.id = g.assessment_id
         where g.student_id = s.id and g.published_at is not null), '[]'::jsonb),
      'resources', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', r.id, 'title', r.title, 'type', r.resource_type,
                 'content', r.content_json))
          from public.resources r
         where r.student_id = s.id and r.published_at is not null), '[]'::jsonb)
    ) as child
    from public.parent_student_links l
    join public.students s   on s.id = l.student_id
    left join public.classes c on c.id = s.class_id
    left join public.schools sch on sch.id = s.school_id
   where l.parent_user_id = p_parent_user_id and l.status = 'active'
  ) t;
$$;

-- What SuperAdmin may see by default: de-identified aggregates. No student
-- names anywhere in the output.
create or replace function public.platform_school_summary()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(row order by row->>'schoolName'), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'schoolId',    sch.id,
      'schoolName',  sch.name,
      'status',      sch.status,
      'teachers',    (select count(*) from public.users u where u.school_id = sch.id and u.role = 'Teacher'),
      'students',    (select count(*) from public.students s where s.school_id = sch.id),
      'assessments', (select count(*) from public.assessments a where a.school_id = sch.id),
      'gradedScripts', (select count(*) from public.grade_results g where g.school_id = sch.id and g.published_at is not null),
      'averagePercentage', (
        select round(avg(g.score / nullif(g.max_marks,0) * 100), 1)
          from public.grade_results g
         where g.school_id = sch.id and g.published_at is not null)
    ) as row
    from public.schools sch
  ) t;
$$;

revoke all on function public.resolve_student(text,text,text,text)                       from public, anon, authenticated;
revoke all on function public.resolve_class(text,text,text,text,text,uuid)               from public, anon, authenticated;
revoke all on function public.publish_student_result(text,uuid,jsonb,jsonb,jsonb)        from public, anon, authenticated;
revoke all on function public.parent_child_reports(uuid)                                 from public, anon, authenticated;
revoke all on function public.platform_school_summary()                                  from public, anon, authenticated;
grant execute on function public.resolve_student(text,text,text,text)                    to service_role;
grant execute on function public.resolve_class(text,text,text,text,text,uuid)            to service_role;
grant execute on function public.publish_student_result(text,uuid,jsonb,jsonb,jsonb)     to service_role;
grant execute on function public.parent_child_reports(uuid)                              to service_role;
grant execute on function public.platform_school_summary()                               to service_role;

comment on function public.publish_student_result(text,uuid,jsonb,jsonb,jsonb) is
  'Atomically publishes one student result out of the workspace blob into the normalized read model: resolves class and student identity, upserts the assessment, the graded result and its generated resources.';
comment on function public.resolve_student(text,text,text,text) is
  'Resolves a free-text student name to a durable students row within a school and class. Roll number wins over name, because names are guessed from filenames.';
