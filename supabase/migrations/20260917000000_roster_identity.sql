-- M19 — a class and a roll number identify one row, and the database says so
--
-- `classes` and `students` have existed since M1 with no uniqueness at all.
-- That was survivable while nothing could create them: the only rows came from
-- SQL written by hand. Day 17 adds the API that lets a school manage its own
-- roster, and an API without these constraints produces duplicates on the
-- ordinary path - a double-clicked "Save class & subject", a CSV imported
-- twice, two administrators adding the same child.
--
-- Serializer-level checks cannot close this. Two concurrent requests both read
-- "no such class", both insert, and both succeed; only a unique index refuses
-- the second. So the rule lives here, and the API turns the resulting
-- IntegrityError into a readable message.
--
-- Nothing is backfilled or deduplicated: both tables are empty in every
-- environment this has been checked against, and a migration that silently
-- merged real roster rows would be a worse problem than the one it solved. If a
-- future environment has duplicates, this migration fails loudly there, which is
-- the correct outcome - the merge is a decision for whoever owns that data.

-- ---------------------------------------------------------------------------
-- A class is (school, academic year, class, section, subject)
--
-- Subject is part of the identity on purpose: `classes` is the unit an
-- assessment attaches to, and "6C Mathematics" and "6C Science" are two
-- different teaching units with different teachers and different evidence.
-- ---------------------------------------------------------------------------
create unique index if not exists classes_identity_key
  on public.classes (school_id, academic_year, class_name, section, subject);

comment on index public.classes_identity_key is
  'One row per school/year/class/section/subject. Subject is part of the identity: an assessment attaches to a teaching unit, not to a homeroom.';

-- ---------------------------------------------------------------------------
-- A roll number is unique within a school, when there is one
--
-- Partial, because `roll_number` is nullable and blank is legitimate: a school
-- that does not issue roll numbers still has students, and NULLs would
-- otherwise all collide under a plain unique index in the blank case. Scoped to
-- the school rather than the class because that is how a school hands them out,
-- and because a student moving between sections keeps their number.
-- ---------------------------------------------------------------------------
create unique index if not exists students_roll_number_key
  on public.students (school_id, roll_number)
  where roll_number is not null and roll_number <> '';

comment on index public.students_roll_number_key is
  'A roll number identifies one student within a school. Partial: blank and NULL are legitimate for schools that do not issue them.';

-- ---------------------------------------------------------------------------
-- A student's status is one of two values
--
-- The column has carried free text since M1, and - checked, not assumed -
-- nothing currently filters on it: no migration, no queryset, no read model.
-- That is precisely why it is worth constraining now rather than later. The
-- roster API is about to become the only writer of this column, every caller
-- of it writes 'Active' or 'Inactive', and a column whose domain is undefined
-- acquires 'active', 'ACTIVE' and 'Left' the first time something else writes
-- to it. Two values, chosen because they are the two the product already uses.
-- ---------------------------------------------------------------------------
alter table public.students drop constraint if exists students_status_check;
alter table public.students
  add constraint students_status_check check (status in ('Active', 'Inactive'));
