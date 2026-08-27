-- Prompt 2 completion: revocable contribution links and teacher-approved yearly summaries.
alter table public.hpc_evidence add column if not exists contributor_name text;

create table if not exists public.hpc_share_links (
  id uuid primary key default gen_random_uuid(), school_id text not null references public.schools(id) on delete cascade,
  learner_profile_id uuid not null references public.hpc_learner_profiles(id) on delete cascade,
  contribution_type text not null check (contribution_type in ('peer_feedback','parent_feedback')),
  expires_at timestamptz not null, revoked_at timestamptz, created_by text references public.users(id), created_at timestamptz not null default now(),
  last_used_at timestamptz, submission_count integer not null default 0
);
create table if not exists public.hpc_yearly_summaries (
  id uuid primary key default gen_random_uuid(), school_id text not null references public.schools(id) on delete cascade,
  learner_profile_id uuid not null references public.hpc_learner_profiles(id) on delete cascade,
  academic_year text not null, summary_text text not null, strengths_text text, support_text text,
  evidence_count integer not null default 0, approval_status text not null default 'draft' check (approval_status in ('draft','approved')),
  approved_by text references public.users(id), approved_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (learner_profile_id,academic_year)
);
alter table public.hpc_share_links enable row level security; alter table public.hpc_yearly_summaries enable row level security;
revoke all on public.hpc_share_links,public.hpc_yearly_summaries from anon,authenticated;
grant all on public.hpc_share_links,public.hpc_yearly_summaries to service_role;
