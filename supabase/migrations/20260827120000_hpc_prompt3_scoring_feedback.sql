-- Prompt 3: official Middle Stage scoring remains separate from Academic X-Ray.
create table if not exists public.hpc_scoring_rules (
  id uuid primary key default gen_random_uuid(), framework_version_id uuid not null references public.hpc_framework_versions(id) on delete restrict,
  stage_code text not null, rule_code text not null, source_name text not null, source_reference text not null,
  rule_json jsonb not null, status text not null default 'approved' check (status in ('draft','approved','retired')), created_at timestamptz not null default now(),
  unique (framework_version_id, stage_code, rule_code)
);
create table if not exists public.hpc_ability_assessments (
  id uuid primary key default gen_random_uuid(), school_id text not null references public.schools(id) on delete cascade,
  learner_profile_id uuid not null references public.hpc_learner_profiles(id) on delete cascade, framework_version_id uuid not null references public.hpc_framework_versions(id) on delete restrict,
  scoring_rule_id uuid not null references public.hpc_scoring_rules(id) on delete restrict, ability_id uuid not null references public.hpc_abilities(id) on delete restrict,
  perspective text not null check (perspective in ('self','peer','teacher')), statement_count integer not null check (statement_count between 0 and 6),
  calculated_level text not null check (calculated_level in ('beginner','proficient','advanced')), teacher_override_level text check (teacher_override_level in ('beginner','proficient','advanced')),
  evidence_note text, updated_by text references public.users(id), updated_at timestamptz not null default now(),
  unique (learner_profile_id, scoring_rule_id, ability_id, perspective)
);
create table if not exists public.hpc_teacher_feedback (
  id uuid primary key default gen_random_uuid(), school_id text not null references public.schools(id) on delete cascade,
  learner_profile_id uuid not null references public.hpc_learner_profiles(id) on delete cascade, framework_version_id uuid not null references public.hpc_framework_versions(id) on delete restrict,
  strengths_text text, barriers_text text, barriers_visibility text not null default 'teacher_only' check (barriers_visibility in ('teacher_only','parent_shareable')),
  observations_text text, recommendations_text text, support_text text, updated_by text references public.users(id), updated_at timestamptz not null default now(), unique (learner_profile_id)
);
create table if not exists public.hpc_holistic_support_actions (
  id uuid primary key default gen_random_uuid(), school_id text not null references public.schools(id) on delete cascade, learner_profile_id uuid not null references public.hpc_learner_profiles(id) on delete cascade,
  ability_id uuid references public.hpc_abilities(id) on delete set null, evidence_id uuid references public.hpc_evidence(id) on delete set null, title text not null, action_plan text not null,
  review_date date, status text not null default 'planned' check (status in ('planned','active','completed')), source_type text not null default 'holistic_hpc', created_by text references public.users(id), created_at timestamptz not null default now()
);
insert into public.hpc_scoring_rules (framework_version_id,stage_code,rule_code,source_name,source_reference,rule_json,status)
select id,'middle','six_statement_ability_key','PARAKH / NCERT — How to fill the HPC (Middle Stage)',source_reference,'{"perspectives":["self","peer","teacher"],"abilities":["awareness","sensitivity","creativity"],"statement_count_max":6,"levels":{"beginner":[0,2],"proficient":[3,4],"advanced":[5,6]},"no_blended_score":true}'::jsonb,'approved' from public.hpc_framework_versions where framework_code='PARAKH_HPC_MIDDLE_STAGE' and status='approved'
on conflict (framework_version_id,stage_code,rule_code) do update set rule_json=excluded.rule_json,source_reference=excluded.source_reference,status='approved';
alter table public.hpc_scoring_rules enable row level security; alter table public.hpc_ability_assessments enable row level security; alter table public.hpc_teacher_feedback enable row level security; alter table public.hpc_holistic_support_actions enable row level security;
revoke all on public.hpc_scoring_rules,public.hpc_ability_assessments,public.hpc_teacher_feedback,public.hpc_holistic_support_actions from anon,authenticated;
grant all on public.hpc_scoring_rules,public.hpc_ability_assessments,public.hpc_teacher_feedback,public.hpc_holistic_support_actions to service_role;
