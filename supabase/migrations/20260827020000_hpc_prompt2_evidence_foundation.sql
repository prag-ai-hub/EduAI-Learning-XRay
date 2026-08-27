-- Prompt 2: additive 360-degree formative evidence foundation.
-- Scoped solely to the separate HPC database; academic records are read-only references.

create table if not exists public.hpc_activities (
  id uuid primary key default gen_random_uuid(), school_id text not null references public.schools(id) on delete cascade,
  academic_year text not null, term_id uuid references public.hpc_terms(id) on delete set null,
  framework_version_id uuid not null references public.hpc_framework_versions(id) on delete restrict,
  stage_template_id uuid references public.hpc_stage_templates(id) on delete set null,
  title text not null, activity_prompt text not null, assessment_method text,
  pedagogies_json jsonb not null default '[]'::jsonb, rubric_json jsonb not null default '{}'::jsonb,
  activity_date date, status text not null default 'draft' check (status in ('draft','active','closed','archived')),
  created_by text references public.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table if not exists public.hpc_activity_mappings (
  id uuid primary key default gen_random_uuid(), activity_id uuid not null references public.hpc_activities(id) on delete cascade,
  domain_id uuid references public.hpc_domains(id) on delete restrict, curricular_goal_id uuid references public.hpc_curricular_goals(id) on delete restrict,
  competency_id uuid references public.hpc_competencies(id) on delete restrict, learning_outcome_id uuid references public.hpc_learning_outcomes(id) on delete restrict,
  ability_id uuid references public.hpc_abilities(id) on delete restrict, created_at timestamptz not null default now()
);

create table if not exists public.hpc_evidence (
  id uuid primary key default gen_random_uuid(), school_id text not null references public.schools(id) on delete cascade,
  learner_profile_id uuid not null references public.hpc_learner_profiles(id) on delete cascade,
  activity_id uuid references public.hpc_activities(id) on delete set null, academic_year text not null,
  term_id uuid references public.hpc_terms(id) on delete set null, framework_version_id uuid not null references public.hpc_framework_versions(id) on delete restrict,
  source_type text not null check (source_type in ('teacher_observation','student_reflection','peer_feedback','parent_feedback','academic_reference','portfolio','upload')),
  contributor_type text not null check (contributor_type in ('teacher','student','peer','parent','system')),
  contributor_user_id text references public.users(id), content text, attachment_reference text,
  review_status text not null default 'teacher_review_required' check (review_status in ('draft','teacher_review_required','approved','excluded')),
  sufficiency_status text not null default 'teacher_review_required' check (sufficiency_status in ('sufficient','limited','conflicting','missing','teacher_review_required')),
  observed_at timestamptz not null default now(), reviewed_by text references public.users(id), reviewed_at timestamptz, created_at timestamptz not null default now()
);

create table if not exists public.hpc_evidence_mappings (
  id uuid primary key default gen_random_uuid(), evidence_id uuid not null references public.hpc_evidence(id) on delete cascade,
  domain_id uuid references public.hpc_domains(id) on delete restrict, competency_id uuid references public.hpc_competencies(id) on delete restrict,
  learning_outcome_id uuid references public.hpc_learning_outcomes(id) on delete restrict, ability_id uuid references public.hpc_abilities(id) on delete restrict
);

create table if not exists public.hpc_teacher_observations (
  id uuid primary key default gen_random_uuid(), evidence_id uuid unique not null references public.hpc_evidence(id) on delete cascade,
  performance_level_id uuid references public.hpc_performance_levels(id) on delete set null, confidence text check (confidence in ('low','medium','high')),
  observation_notes text, approval_status text not null default 'draft' check (approval_status in ('draft','approved','rejected')),
  approved_by text references public.users(id), approved_at timestamptz
);

create table if not exists public.hpc_student_reflections (
  id uuid primary key default gen_random_uuid(), evidence_id uuid unique not null references public.hpc_evidence(id) on delete cascade,
  reflection text, learning_text text, practice_needed text, help_needed text, voice_reference text
);

create table if not exists public.hpc_peer_feedback (
  id uuid primary key default gen_random_uuid(), evidence_id uuid unique not null references public.hpc_evidence(id) on delete cascade,
  reviewer_learner_profile_id uuid references public.hpc_learner_profiles(id) on delete set null,
  feedback text, moderation_status text not null default 'pending' check (moderation_status in ('pending','approved','excluded')),
  moderated_by text references public.users(id), moderated_at timestamptz
);

create table if not exists public.hpc_parent_feedback (
  id uuid primary key default gen_random_uuid(), evidence_id uuid unique not null references public.hpc_evidence(id) on delete cascade,
  feedback text, support_commitment text, partnership_status text not null default 'teacher_review_required' check (partnership_status in ('draft','teacher_review_required','approved','excluded'))
);

create index if not exists hpc_activities_school_year_idx on public.hpc_activities(school_id, academic_year, activity_date desc);
create index if not exists hpc_evidence_learner_idx on public.hpc_evidence(learner_profile_id, observed_at desc);
create index if not exists hpc_evidence_activity_idx on public.hpc_evidence(activity_id, observed_at desc);

alter table public.hpc_activities enable row level security; alter table public.hpc_activity_mappings enable row level security;
alter table public.hpc_evidence enable row level security; alter table public.hpc_evidence_mappings enable row level security;
alter table public.hpc_teacher_observations enable row level security; alter table public.hpc_student_reflections enable row level security;
alter table public.hpc_peer_feedback enable row level security; alter table public.hpc_parent_feedback enable row level security;
revoke all on public.hpc_activities,public.hpc_activity_mappings,public.hpc_evidence,public.hpc_evidence_mappings,public.hpc_teacher_observations,public.hpc_student_reflections,public.hpc_peer_feedback,public.hpc_parent_feedback from anon,authenticated;
grant all on public.hpc_activities,public.hpc_activity_mappings,public.hpc_evidence,public.hpc_evidence_mappings,public.hpc_teacher_observations,public.hpc_student_reflections,public.hpc_peer_feedback,public.hpc_parent_feedback to service_role;
