-- Prompt 4: approved mappings, final rubric decisions, and online-course completion proof.
create table if not exists public.hpc_applied_learning_mappings (
  id uuid primary key default gen_random_uuid(), applied_learning_record_id uuid not null references public.hpc_applied_learning_records(id) on delete cascade,
  domain_id uuid not null references public.hpc_domains(id) on delete restrict, curricular_goal_id uuid not null references public.hpc_curricular_goals(id) on delete restrict,
  competency_id uuid not null references public.hpc_competencies(id) on delete restrict, learning_outcome_id uuid references public.hpc_learning_outcomes(id) on delete restrict,
  ability_id uuid references public.hpc_abilities(id) on delete restrict, created_at timestamptz not null default now(),
  unique(applied_learning_record_id, competency_id, learning_outcome_id, ability_id)
);
create table if not exists public.hpc_applied_learning_rubric_criteria (
  id uuid primary key default gen_random_uuid(), applied_learning_record_id uuid not null references public.hpc_applied_learning_records(id) on delete cascade,
  criterion text not null, descriptor text not null, maximum_score numeric(8,2) not null check (maximum_score > 0), teacher_score numeric(8,2) not null check (teacher_score >= 0), teacher_comment text,
  created_by text references public.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), check (teacher_score <= maximum_score)
);
create table if not exists public.hpc_applied_learning_final_assessments (
  id uuid primary key default gen_random_uuid(), applied_learning_record_id uuid unique not null references public.hpc_applied_learning_records(id) on delete cascade,
  assessment_status text not null default 'draft' check (assessment_status in ('draft','finalised')),
  scoring_basis text not null check (scoring_basis in ('teacher_rubric','approved_official_level','not_prescribed')),
  total_score numeric(8,2), maximum_score numeric(8,2), official_level_text text, moderation_note text,
  finalised_by text references public.users(id), finalised_at timestamptz, updated_at timestamptz not null default now()
);
create table if not exists public.hpc_applied_learning_course_proofs (
  id uuid primary key default gen_random_uuid(), applied_learning_record_id uuid unique not null references public.hpc_applied_learning_records(id) on delete cascade,
  provider_name text not null, course_name text not null, completion_status text not null check (completion_status in ('enrolled','in_progress','completed')),
  completion_date date, hours_completed numeric(8,2), proof_reference text not null, verification_note text,
  verified_by text references public.users(id), verified_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.hpc_applied_learning_mappings enable row level security;
alter table public.hpc_applied_learning_rubric_criteria enable row level security;
alter table public.hpc_applied_learning_final_assessments enable row level security;
alter table public.hpc_applied_learning_course_proofs enable row level security;
revoke all on public.hpc_applied_learning_mappings,public.hpc_applied_learning_rubric_criteria,public.hpc_applied_learning_final_assessments,public.hpc_applied_learning_course_proofs from anon, authenticated;
grant all on public.hpc_applied_learning_mappings,public.hpc_applied_learning_rubric_criteria,public.hpc_applied_learning_final_assessments,public.hpc_applied_learning_course_proofs to service_role;
