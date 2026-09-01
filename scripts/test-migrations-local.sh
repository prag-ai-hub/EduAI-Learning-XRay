#!/usr/bin/env bash
# Integration test for M5 (identity unification) and M6 (credit repair)
# against the LOCAL Supabase stack. Never touches a remote project.
#
#   npx supabase start          # once
#   ./scripts/test-migrations-local.sh
#
# A fresh database has no rows, so applying M5 to it proves only that the SQL
# parses. This harness rebuilds the database at the M1-M4 state, seeds
# representative data, and only then applies M5/M6 - which is the conversion
# that actually has to work.

set -uo pipefail
cd "$(dirname "$0")/.."

DB="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
MIG="supabase/migrations"
HOLD=".migrations-held"
M5="20260902000000_identity_uuid_unification.sql"
M6="20260902000100_credit_function_repair.sql"

FAILED=0
pass(){ printf '  \033[32mPASS\033[0m  %s\n' "$1"; }
fail(){ printf '  \033[31mFAIL\033[0m  %s\n' "$1"; FAILED=$((FAILED+1)); }
head(){ printf '\n\033[1m%s\033[0m\n' "$1"; }
q(){ psql "$DB" -tAqc "$1" 2>/dev/null; }

cleanup(){ [ -d "$HOLD" ] && mv "$HOLD"/*.sql "$MIG/" 2>/dev/null; rmdir "$HOLD" 2>/dev/null; return 0; }
trap cleanup EXIT

if ! psql "$DB" -c 'select 1' >/dev/null 2>&1; then
  echo "Local Supabase is not reachable at $DB"
  echo "Run: npx supabase start"
  exit 1
fi

# Rebuild the database with only M1-M4 applied.
reset_to_m4(){
  mkdir -p "$HOLD"
  mv "$MIG/$M5" "$MIG/$M6" "$HOLD/" 2>/dev/null
  npx supabase db reset --no-seed >/dev/null 2>&1
  local rc=$?
  mv "$HOLD/$M5" "$HOLD/$M6" "$MIG/" 2>/dev/null
  rmdir "$HOLD" 2>/dev/null
  return $rc
}

apply(){ psql "$DB" -v ON_ERROR_STOP=1 -q -f "$MIG/$1" 2>&1; }

# ---------------------------------------------------------------------------
head "Rebuilding database at the M1-M4 state"
reset_to_m4 || { echo "db reset failed"; exit 1; }
[ "$(q "select data_type from information_schema.columns where table_schema='public' and table_name='users' and column_name='id'")" = "text" ] \
  && pass "users.id starts as text (pre-M5 state confirmed)" \
  || fail "expected users.id to be text before M5"

# ---------------------------------------------------------------------------
head "Seeding representative data"
AUTH_ID=$(q "insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
             values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
                     'teacher@test.school', crypt('password123', gen_salt('bf')), now(), now(), now())
             returning id")
if [ -z "$AUTH_ID" ]; then fail "could not create an auth.users row"; exit 1; fi
pass "auth user created: $AUTH_ID"

psql "$DB" -v ON_ERROR_STOP=1 -q >/dev/null 2>&1 <<SQL
insert into public.schools (id, name) values ('school-$AUTH_ID', 'Test School');
insert into public.users (id, school_id, name, email, role, total_credits, used_credits)
  values ('$AUTH_ID', 'school-$AUTH_ID', 'Test Teacher', 'teacher@test.school', 'Teacher', 5, 0);
insert into public.classes (id, school_id, academic_year, class_name, section, subject, teacher_id)
  values ('class-1', 'school-$AUTH_ID', '2026-27', '6', 'A', 'Mathematics', '$AUTH_ID');
insert into public.assessments (id, school_id, title, activity_type, subject, max_marks, assessment_date, stage)
  values ('assess-1', 'school-$AUTH_ID', 'Fractions', 'Quiz', 'Mathematics', 20, current_date, 'draft');
SQL
[ "$(q "select count(*) from public.users")" = "1" ] && pass "public.users seeded with a text id" || fail "seed failed"
[ "$(q "select count(*) from public.classes where teacher_id='$AUTH_ID'")" = "1" ] && pass "classes.teacher_id references it" || fail "class seed failed"

FK_BEFORE=$(q "select count(*) from pg_constraint where contype='f' and confrelid='public.users'::regclass")
pass "$FK_BEFORE foreign key(s) currently point at public.users"

# ---------------------------------------------------------------------------
head "Applying M5 - identity unification"
OUT=$(apply "$M5"); RC=$?
if [ $RC -ne 0 ]; then fail "M5 failed to apply"; echo "$OUT" | sed 's/^/      /'; else pass "M5 applied cleanly"; fi
echo "$OUT" | grep -q "preflight passed" && pass "preflight ran and passed" || fail "preflight did not report success"

[ "$(q "select data_type from information_schema.columns where table_schema='public' and table_name='users' and column_name='id'")" = "uuid" ] \
  && pass "users.id converted to uuid" || fail "users.id was not converted"
[ "$(q "select data_type from information_schema.columns where table_schema='public' and table_name='classes' and column_name='teacher_id'")" = "uuid" ] \
  && pass "classes.teacher_id converted to uuid" || fail "classes.teacher_id was not converted"
[ "$(q "select data_type from information_schema.columns where table_schema='public' and table_name='schools' and column_name='id'")" = "text" ] \
  && pass "schools.id deliberately left as text" || fail "schools.id should NOT have been converted"

FK_AFTER=$(q "select count(*) from pg_constraint where contype='f' and confrelid='public.users'::regclass")
[ "$FK_AFTER" = "$FK_BEFORE" ] && pass "all $FK_AFTER foreign key(s) restored" || fail "FK count changed: $FK_BEFORE -> $FK_AFTER"

[ "$(q "select count(*) from public.users u join auth.users a on a.id=u.id")" = "1" ] \
  && pass "public.users now joins auth.users on id (the whole point)" || fail "join against auth.users still fails"
[ "$(q "select count(*) from public.classes where teacher_id='$AUTH_ID'")" = "1" ] \
  && pass "row data survived the conversion" || fail "data lost during conversion"

# ---------------------------------------------------------------------------
head "Applying M6 - credit function repair"
OUT=$(apply "$M6"); RC=$?
[ $RC -eq 0 ] && pass "M6 applied cleanly" || { fail "M6 failed to apply"; echo "$OUT" | sed 's/^/      /'; }

SIG=$(q "select pg_get_function_identity_arguments(p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='consume_credit'")
[[ "$SIG" == uuid,* ]] && pass "consume_credit now takes uuid first: ($SIG)" || fail "unexpected signature: ($SIG)"
[ "$(q "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='consume_credit'")" = "1" ] \
  && pass "the old text signature is gone (exactly one overload)" || fail "old signature still present"
[ "$(q "select has_function_privilege('authenticated', p.oid, 'EXECUTE') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='consume_credit'")" = "f" ] \
  && pass "authenticated can NOT execute it (escalation closed)" || fail "authenticated can still execute consume_credit"
[ "$(q "select has_function_privilege('service_role', p.oid, 'EXECUTE') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='consume_credit'")" = "t" ] \
  && pass "service_role can execute it" || fail "service_role cannot execute consume_credit"

# ---------------------------------------------------------------------------
head "Behaviour: charging, idempotency, exhaustion, refund"
R=$(q "select charged || '|' || remaining_credits from public.consume_credit('$AUTH_ID'::uuid, 'analysis:test:001', 'first', 1)")
[ "$R" = "t|4" ] && pass "first charge succeeded, 5 -> 4 remaining" || fail "expected t|4, got '$R'"

R=$(q "select charged || '|' || remaining_credits from public.consume_credit('$AUTH_ID'::uuid, 'analysis:test:001', 'replay', 1)")
[ "$R" = "f|4" ] && pass "replaying the same operation key does not double-charge" || fail "expected f|4, got '$R'"

q "select public.consume_credit('$AUTH_ID'::uuid, 'analysis:test:00'||g, 'bulk', 1) from generate_series(2,5) g" >/dev/null
R=$(q "select total_credits - used_credits from public.users where id='$AUTH_ID'")
[ "$R" = "0" ] && pass "credits exhausted correctly (0 remaining)" || fail "expected 0 remaining, got '$R'"

ERR=$(psql "$DB" -tAqc "select public.consume_credit('$AUTH_ID'::uuid, 'analysis:test:over', 'overdraw', 1)" 2>&1)
echo "$ERR" | grep -qi "insufficient credits" && pass "overdrawing is rejected" || fail "expected 'Insufficient credits', got: $ERR"

q "select public.refund_credit('$AUTH_ID'::uuid, 'analysis:test:001', 'test refund')" >/dev/null
R=$(q "select total_credits - used_credits from public.users where id='$AUTH_ID'")
[ "$R" = "1" ] && pass "refund restored one credit" || fail "expected 1 remaining after refund, got '$R'"

q "select public.refund_credit('$AUTH_ID'::uuid, 'analysis:test:001', 'double refund')" >/dev/null
R=$(q "select total_credits - used_credits from public.users where id='$AUTH_ID'")
[ "$R" = "1" ] && pass "refunding twice is idempotent" || fail "double refund changed the balance to '$R'"

R=$(q "select count(*) from public.credit_transactions where user_id='$AUTH_ID'")
pass "credit ledger holds $R transaction(s)"

# ---------------------------------------------------------------------------
head "Negative test: M5 must refuse to run on non-UUID data"
reset_to_m4 || { echo "db reset failed"; exit 1; }
psql "$DB" -v ON_ERROR_STOP=1 -q >/dev/null 2>&1 <<SQL
insert into public.schools (id, name) values ('school-legacy', 'Legacy School');
insert into public.users (id, school_id, name, email, role)
  values ('legacy-user-not-a-uuid', 'school-legacy', 'Legacy', 'legacy@test.school', 'Teacher');
SQL
OUT=$(apply "$M5"); RC=$?
if [ $RC -ne 0 ] && echo "$OUT" | grep -q "M5 preflight FAILED"; then
  pass "M5 aborted with a clear preflight error instead of corrupting data"
else
  fail "M5 should have refused to run (rc=$RC)"
fi
[ "$(q "select data_type from information_schema.columns where table_schema='public' and table_name='users' and column_name='id'")" = "text" ] \
  && pass "schema left untouched by the aborted run" || fail "schema was modified despite the abort"

# ---------------------------------------------------------------------------
head "Restoring a clean local database with every migration applied"
npx supabase db reset --no-seed >/dev/null 2>&1
[ "$(q "select data_type from information_schema.columns where table_schema='public' and table_name='users' and column_name='id'")" = "uuid" ] \
  && pass "full migration chain M1-M6 applies from scratch" || fail "full chain failed"

echo
if [ "$FAILED" -eq 0 ]; then printf '\033[32mAll checks passed.\033[0m\n'; else printf '\033[31m%s check(s) failed.\033[0m\n' "$FAILED"; fi
exit $FAILED
