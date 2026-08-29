-- Prompt 5: immutable annual HPC reporting. Additive; Academic X-Ray is unchanged.
alter table public.audit_events alter column id set default gen_random_uuid()::text;
create table if not exists public.hpc_annual_summaries (
  id uuid primary key default gen_random_uuid(),
  school_id text not null references public.schools(id) on delete cascade,
  learner_profile_id uuid not null references public.hpc_learner_profiles(id) on delete cascade,
  academic_year text not null,
  stage_template_id uuid not null references public.hpc_stage_templates(id) on delete restrict,
  framework_version_id uuid not null references public.hpc_framework_versions(id) on delete restrict,
  scoring_rule_id uuid references public.hpc_scoring_rules(id) on delete restrict,
  narrative_text text not null,
  teacher_notes text,
  strengths_text text,
  support_text text,
  status text not null default 'draft' check (status in ('draft','finalized')),
  validation_json jsonb not null default '{}'::jsonb,
  finalized_by text references public.users(id),
  finalized_at timestamptz,
  created_by text references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (learner_profile_id, academic_year)
);

create table if not exists public.hpc_report_versions (
  id uuid primary key default gen_random_uuid(),
  annual_summary_id uuid not null references public.hpc_annual_summaries(id) on delete restrict,
  school_id text not null references public.schools(id) on delete cascade,
  version_number integer not null check (version_number > 0),
  report_payload jsonb not null,
  framework_version_label text not null,
  scoring_version_label text,
  approval_metadata jsonb not null default '{}'::jsonb,
  content_sha256 text not null,
  created_by text references public.users(id),
  created_at timestamptz not null default now(),
  unique (annual_summary_id, version_number)
);

create table if not exists public.hpc_report_evidence_snapshot (
  id uuid primary key default gen_random_uuid(),
  report_version_id uuid not null references public.hpc_report_versions(id) on delete cascade,
  school_id text not null references public.schools(id) on delete cascade,
  evidence_id uuid not null references public.hpc_evidence(id) on delete restrict,
  evidence_payload jsonb not null,
  mapping_payload jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (report_version_id, evidence_id)
);

create index if not exists hpc_annual_summaries_school_year_idx on public.hpc_annual_summaries(school_id, academic_year, status);
create index if not exists hpc_report_versions_summary_idx on public.hpc_report_versions(annual_summary_id, version_number desc);
create index if not exists hpc_report_snapshot_version_idx on public.hpc_report_evidence_snapshot(report_version_id);

alter table public.hpc_annual_summaries enable row level security;
alter table public.hpc_report_versions enable row level security;
alter table public.hpc_report_evidence_snapshot enable row level security;
revoke all on public.hpc_annual_summaries, public.hpc_report_versions, public.hpc_report_evidence_snapshot from anon, authenticated;
grant all on public.hpc_annual_summaries, public.hpc_report_versions, public.hpc_report_evidence_snapshot to service_role;

alter table public.hpc_share_links drop constraint if exists hpc_share_links_contribution_type_check;
alter table public.hpc_share_links add constraint hpc_share_links_contribution_type_check check (contribution_type in ('peer_feedback','parent_feedback','final_hpc'));

-- Final reports are immutable. Service-role clients may insert, but cannot mutate snapshots.
create or replace function public.prevent_hpc_final_report_mutation() returns trigger language plpgsql as $$
begin
  raise exception 'Final HPC report versions and evidence snapshots are immutable';
end;
$$;
drop trigger if exists hpc_report_versions_immutable on public.hpc_report_versions;
create trigger hpc_report_versions_immutable before update or delete on public.hpc_report_versions for each row execute function public.prevent_hpc_final_report_mutation();
drop trigger if exists hpc_report_snapshot_immutable on public.hpc_report_evidence_snapshot;
create trigger hpc_report_snapshot_immutable before update or delete on public.hpc_report_evidence_snapshot for each row execute function public.prevent_hpc_final_report_mutation();
