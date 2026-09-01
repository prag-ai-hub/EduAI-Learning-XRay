create table if not exists public.schools (
  id text primary key,
  name text not null,
  city text,
  board text,
  settings_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.users (
  id text primary key,
  school_id text not null references public.schools(id),
  name text not null,
  email text not null,
  role text not null,
  phone text,
  status text not null default 'Active',
  profile_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_id, email)
);

create table if not exists public.classes (
  id text primary key,
  school_id text not null references public.schools(id),
  academic_year text not null,
  grade text not null,
  section text not null,
  subject text not null,
  teacher_id text references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists classes_school_idx on public.classes(school_id);

create table if not exists public.students (
  id text primary key,
  school_id text not null references public.schools(id),
  class_id text references public.classes(id),
  name text not null,
  roll_number text,
  status text not null default 'Active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists students_class_idx on public.students(class_id);

create table if not exists public.assessments (
  id text primary key,
  school_id text not null references public.schools(id),
  class_id text references public.classes(id),
  title text not null,
  activity_type text not null,
  subject text not null,
  max_marks integer not null,
  assessment_date date not null,
  stage text not null,
  version integer not null default 1,
  answer_key text,
  rubric text,
  quality integer not null default 0,
  published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists assessments_school_date_idx on public.assessments(school_id, assessment_date);

create table if not exists public.uploaded_files (
  id text primary key,
  assessment_id text references public.assessments(id),
  storage_path text not null,
  filename text not null,
  content_type text not null,
  size_bytes bigint not null,
  purpose text not null,
  processing_status text not null,
  ocr_text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists uploaded_files_assessment_idx on public.uploaded_files(assessment_id);

create table if not exists public.grade_results (
  id text primary key,
  assessment_id text not null references public.assessments(id),
  file_id text not null references public.uploaded_files(id),
  student_id text references public.students(id),
  student_name text not null,
  question_paper_file_id text,
  score integer not null,
  max_marks integer not null,
  confidence integer,
  feedback text,
  gaps_json jsonb not null,
  teacher_status text not null default 'Draft',
  grading_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (assessment_id, file_id, grading_version)
);
create index if not exists grade_results_student_idx on public.grade_results(student_id);

create table if not exists public.interventions (
  id text primary key,
  assessment_id text not null references public.assessments(id),
  concept text not null,
  format text not null,
  duration text not null,
  status text not null,
  followup_date date,
  plan_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.resources (
  id text primary key,
  intervention_id text references public.interventions(id),
  title text not null,
  resource_type text not null,
  status text not null,
  content_json jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.followup_evidence (
  id text primary key,
  intervention_id text not null references public.interventions(id),
  evidence_type text not null,
  students_completed integer not null,
  average_mastery integer,
  outcome text not null,
  notes text,
  recorded_at timestamptz not null default now()
);

create table if not exists public.audit_events (
  id text primary key,
  school_id text not null,
  actor_id text,
  action text not null,
  entity_type text not null,
  entity_id text,
  detail_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_events_school_created_idx on public.audit_events(school_id, created_at);

create table if not exists public.workspace_snapshots (
  workspace_id text primary key,
  state_json jsonb not null,
  revision bigint not null default 1,
  updated_at timestamptz not null default now()
);

create or replace function public.save_workspace_snapshot(
  p_workspace_id text,
  p_state_json jsonb
) returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  next_revision bigint;
begin
  insert into public.workspace_snapshots (workspace_id, state_json, revision, updated_at)
  values (p_workspace_id, p_state_json, 1, now())
  on conflict (workspace_id) do update
  set state_json = excluded.state_json,
      revision = public.workspace_snapshots.revision + 1,
      updated_at = now()
  returning revision into next_revision;
  return next_revision;
end;
$$;

insert into storage.buckets (id, name, public, file_size_limit)
values ('eduai-files', 'eduai-files', false, 10485760)
on conflict (id) do update
set public = false, file_size_limit = 10485760;

alter table public.schools enable row level security;
alter table public.users enable row level security;
alter table public.classes enable row level security;
alter table public.students enable row level security;
alter table public.assessments enable row level security;
alter table public.uploaded_files enable row level security;
alter table public.grade_results enable row level security;
alter table public.interventions enable row level security;
alter table public.resources enable row level security;
alter table public.followup_evidence enable row level security;
alter table public.audit_events enable row level security;
alter table public.workspace_snapshots enable row level security;

revoke all on all tables in schema public from anon, authenticated;
revoke all on function public.save_workspace_snapshot(text, jsonb) from public, anon, authenticated;
grant execute on function public.save_workspace_snapshot(text, jsonb) to service_role;
