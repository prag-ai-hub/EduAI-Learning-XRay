-- Approved source packages for each PARAKH HPC stage.  Kept independently
-- versioned so a historical learner record always identifies its source.

create table if not exists public.hpc_stage_source_packages (
  id uuid primary key default gen_random_uuid(),
  stage_template_id uuid not null references public.hpc_stage_templates(id) on delete cascade,
  source_name text not null,
  source_reference text not null,
  source_published_at date,
  version_label text not null,
  status text not null default 'approved' check (status in ('draft','approved','retired')),
  created_at timestamptz not null default now(),
  unique (stage_template_id, version_label)
);

alter table public.hpc_stage_source_packages enable row level security;
revoke all on public.hpc_stage_source_packages from anon, authenticated;
grant all on public.hpc_stage_source_packages to service_role;

insert into public.hpc_stage_source_packages (stage_template_id, source_name, source_reference, source_published_at, version_label, status)
select template.id, 'PARAKH / NCERT — How to fill the HPC (' || template.title || ')', source.source_reference, date '2023-12-01', '2023 official guide', 'approved'
from public.hpc_stage_templates template
join public.hpc_framework_versions framework on framework.id = template.framework_version_id
join (values
  ('foundational'::text, 'https://parakh.ncert.gov.in/themes/parakh/hpc-files/how-to-fill-pdf/How-to-fill-the-HPC-(Foundational-Stage).pdf'),
  ('preparatory', 'https://parakh.ncert.gov.in/themes/parakh/hpc-files/how-to-fill-pdf/How-to-fill-the-HPC-(Preparatory-Stage).pdf'),
  ('middle', 'https://parakh.ncert.gov.in/themes/parakh/hpc-files/how-to-fill-pdf/How-to-fill-the-HPC-(Middle-Stage).pdf'),
  ('secondary', 'https://parakh.ncert.gov.in/themes/parakh/hpc-files/how-to-fill-pdf/How-to-fill-the-HPC-(Secondary-Stage).pdf')
) as source(stage_code, source_reference) on source.stage_code = template.stage_code
where framework.framework_code = 'PARAKH_HPC_MIDDLE_STAGE' and framework.status = 'approved'
on conflict (stage_template_id, version_label) do update set
  source_name = excluded.source_name,
  source_reference = excluded.source_reference,
  source_published_at = excluded.source_published_at,
  status = excluded.status;
