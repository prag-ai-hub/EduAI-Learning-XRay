-- Prompt 4: every Secondary applied-learning record contributes a reviewable HPC evidence item.
alter table public.hpc_evidence add column if not exists applied_learning_record_id uuid references public.hpc_applied_learning_records(id) on delete cascade;
create unique index if not exists hpc_evidence_applied_learning_record_idx on public.hpc_evidence(applied_learning_record_id) where applied_learning_record_id is not null;

alter table public.hpc_evidence drop constraint if exists hpc_evidence_source_type_check;
alter table public.hpc_evidence add constraint hpc_evidence_source_type_check check (source_type in ('teacher_observation','student_reflection','peer_feedback','parent_feedback','academic_reference','portfolio','upload','applied_learning'));
