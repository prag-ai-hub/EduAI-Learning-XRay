-- Prompt 4: preserve the three-stage Secondary project/inquiry lifecycle.
create table if not exists public.hpc_applied_learning_stage_reviews (
  id uuid primary key default gen_random_uuid(),
  applied_learning_record_id uuid not null references public.hpc_applied_learning_records(id) on delete cascade,
  stage_number integer not null check (stage_number between 1 and 3),
  status text not null default 'planned' check (status in ('planned','in_progress','completed')),
  learner_reflection text, teacher_assessment text, peer_feedback text, due_date date,
  updated_by text references public.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(applied_learning_record_id, stage_number)
);
create index if not exists hpc_applied_learning_stage_reviews_record_idx on public.hpc_applied_learning_stage_reviews(applied_learning_record_id, stage_number);
alter table public.hpc_applied_learning_stage_reviews enable row level security;
revoke all on public.hpc_applied_learning_stage_reviews from anon, authenticated;
grant all on public.hpc_applied_learning_stage_reviews to service_role;
