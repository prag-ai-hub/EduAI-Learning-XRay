-- Approved PARAKH / NCERT core framework for the Holistic Progress Card (HPC).
-- Source: PARAKH (2023), How to fill the HPC (Middle Stage), NCERT.
-- This is additive and does not read from or modify Learning X-Ray tables.

create table if not exists public.hpc_performance_levels (
  id uuid primary key default gen_random_uuid(),
  framework_version_id uuid not null references public.hpc_framework_versions(id) on delete restrict,
  code text not null,
  label text not null,
  score_from integer,
  score_to integer,
  sort_order integer not null check (sort_order >= 0),
  unique (framework_version_id, code)
);

alter table public.hpc_performance_levels enable row level security;
revoke all on public.hpc_performance_levels from anon, authenticated;
grant all on public.hpc_performance_levels to service_role;

do $$
declare
  framework_id uuid;
  template_id uuid;
begin
  insert into public.hpc_framework_versions (
    framework_code, version_label, source_name, source_reference, source_published_at, status
  ) values (
    'PARAKH_HPC_MIDDLE_STAGE',
    '2023 Middle Stage core',
    'PARAKH / NCERT — How to fill the HPC (Middle Stage)',
    'https://parakh.ncert.gov.in/themes/parakh/hpc-files/2-How-to-fill-the-HPC-(Middle-Stage).pdf',
    date '2023-12-01',
    'approved'
  ) on conflict (framework_code, version_label) do update set
    source_name = excluded.source_name,
    source_reference = excluded.source_reference,
    source_published_at = excluded.source_published_at,
    status = excluded.status
  returning id into framework_id;

  insert into public.hpc_stage_templates (
    framework_version_id, stage_code, title, grade_from, grade_to, is_active
  ) values (framework_id, 'middle', 'Middle Stage', 6, 8, true)
  on conflict (framework_version_id, stage_code) do update set
    title = excluded.title, grade_from = excluded.grade_from, grade_to = excluded.grade_to, is_active = excluded.is_active
  returning id into template_id;

  insert into public.hpc_template_sections (stage_template_id, section_code, title, sort_order, required, configuration_json)
  values
    (template_id, 'part_a_general_information', 'Part A(1): General Information', 10, true, '{"owner":"teacher_parent_guardian","timing":"start_of_academic_year"}'::jsonb),
    (template_id, 'part_a_all_about_me', 'Part A(2): All About Me', 20, true, '{"owner":"learner","timing":"start_of_academic_year"}'::jsonb),
    (template_id, 'part_a_ambition', 'Part A(3): My Ambition Card', 30, true, '{"owner":"learner","timing":"start_of_academic_year"}'::jsonb),
    (template_id, 'part_a_parent_teacher', 'Part A(4): Parent-Teacher Partnership Card', 40, true, '{"owner":"parent_teacher","timing":"academic_year"}'::jsonb),
    (template_id, 'part_b_student_progress', 'Part B: Student Progress', 50, true, '{"owner":"learner_peer_teacher","timing":"throughout_academic_year","feedback":"self_peer_teacher"}'::jsonb),
    (template_id, 'part_c_holistic_summary', 'Part C: Holistic Summary for the Academic Year', 60, true, '{"owner":"teacher","timing":"end_of_academic_year"}'::jsonb)
  on conflict (stage_template_id, section_code) do update set
    title = excluded.title, sort_order = excluded.sort_order, required = excluded.required, configuration_json = excluded.configuration_json;

  insert into public.hpc_abilities (framework_version_id, code, label)
  values
    (framework_id, 'awareness', 'Awareness'),
    (framework_id, 'sensitivity', 'Sensitivity'),
    (framework_id, 'creativity', 'Creativity')
  on conflict (framework_version_id, code) do update set label = excluded.label;

  insert into public.hpc_performance_levels (framework_version_id, code, label, score_from, score_to, sort_order)
  values
    (framework_id, 'beginner', 'Beginner', 0, 2, 10),
    (framework_id, 'proficient', 'Proficient', 3, 4, 20),
    (framework_id, 'advanced', 'Advanced', 5, 6, 30)
  on conflict (framework_version_id, code) do update set
    label = excluded.label, score_from = excluded.score_from, score_to = excluded.score_to, sort_order = excluded.sort_order;

  insert into public.hpc_domains (framework_version_id, code, label)
  values
    (framework_id, 'language_1', 'Language 1 (R1)'),
    (framework_id, 'language_2', 'Language 2 (R2)'),
    (framework_id, 'language_3', 'Language 3 (R3)'),
    (framework_id, 'mathematics', 'Mathematics'),
    (framework_id, 'science', 'Science'),
    (framework_id, 'social_science', 'Social Science'),
    (framework_id, 'art_education', 'Art Education'),
    (framework_id, 'physical_education', 'Physical Education')
  on conflict (framework_version_id, code) do update set label = excluded.label;
end $$;
