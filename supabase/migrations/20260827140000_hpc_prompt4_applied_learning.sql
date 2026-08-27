-- Prompt 4: Secondary-stage applied learning, isolated within the HPC database.
create table if not exists public.hpc_applied_learning_records (
  id uuid primary key default gen_random_uuid(), school_id text not null references public.schools(id) on delete cascade,
  learner_profile_id uuid not null references public.hpc_learner_profiles(id) on delete cascade,
  framework_version_id uuid not null references public.hpc_framework_versions(id) on delete restrict,
  record_type text not null check (record_type in ('group_project','problem_inquiry','classroom_interaction','online_course','community_skill')),
  title text not null, prompt_text text, stage_number integer check (stage_number between 1 and 3),
  interaction_type text, subject_domain_id uuid references public.hpc_domains(id) on delete set null,
  hours_spent numeric(6,2), completion_status text not null default 'planned' check (completion_status in ('planned','in_progress','completed')),
  learner_reflection text, teacher_assessment text, peer_feedback text, teacher_comments text,
  schedule_json jsonb not null default '{}'::jsonb, roles_json jsonb not null default '[]'::jsonb,
  barriers_text text, rubric_json jsonb not null default '{}'::jsonb, credits_json jsonb not null default '{}'::jsonb,
  created_by text references public.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists hpc_applied_learning_learner_idx on public.hpc_applied_learning_records(learner_profile_id, created_at desc);
alter table public.hpc_applied_learning_records enable row level security;
revoke all on public.hpc_applied_learning_records from anon, authenticated;
grant all on public.hpc_applied_learning_records to service_role;

-- Official PARAKH/NCERT Secondary Stage source (2025); only the stage structure is seeded here.
insert into public.hpc_framework_versions (framework_code,version_label,source_name,source_reference,source_published_at,status)
values ('PARAKH_HPC_SECONDARY','2025 Secondary Stage','PARAKH / NCERT — How to fill the HPC (Secondary Stage)','https://parakh.ncert.gov.in/themes/parakh/hpc-files/how-to-fill-pdf/How-to-fill-the-HPC-(Secondary-Stage).pdf','2025-01-01','approved')
on conflict (framework_code,version_label) do update set source_reference=excluded.source_reference,status='approved';
insert into public.hpc_stage_templates (framework_version_id,stage_code,title,grade_from,grade_to,is_active)
select id,'secondary','Secondary Stage',9,12,true from public.hpc_framework_versions where framework_code='PARAKH_HPC_SECONDARY' and version_label='2025 Secondary Stage'
on conflict (framework_version_id,stage_code) do update set is_active=true;
insert into public.hpc_template_sections (stage_template_id,section_code,title,sort_order,required)
select t.id,v.code,v.title,v.sort_order,true from public.hpc_stage_templates t cross join (values
 ('part_b_group_project','Part B · Group Project Work',20),('part_c_inquiry','Part C · Problem-Based Inquiry',30),('part_d_classroom','Part D · Classroom Interactions',40),('part_e_inventory','Part E · Time and Competency Inventory',50)
) as v(code,title,sort_order) where t.stage_code='secondary' and t.framework_version_id=(select id from public.hpc_framework_versions where framework_code='PARAKH_HPC_SECONDARY' and version_label='2025 Secondary Stage')
on conflict (stage_template_id,section_code) do update set title=excluded.title,sort_order=excluded.sort_order,required=true;
