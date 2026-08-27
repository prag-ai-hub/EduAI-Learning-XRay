-- Prompt 3: permit HPC support actions to appear in the existing intervention workflow.
alter table public.interventions alter column assessment_id drop not null;
alter table public.interventions add column if not exists source_type text not null default 'academic_xray';
alter table public.interventions add column if not exists hpc_support_action_id uuid unique references public.hpc_holistic_support_actions(id) on delete set null;
alter table public.hpc_holistic_support_actions add column if not exists learning_xray_intervention_id text unique references public.interventions(id) on delete set null;
