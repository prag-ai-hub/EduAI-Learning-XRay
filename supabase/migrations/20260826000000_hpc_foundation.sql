-- HPC foundation. This migration is additive and leaves Academic X-Ray unchanged.
-- Official framework content is intentionally not seeded: it must be loaded only
-- from an approved PARAKH/CBSE source package.

create table if not exists public.hpc_school_settings (
  school_id text primary key references public.schools(id) on delete cascade,
  enabled boolean not null default false,
  enabled_at timestamptz,
  enabled_by text references public.users(id),
  updated_at timestamptz not null default now()
);

create table if not exists public.hpc_framework_versions (
  id uuid primary key default gen_random_uuid(),
  framework_code text not null,
  version_label text not null,
  source_name text not null,
  source_reference text not null,
  source_published_at date,
  status text not null default 'draft' check (status in ('draft','approved','retired')),
  created_at timestamptz not null default now(),
  unique (framework_code, version_label)
);

create table if not exists public.hpc_stage_templates (
  id uuid primary key default gen_random_uuid(),
  framework_version_id uuid not null references public.hpc_framework_versions(id) on delete restrict,
  stage_code text not null check (stage_code in ('foundational','preparatory','middle','secondary')),
  title text not null,
  grade_from integer not null check (grade_from between 0 and 12),
  grade_to integer not null check (grade_to between 0 and 12 and grade_to >= grade_from),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (framework_version_id, stage_code)
);

create table if not exists public.hpc_template_sections (
  id uuid primary key default gen_random_uuid(),
  stage_template_id uuid not null references public.hpc_stage_templates(id) on delete cascade,
  section_code text not null,
  title text not null,
  sort_order integer not null check (sort_order >= 0),
  required boolean not null default false,
  configuration_json jsonb not null default '{}'::jsonb,
  unique (stage_template_id, section_code)
);

create table if not exists public.hpc_terms (
  id uuid primary key default gen_random_uuid(),
  school_id text not null references public.schools(id) on delete cascade,
  academic_year text not null,
  name text not null,
  starts_on date,
  ends_on date,
  status text not null default 'planned' check (status in ('planned','active','closed')),
  unique (school_id, academic_year, name)
);

create table if not exists public.hpc_learner_profiles (
  id uuid primary key default gen_random_uuid(),
  school_id text not null references public.schools(id) on delete cascade,
  student_id text not null references public.students(id) on delete cascade,
  academic_year text not null,
  attendance_percentage numeric(5,2) check (attendance_percentage between 0 and 100),
  low_attendance_reason text,
  interests_json jsonb not null default '[]'::jsonb,
  context_json jsonb not null default '{}'::jsonb,
  home_learning_resources_json jsonb not null default '{}'::jsonb,
  updated_by text references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, academic_year)
);

create table if not exists public.hpc_goals_aspirations (
  id uuid primary key default gen_random_uuid(),
  learner_profile_id uuid not null references public.hpc_learner_profiles(id) on delete cascade,
  goal_type text not null check (goal_type in ('all_about_me','academic_goal','personal_goal','ambition','career_aspiration','future_plan','strength','support','time_management')),
  content text not null,
  source_type text not null check (source_type in ('student','teacher','parent','school')),
  approval_status text not null default 'draft' check (approval_status in ('draft','approved','rejected')),
  approved_by text references public.users(id),
  approved_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.hpc_domains (
  id uuid primary key default gen_random_uuid(),
  framework_version_id uuid not null references public.hpc_framework_versions(id) on delete restrict,
  code text not null,
  label text not null,
  unique (framework_version_id, code)
);

create table if not exists public.hpc_curricular_goals (
  id uuid primary key default gen_random_uuid(),
  domain_id uuid not null references public.hpc_domains(id) on delete cascade,
  code text not null,
  label text not null,
  unique (domain_id, code)
);

create table if not exists public.hpc_competencies (
  id uuid primary key default gen_random_uuid(),
  curricular_goal_id uuid not null references public.hpc_curricular_goals(id) on delete cascade,
  code text not null,
  label text not null,
  unique (curricular_goal_id, code)
);

create table if not exists public.hpc_learning_outcomes (
  id uuid primary key default gen_random_uuid(),
  competency_id uuid not null references public.hpc_competencies(id) on delete cascade,
  code text not null,
  label text not null,
  unique (competency_id, code)
);

create table if not exists public.hpc_abilities (
  id uuid primary key default gen_random_uuid(),
  framework_version_id uuid not null references public.hpc_framework_versions(id) on delete restrict,
  code text not null,
  label text not null,
  unique (framework_version_id, code)
);

-- The Learning Event is an append-only cross-domain traceability record. It
-- deliberately contains no aggregate score so academic and holistic models stay separate.
create table if not exists public.learning_events (
  id uuid primary key default gen_random_uuid(),
  school_id text not null references public.schools(id) on delete cascade,
  student_id text not null references public.students(id) on delete cascade,
  class_id text references public.classes(id) on delete set null,
  academic_year text not null,
  term_id uuid references public.hpc_terms(id) on delete set null,
  event_type text not null,
  event_timestamp timestamptz not null default now(),
  source_type text not null,
  source_record_id text not null,
  framework_version_id uuid references public.hpc_framework_versions(id) on delete set null,
  competency_id uuid references public.hpc_competencies(id) on delete set null,
  learning_outcome_id uuid references public.hpc_learning_outcomes(id) on delete set null,
  concept_id text,
  created_by text references public.users(id),
  created_at timestamptz not null default now(),
  unique (source_type, source_record_id)
);

create index if not exists hpc_learner_profiles_school_student_idx on public.hpc_learner_profiles(school_id, student_id, academic_year);
create index if not exists hpc_terms_school_year_idx on public.hpc_terms(school_id, academic_year);
create index if not exists learning_events_student_time_idx on public.learning_events(student_id, event_timestamp desc);
create index if not exists learning_events_school_type_idx on public.learning_events(school_id, event_type);

alter table public.hpc_school_settings enable row level security;
alter table public.hpc_framework_versions enable row level security;
alter table public.hpc_stage_templates enable row level security;
alter table public.hpc_template_sections enable row level security;
alter table public.hpc_terms enable row level security;
alter table public.hpc_learner_profiles enable row level security;
alter table public.hpc_goals_aspirations enable row level security;
alter table public.hpc_domains enable row level security;
alter table public.hpc_curricular_goals enable row level security;
alter table public.hpc_competencies enable row level security;
alter table public.hpc_learning_outcomes enable row level security;
alter table public.hpc_abilities enable row level security;
alter table public.learning_events enable row level security;

revoke all on public.hpc_school_settings, public.hpc_framework_versions, public.hpc_stage_templates,
  public.hpc_template_sections, public.hpc_terms, public.hpc_learner_profiles, public.hpc_goals_aspirations,
  public.hpc_domains, public.hpc_curricular_goals, public.hpc_competencies, public.hpc_learning_outcomes,
  public.hpc_abilities, public.learning_events from anon, authenticated;
grant all on public.hpc_school_settings, public.hpc_framework_versions, public.hpc_stage_templates,
  public.hpc_template_sections, public.hpc_terms, public.hpc_learner_profiles, public.hpc_goals_aspirations,
  public.hpc_domains, public.hpc_curricular_goals, public.hpc_competencies, public.hpc_learning_outcomes,
  public.hpc_abilities, public.learning_events to service_role;
