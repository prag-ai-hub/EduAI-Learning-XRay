-- Prompt 4: record actual Secondary learner membership for group-project work.
create table if not exists public.hpc_applied_learning_members (
  id uuid primary key default gen_random_uuid(),
  applied_learning_record_id uuid not null references public.hpc_applied_learning_records(id) on delete cascade,
  learner_profile_id uuid not null references public.hpc_learner_profiles(id) on delete cascade,
  member_role text, created_at timestamptz not null default now(),
  unique(applied_learning_record_id, learner_profile_id)
);
create index if not exists hpc_applied_learning_members_learner_idx on public.hpc_applied_learning_members(learner_profile_id);
alter table public.hpc_applied_learning_members enable row level security;
revoke all on public.hpc_applied_learning_members from anon, authenticated;
grant all on public.hpc_applied_learning_members to service_role;
