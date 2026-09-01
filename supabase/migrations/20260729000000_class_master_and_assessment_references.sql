do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'classes' and column_name = 'grade'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'classes' and column_name = 'class_name'
  ) then
    alter table public.classes rename column grade to class_name;
  end if;
end
$$;

alter table public.classes
  drop constraint if exists classes_class_name_check;

alter table public.classes
  add constraint classes_class_name_check
  check (class_name ~ '^([1-9]|1[0-2])$') not valid;

alter table public.classes
  validate constraint classes_class_name_check;

alter table public.assessments
  add column if not exists question_paper_file_id text,
  add column if not exists marking_scheme_file_id text,
  add column if not exists model_answer_file_id text;

update public.users
set profile_json = (profile_json - 'grades')
  || jsonb_build_object('classes', coalesce(profile_json->'classes', profile_json->'grades', '""'::jsonb))
where profile_json ? 'grades';

update public.workspace_snapshots
set state_json = jsonb_set(
  state_json,
  '{assessments}',
  (
    select coalesce(
      jsonb_agg(
        case
          when item ? 'grade'
          then (item - 'grade') || jsonb_build_object('className', coalesce(item->'className', item->'grade'))
          else item
        end
      ),
      '[]'::jsonb
    )
    from jsonb_array_elements(state_json->'assessments') item
  )
)
where jsonb_typeof(state_json->'assessments') = 'array';
