-- Prompt 1: learner context, goals/aspirations and competency mapping.
-- Additive and scoped to the separate HPC project only.

create table if not exists public.hpc_competency_mappings (
  id uuid primary key default gen_random_uuid(),
  school_id text not null references public.schools(id) on delete cascade,
  learner_profile_id uuid not null references public.hpc_learner_profiles(id) on delete cascade,
  framework_version_id uuid not null references public.hpc_framework_versions(id) on delete restrict,
  domain_id uuid not null references public.hpc_domains(id) on delete restrict,
  curricular_goal_id uuid references public.hpc_curricular_goals(id) on delete restrict,
  competency_id uuid references public.hpc_competencies(id) on delete restrict,
  learning_outcome_id uuid references public.hpc_learning_outcomes(id) on delete restrict,
  ability_id uuid references public.hpc_abilities(id) on delete restrict,
  mapping_note text,
  mapping_status text not null default 'teacher_review_required'
    check (mapping_status in ('teacher_review_required','approved','archived')),
  created_by text references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists hpc_competency_mappings_learner_idx
  on public.hpc_competency_mappings(learner_profile_id, created_at desc);
create index if not exists hpc_goals_aspirations_learner_idx
  on public.hpc_goals_aspirations(learner_profile_id, created_at desc);

alter table public.hpc_competency_mappings enable row level security;
revoke all on public.hpc_competency_mappings from anon, authenticated;
grant all on public.hpc_competency_mappings to service_role;
