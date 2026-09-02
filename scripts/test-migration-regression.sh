#!/usr/bin/env bash
# Regression check: does the M5..M14 chain preserve a database that already has
# real data in the pre-M5 shape?
#
# Every migration so far has been tested on a FRESH database, where the tables
# are empty and a conversion has nothing to lose. Production is the opposite
# case. This harness rebuilds the database at the M1-M4 state, seeds it the way
# a live pilot school would look - text user ids, role 'Admin', integer scores,
# a populated workspace blob, a credit ledger, an evaluation version - then runs
# the whole chain and checks nothing was lost or silently changed.
#
#   npx supabase start
#   ./scripts/test-migration-regression.sh

set -uo pipefail
cd "$(dirname "$0")/.."

DB="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
MIG="supabase/migrations"
HOLD=".migrations-held"
# Everything from M5 onward, applied by hand after seeding.
#
# Derived from the migrations directory rather than listed. A hardcoded list
# drifts: M15 was written and the list was not updated, so this harness silently
# exercised an incomplete chain and reported a clean run against the old, buggy
# behaviour. Anything after the last pre-existing migration is the chain.
BASELINE_LAST="20260819000000_evaluator_grading_foundation.sql"
mapfile -t CHAIN < <(ls "$MIG" | grep -E '^[0-9]{14}_.*\.sql$' | sort | awk -v b="$BASELINE_LAST" '$0 > b')
if [ "${#CHAIN[@]}" -eq 0 ]; then echo "No migrations found after $BASELINE_LAST"; exit 1; fi

FAILED=0
pass(){ printf '  \033[32mPASS\033[0m  %s\n' "$1"; }
fail(){ printf '  \033[31mFAIL\033[0m  %s\n' "$1"; FAILED=$((FAILED+1)); }
head(){ printf '\n\033[1m%s\033[0m\n' "$1"; }
q(){ psql "$DB" -tAqc "$1" 2>/dev/null; }
eq(){ [ "$2" = "$3" ] && pass "$1" || fail "$1 (expected '$3', got '$2')"; }

