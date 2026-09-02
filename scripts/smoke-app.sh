#!/usr/bin/env bash
# End-to-end smoke test of the running app against the migrated schema.
# Complements scripts/test-migration-regression.sh, which checks the database:
# this checks that the API layer still behaves once the chain has been applied.
#
#   npx supabase start && npm run dev
#   ./scripts/smoke-app.sh

set -uo pipefail
cd "$(dirname "$0")/.."
RUN_ID="smoke-$(date +%s%N)"
APP=${APP:-http://localhost:3000}
API=${API:-http://127.0.0.1:54321}
DB="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
ANON=$(grep '^SUPABASE_PUBLISHABLE_KEY=' .env | cut -d= -f2-)

FAILED=0
pass(){ printf '  \033[32mPASS\033[0m  %s\n' "$1"; }
fail(){ printf '  \033[31mFAIL\033[0m  %s\n' "$1"; FAILED=$((FAILED+1)); }
head(){ printf '\n\033[1m%s\033[0m\n' "$1"; }
code(){ curl -s -o /dev/null -w '%{http_code}' --max-time 25 "$@"; }
eq(){ [ "$2" = "$3" ] && pass "$1" || fail "$1 (expected '$3', got '$2')"; }
q(){ psql "$DB" -tAqc "$1" 2>/dev/null; }

curl -s -o /dev/null --max-time 8 "$APP/health" || { echo "App unreachable at $APP. Run: npm run dev"; exit 1; }

head "Public surface"
eq "health"                "$(code "$APP/health")" "200"
eq "marketing page"        "$(code "$APP/")" "200"
eq "auth config serves keys" "$(curl -s --max-time 20 "$APP/api/auth/config" | grep -c publishableKey)" "1"
eq "workspace rejects anonymous" "$(code "$APP/api/workspace")" "401"

head "Sign-up and profile"
S=$(curl -s --max-time 30 -X POST "$API/auth/v1/signup" -H "apikey: $ANON" -H "Content-Type: application/json" \
     -d "{\"email\":\"smoke+$(date +%s%N)@school.test\",\"password\":\"password123\"}")
TOK=$(echo "$S" | python3 -c "import sys,json;print(json.load(sys.stdin).get('access_token',''))")
UID_=$(echo "$S" | python3 -c "import sys,json;print((json.load(sys.stdin).get('user') or {}).get('id',''))")
[ -n "$TOK" ] && pass "signed up" || { fail "sign-up failed"; exit 1; }
eq "profile created" "$(curl -s --max-time 30 -X PUT "$APP/api/profile" -H "Authorization: Bearer $TOK" -H "Content-Type: application/json" \
     -d '{"name":"Smoke Teacher","school":"Smoke School"}' | grep -c '"role":"Teacher"')" "1"
eq "profile id is the auth uuid" "$(q "select count(*) from public.users u join auth.users a on a.id=u.id where u.id='$UID_'")" "1"
eq "school created Active" "$(q "select status from public.schools where id=(select school_id from public.users where id='$UID_')")" "Active"

head "Credits"
q "update public.users set total_credits=5, used_credits=0 where id='$UID_'" >/dev/null
eq "balance readable" "$(curl -s --max-time 30 "$APP/api/credits" -H "Authorization: Bearer $TOK" | grep -c '"remaining":5')" "1"
eq "grade without a provider key charges nothing" "$(curl -s --max-time 40 -X POST "$APP/api/grade" -H "Authorization: Bearer $TOK" -H "Content-Type: application/json" \
     -d '{"ocrText":"a","questionPaperText":"b","operationKey":"smoke:op:00001"}' | grep -c 'OPENAI_API_KEY')" "1"
eq "ledger still empty" "$(q "select count(*) from public.credit_transactions where user_id='$UID_'")" "0"

head "Read model"
# Ids are per-run. Fixed ids collided across runs, which is how the cross-tenant
# write in publish_student_result surfaced: a second run's teacher belonged to a
# different school, and the publish silently updated the first school's row.
PUBLISH_BODY=$(cat <<JSON
{"assessment":{"id":"a-$RUN_ID","title":"Smoke","type":"Quiz","className":"9","section":"A","subject":"Science","maxMarks":10,"date":"2026-08-01","stage":"approved","version":1},
 "result":{"fileId":"f-$RUN_ID","studentName":"Smoke Student","rollNumber":"9A-01","score":7.5,"maxMarks":10,"gaps":[{"concept":"X","mastery":40,"finding":"F"}],"ocrText":"SMOKE-OCR","questionDecisions":[{"id":"q1","rationale":"SMOKE-RATIONALE"}]},
 "resources":[]}
JSON
)
eq "publish accepted" "$(curl -s --max-time 30 -X POST "$APP/api/publish" -H "Authorization: Bearer $TOK" -H "Content-Type: application/json" -d "$PUBLISH_BODY" | grep -c '"published":true')" "1"
eq "half marks survived" "$(q "select score from public.grade_results where assessment_id='a-$RUN_ID'")" "7.50"
eq "rehydration returns the detail" "$(curl -s --max-time 30 "$APP/api/publish?assessmentId=a-$RUN_ID&fileId=f-$RUN_ID" -H "Authorization: Bearer $TOK" | grep -c 'SMOKE-OCR')" "1"

head "Role boundaries"
eq "teacher blocked from parent portal"   "$(code "$APP/api/parent/children" -H "Authorization: Bearer $TOK")" "403"
eq "teacher blocked from platform admin"  "$(code "$APP/api/admin/platform-summary" -H "Authorization: Bearer $TOK")" "403"
eq "teacher blocked from user admin"      "$(code "$APP/api/admin/users" -H "Authorization: Bearer $TOK")" "403"

head "Direct database access is closed"
eq "anon cannot read the ledger"      "$(curl -s --max-time 20 "$API/rest/v1/credit_transactions?select=id" -H "apikey: $ANON" | grep -c 42501)" "1"
eq "anon cannot read invitations"     "$(curl -s --max-time 20 "$API/rest/v1/invitations?select=email" -H "apikey: $ANON" | grep -c 42501)" "1"
eq "anon cannot read users"           "$(curl -s --max-time 20 "$API/rest/v1/users?select=email" -H "apikey: $ANON" | grep -c 42501)" "1"

echo
if [ "$FAILED" -eq 0 ]; then printf '\033[32mApp smoke test passed.\033[0m\n'; else printf '\033[31m%s check(s) failed.\033[0m\n' "$FAILED"; fi
exit $FAILED
