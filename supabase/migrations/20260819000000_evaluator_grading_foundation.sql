-- Evaluator grading foundation: additive, immutable, and compatible with the pilot workspace.
create table if not exists public.assessment_versions (
  id uuid primary key default gen_random_uuid(),
  school_id text not null references public.schools(id),
  assessment_id text not null references public.assessments(id),
  version_number integer not null check (version_number > 0),
  status text not null default 'draft' check (status in ('draft','frozen','superseded')),
  package_json jsonb not null default '{}'::jsonb,
  checksum text not null,
  authored_by text references public.users(id),
  approved_by text references public.users(id),
  effective_at timestamptz,
  created_at timestamptz not null default now(),
  unique (assessment_id, version_number)
);

create table if not exists public.evaluation_drafts (
  id uuid primary key default gen_random_uuid(),
  school_id text not null references public.schools(id),
  assessment_id text not null,
  assessment_version integer not null check (assessment_version > 0),
  file_id text not null,
  evaluator_id text not null references public.users(id),
  concurrency_version bigint not null default 1,
  state_json jsonb not null default '{}'::jsonb,
  status text not null default 'in_evaluation' check (status in ('in_evaluation','submitted','abandoned')),
  updated_at timestamptz not null default now(),
  unique (school_id, assessment_id, file_id, evaluator_id)
);

create table if not exists public.evaluation_versions (
  id uuid primary key default gen_random_uuid(),
  school_id text not null references public.schools(id),
  assessment_id text not null,
  assessment_version integer not null check (assessment_version > 0),
  file_id text not null,
  student_name text not null,
  evaluator_id text not null references public.users(id),
  parent_version_id uuid references public.evaluation_versions(id),
  version_number integer not null check (version_number > 0),
  status text not null check (status in ('submitted','moderation_pending','finalized','published','superseded')),
  total_awarded numeric(10,2) not null check (total_awarded >= 0),
  total_max numeric(10,2) not null check (total_max > 0 and total_awarded <= total_max),
  content_hash text not null,
  idempotency_key text not null,
  snapshot_json jsonb not null,
  submitted_at timestamptz not null,
  finalized_at timestamptz,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  unique (school_id, assessment_id, file_id, version_number),
  unique (school_id, evaluator_id, idempotency_key)
);
create index if not exists evaluation_versions_script_idx on public.evaluation_versions(school_id, assessment_id, file_id, version_number desc);

create table if not exists public.report_versions (
  id uuid primary key default gen_random_uuid(),
  school_id text not null references public.schools(id),
  evaluation_version_id uuid not null references public.evaluation_versions(id),
  report_type text not null check (report_type in ('learning_gap','study_guide','worksheet','answer_key','performance_matrix')),
  status text not null default 'queued' check (status in ('queued','generating','ready','stale','published','failed')),
  artifact_path text,
  source_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (evaluation_version_id, report_type)
);

alter table public.assessment_versions enable row level security;
alter table public.evaluation_drafts enable row level security;
alter table public.evaluation_versions enable row level security;
alter table public.report_versions enable row level security;

revoke all on public.assessment_versions, public.evaluation_drafts, public.evaluation_versions, public.report_versions from anon, authenticated;
grant all on public.assessment_versions, public.evaluation_drafts, public.evaluation_versions, public.report_versions to service_role;

comment on table public.evaluation_versions is 'Immutable evaluator submissions. Corrections create a new version; rows are never updated in place.';
comment on column public.evaluation_versions.snapshot_json is 'Canonical question decisions, criterion decisions, evidence, AI disposition, and page dispositions at submission time.';
