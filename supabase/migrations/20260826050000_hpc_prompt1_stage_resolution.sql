-- Prompt 1 stage resolution. Structural stage metadata only; detailed official
-- descriptors remain unavailable until an approved source package is loaded.

alter table public.hpc_learner_profiles
  add column if not exists grade integer check (grade between 0 and 12),
  add column if not exists class_id text references public.classes(id) on delete set null;

create index if not exists hpc_learner_profiles_school_grade_idx
  on public.hpc_learner_profiles(school_id, grade, academic_year);

insert into public.hpc_stage_templates (framework_version_id, stage_code, title, grade_from, grade_to, is_active)
select framework.id, stage.stage_code, stage.title, stage.grade_from, stage.grade_to, true
from public.hpc_framework_versions framework
cross join (values
  ('foundational'::text, 'Foundational Stage'::text, 0, 2),
  ('preparatory', 'Preparatory Stage', 3, 5),
  ('middle', 'Middle Stage', 6, 8),
  ('secondary', 'Secondary Stage', 9, 12)
) as stage(stage_code, title, grade_from, grade_to)
where framework.framework_code = 'PARAKH_HPC_MIDDLE_STAGE' and framework.status = 'approved'
on conflict (framework_version_id, stage_code) do update
  set grade_from = excluded.grade_from, grade_to = excluded.grade_to, title = excluded.title, is_active = true;

insert into public.hpc_template_sections (stage_template_id, section_code, title, sort_order, required, configuration_json)
select template.id, section.section_code, section.title, section.sort_order, section.required, section.configuration_json
from public.hpc_stage_templates template
join public.hpc_framework_versions framework on framework.id = template.framework_version_id
cross join (values
  ('foundational'::text, 'all_about_me'::text, 'All About Me'::text, 10, true, '{"goal_types":["all_about_me","strength","support"]}'::jsonb),
  ('preparatory', 'learner_goals', 'Learner goals', 20, true, '{"goal_types":["all_about_me","academic_goal","personal_goal","strength","support"]}'::jsonb),
  ('middle', 'learner_goals', 'Goals and ambitions', 20, true, '{"goal_types":["all_about_me","academic_goal","personal_goal","ambition","future_plan","strength","support","time_management"]}'::jsonb),
  ('secondary', 'learner_goals', 'Goals, ambition and future plans', 20, true, '{"goal_types":["all_about_me","academic_goal","personal_goal","ambition","career_aspiration","future_plan","strength","support","time_management"]}'::jsonb)
) as section(stage_code, section_code, title, sort_order, required, configuration_json)
where framework.framework_code = 'PARAKH_HPC_MIDDLE_STAGE'
  and framework.status = 'approved'
  and template.stage_code = section.stage_code
on conflict (stage_template_id, section_code) do update
  set title = excluded.title, sort_order = excluded.sort_order, required = excluded.required, configuration_json = excluded.configuration_json;
