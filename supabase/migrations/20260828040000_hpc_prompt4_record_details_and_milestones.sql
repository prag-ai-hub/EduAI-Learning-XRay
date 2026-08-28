-- Prompt 4 completion: explicit context, milestone and course-proof ownership.
alter table public.hpc_applied_learning_records
  add column if not exists term_label text,
  add column if not exists class_context text,
  add column if not exists updated_by text references public.users(id);

alter table public.hpc_applied_learning_course_proofs
  add column if not exists uploaded_by text references public.users(id);

create table if not exists public.hpc_applied_learning_milestones (
  id uuid primary key default gen_random_uuid(),
  applied_learning_record_id uuid not null references public.hpc_applied_learning_records(id) on delete cascade,
  title text not null,
  due_date date,
  status text not null default 'planned' check (status in ('planned','in_progress','completed','blocked')),
  owner_label text,
  notes text,
  created_by text references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists hpc_applied_learning_milestones_record_idx
  on public.hpc_applied_learning_milestones(applied_learning_record_id, due_date nulls last);

create table if not exists public.hpc_applied_learning_barriers (
  id uuid primary key default gen_random_uuid(),
  applied_learning_record_id uuid not null references public.hpc_applied_learning_records(id) on delete cascade,
  barrier_text text not null,
  support_action text,
  status text not null default 'open' check (status in ('open','monitoring','resolved')),
  owner_label text,
  created_by text references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists hpc_applied_learning_barriers_record_idx
  on public.hpc_applied_learning_barriers(applied_learning_record_id, status);

alter table public.hpc_applied_learning_milestones enable row level security;
alter table public.hpc_applied_learning_barriers enable row level security;
revoke all on public.hpc_applied_learning_milestones, public.hpc_applied_learning_barriers from anon, authenticated;
grant all on public.hpc_applied_learning_milestones, public.hpc_applied_learning_barriers to service_role;