cleanup(){ [ -d "$HOLD" ] && mv "$HOLD"/*.sql "$MIG/" 2>/dev/null; rmdir "$HOLD" 2>/dev/null; return 0; }
trap cleanup EXIT

psql "$DB" -c 'select 1' >/dev/null 2>&1 || { echo "Local Supabase unreachable. Run: npx supabase start"; exit 1; }

head "Rebuilding at the M1-M4 state"
mkdir -p "$HOLD"
for f in "${CHAIN[@]}"; do mv "$MIG/$f" "$HOLD/" 2>/dev/null; done
npx supabase db reset --no-seed >/dev/null 2>&1
for f in "${CHAIN[@]}"; do mv "$HOLD/$f" "$MIG/" 2>/dev/null; done
rmdir "$HOLD" 2>/dev/null
eq "users.id starts as text" "$(q "select data_type from information_schema.columns where table_schema='public' and table_name='users' and column_name='id'")" "text"
eq "grade_results.score starts as integer" "$(q "select data_type from information_schema.columns where table_schema='public' and table_name='grade_results' and column_name='score'")" "integer"

head "Seeding a database that looks like a live pilot"
A1=$(q "insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at) values ('00000000-0000-0000-0000-000000000000',gen_random_uuid(),'authenticated','authenticated','head@pilot.school',crypt('x','md5'),now(),now(),now()) returning id")
A2=$(q "insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at) values ('00000000-0000-0000-0000-000000000000',gen_random_uuid(),'authenticated','authenticated','teacher@pilot.school',crypt('x','md5'),now(),now(),now()) returning id")

psql "$DB" -v ON_ERROR_STOP=1 -q >/dev/null 2>&1 <<SQL
insert into public.schools(id,name,city,board) values ('school-pilot','Pilot Academy','Pune','CBSE');
-- Pre-M7 vocabulary: 'Admin', and school_id mandatory for everyone.
insert into public.users(id,school_id,name,email,role,total_credits,used_credits) values
  ('$A1','school-pilot','Pilot Head','head@pilot.school','Admin',100,10),
  ('$A2','school-pilot','Pilot Teacher','teacher@pilot.school','Teacher',50,7);
insert into public.classes(id,school_id,academic_year,class_name,section,subject,teacher_id)
  values ('cls-pilot','school-pilot','2026-27','9','A','Science','$A2');
insert into public.students(id,school_id,class_id,name,roll_number)
  values ('stu-pilot','school-pilot','cls-pilot','Legacy Student','9A-01');
insert into public.assessments(id,school_id,class_id,title,activity_type,subject,max_marks,assessment_date,stage,version)
  values ('a-pilot','school-pilot','cls-pilot','Legacy Assessment','Quiz','Science',20,'2026-07-01','review',1);
insert into public.uploaded_files(id,assessment_id,storage_path,filename,content_type,size_bytes,purpose,processing_status)
  values ('f-pilot','a-pilot','school-pilot/uploads/f-pilot','legacy.pdf','application/pdf',1000,'answer','complete');
insert into public.grade_results(id,assessment_id,file_id,student_id,student_name,score,max_marks,feedback,gaps_json)
  values ('gr-pilot','a-pilot','f-pilot','stu-pilot','Legacy Student',14,20,'Legacy feedback','[{"concept":"Legacy gap","mastery":45}]'::jsonb);
insert into public.credit_transactions(user_id,amount,transaction_type,operation_key,reason)
  values ('$A2',-1,'consumption','legacy:op:0001','Legacy consumption');
insert into public.invitations(email,name,role,school_id,invited_by)
  values ('invited@pilot.school','Invited Teacher','Teacher','school-pilot','$A1');
insert into public.evaluation_versions(school_id,assessment_id,assessment_version,file_id,student_name,evaluator_id,version_number,status,total_awarded,total_max,content_hash,idempotency_key,snapshot_json,submitted_at)
  values ('school-pilot','a-pilot',1,'f-pilot','Legacy Student','$A2',1,'submitted',14,20,'deadbeef','legacy:eval:0001','{"questions":[]}'::jsonb,now());
insert into public.workspace_snapshots(workspace_id,state_json)
  values ('teacher:$A2','{"assessments":[{"id":"a-pilot","title":"Legacy Assessment","grade":"9","section":"A","subject":"Science","gradeResults":{"f-pilot":{"fileId":"f-pilot","studentName":"Legacy Student","score":14,"maxMarks":20,"ocrText":"LEGACY-OCR","gaps":[{"concept":"Legacy gap","mastery":45}]}}}],"resources":[],"students":[],"events":["legacy"]}'::jsonb);
SQL
BEFORE_USERS=$(q "select count(*) from public.users")
BEFORE_LEDGER=$(q "select count(*) from public.credit_transactions")
BEFORE_EVAL=$(q "select count(*) from public.evaluation_versions")
eq "seeded users" "$BEFORE_USERS" "2"
eq "seeded ledger rows" "$BEFORE_LEDGER" "1"
pass "seeded classes, students, assessments, grade_results, invitations, evaluation_versions, workspace blob"

head "Applying M5..M14 over that data"
for f in "${CHAIN[@]}"; do
  OUT=$(psql "$DB" -v ON_ERROR_STOP=1 -q -f "$MIG/$f" 2>&1)
  if [ $? -ne 0 ]; then fail "$f"; echo "$OUT" | grep -i error | head -2 | sed 's/^/        /'; else pass "${f%%_*} applied"; fi
done

head "Nothing lost"
eq "user rows preserved"             "$(q "select count(*) from public.users")"              "$BEFORE_USERS"
eq "ledger rows preserved"           "$(q "select count(*) from public.credit_transactions")" "$BEFORE_LEDGER"
eq "evaluation versions preserved"   "$(q "select count(*) from public.evaluation_versions")" "$BEFORE_EVAL"
eq "classes preserved"               "$(q "select count(*) from public.classes")"            "1"
eq "grade_results preserved"         "$(q "select count(*) from public.grade_results")"      "1"
eq "invitations preserved"           "$(q "select count(*) from public.invitations")"        "1"
eq "workspace snapshot preserved"    "$(q "select state_json->'assessments'->0->>'title' from public.workspace_snapshots where workspace_id='teacher:$A2'")" "Legacy Assessment"
eq "blob content intact"             "$(q "select state_json->'assessments'->0->'gradeResults'->'f-pilot'->>'ocrText' from public.workspace_snapshots where workspace_id='teacher:$A2'")" "LEGACY-OCR"

head "Converted correctly"
eq "users.id is now uuid"            "$(q "select data_type from information_schema.columns where table_schema='public' and table_name='users' and column_name='id'")" "uuid"
eq "classes.teacher_id is now uuid"  "$(q "select data_type from information_schema.columns where table_schema='public' and table_name='classes' and column_name='teacher_id'")" "uuid"
eq "schools.id deliberately still text" "$(q "select data_type from information_schema.columns where table_schema='public' and table_name='schools' and column_name='id'")" "text"
eq "legacy 'Admin' became SchoolAdmin" "$(q "select role from public.users where email='head@pilot.school'")" "SchoolAdmin"
eq "Teacher role untouched"          "$(q "select role from public.users where email='teacher@pilot.school'")" "Teacher"
eq "legacy invitation role valid"    "$(q "select role from public.invitations where email='invited@pilot.school'")" "Teacher"
eq "existing school set Active"      "$(q "select status from public.schools where id='school-pilot'")" "Active"
eq "score is numeric, value kept"    "$(q "select score from public.grade_results where id='gr-pilot'")" "14.00"
eq "teacher_id still resolves"       "$(q "select count(*) from public.classes c join public.users u on u.id=c.teacher_id")" "1"
eq "evaluator_id still resolves"     "$(q "select count(*) from public.evaluation_versions e join public.users u on u.id=e.evaluator_id")" "1"
eq "profiles join auth.users"        "$(q "select count(*) from public.users u join auth.users a on a.id=u.id")" "2"

head "Still works after the chain"
R=$(q "select out_charged||'/'||out_remaining_credits from public.consume_credit('$A2','regression:op:0001','check',1)")
eq "consume_credit charges"          "$R" "true/42"
# Concatenating a boolean renders 'true'/'false'; selecting one bare gives 't'/'f'.
R=$(q "select out_charged::text from public.consume_credit('$A2','legacy:op:0001','replay',1)")
eq "legacy operation key still idempotent" "$R" "false"
q "select public.refund_credit('$A2','regression:op:0001','undo')" >/dev/null
eq "refund restores"                 "$(q "select total_credits-used_credits from public.users where id='$A2'")" "43"

# The interaction, not the two mechanisms in isolation. Idempotency and
# refunding were each covered; together they made every retry after a failure
# permanently free, because the consumption row stayed and kept answering
# "already charged". /api/grade reproduces the same key for the same evidence,
# so one failed analysis used to buy unlimited free retries.
eq "a refunded operation can be charged again" "$(q "select out_charged::text from public.consume_credit('$A2','regression:op:0001','retry',1)")" "true"
eq "and that retry actually cost a credit"     "$(q "select total_credits-used_credits from public.users where id='$A2'")" "42"
eq "an unrefunded operation is still a replay" "$(q "select out_charged::text from public.consume_credit('$A2','regression:op:0001','again',1)")" "false"
eq "the reversal is recorded on the charge"    "$(q "select count(*) from public.credit_transactions where user_id='$A2' and transaction_type='consumption' and refunded_at is not null")" "1"

head "Security posture after the chain"
eq "tables without RLS"              "$(q "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity")" "0"
eq "anon/authenticated table grants" "$(q "select count(*) from information_schema.role_table_grants where table_schema='public' and grantee in ('anon','authenticated')")" "0"
eq "public tables referencing auth.users" "$(q "select count(*) from pg_constraint con join pg_class rel on rel.oid=con.conrelid join pg_namespace ns on ns.oid=rel.relnamespace where con.contype='f' and con.confrelid='auth.users'::regclass and ns.nspname='public' and rel.relname<>'users'")" "0"

head "Restoring a clean database"
npx supabase db reset --no-seed >/dev/null 2>&1
echo
if [ "$FAILED" -eq 0 ]; then printf '\033[32mAll regression checks passed.\033[0m\n'; else printf '\033[31m%s check(s) failed.\033[0m\n' "$FAILED"; fi
exit $FAILED
