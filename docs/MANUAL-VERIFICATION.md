# Manual verification checklist — everything changed so far

Work yourself down this list. Each item says what changed, exactly how to check it,
and what you should see. Nothing here needs a remote database.

App: http://localhost:3000 · Studio: http://127.0.0.1:54323 · Mailpit: http://127.0.0.1:54324

---

## Day 1 — nothing to click

Day 1 was design only: three documents, no code. There is nothing to test.
What it needs from you is **review**, because everything after it is built on
these decisions:

| Document | The decisions to sanity-check |
|---|---|
| [docs/plan/01-ROLE-PERMISSION-MATRIX.md](plan/01-ROLE-PERMISSION-MATRIX.md) | Parents never see raw scans, OCR text or AI rationale. SuperAdmin sees de-identified aggregates unless a time-boxed support grant exists. SchoolAdmin cannot grade. |
| [docs/plan/02-PAYMENT-DATA-MODEL.md](plan/02-PAYMENT-DATA-MODEL.md) | Money stored as bigint paise. Gateway is the source of truth; a payment is only captured from a signature-verified webhook. Invoices immutable — corrections are credit notes. |
| [docs/plan/03-MIGRATION-PLAN-AND-SEQUENCING.md](plan/03-MIGRATION-PLAN-AND-SEQUENCING.md) | Identity migrates **before** parent links. `schools.id` stays text. Plan reflows 25 → 28 days. |

If you disagree with any of those, say so now — they get harder to change each day.

---

## Toolchain — `ed09369`

**What changed:** Node 22.23.2 installed to `~/.local`, vinext restored to 0.0.50,
React trio aligned at 19.2.8, `.nvmrc` added, `npm test` now runs all five test files.

**Test 1 — Node version**
```bash
node -v
```
Expect `v22.23.2`. If you see v20, open a new terminal.

**Test 2 — the build works** (it was completely broken before)
```bash
npm run build
```
Expect exit 0 and a route list ending `Build complete.`

**Test 3 — install is clean**
```bash
npm install
```
Expect no `ERESOLVE`, no need for `--legacy-peer-deps`.

**Test 4 — full suite**
```bash
npm test
```
Expect `# pass 77`, `# fail 0`.

---

## Day 2, M5 — identity unification — `c7a568f`

**What changed:** `public.users.id` converted from `text` to `uuid` so it matches
`auth.users.id`. Every column referencing it converted too. `schools.id` left as text.

**Test 5 — the column is actually uuid**
Studio → SQL Editor:
```sql
select table_name, column_name, data_type
from information_schema.columns
where table_schema='public' and column_name in ('id','teacher_id','evaluator_id')
  and table_name in ('users','schools','classes','evaluation_versions')
order by table_name;
```
Expect `users.id = uuid`, `classes.teacher_id = uuid`, `evaluation_versions.evaluator_id = uuid`,
and **`schools.id = text`** — that one is deliberate.

**Test 6 — the join that was impossible before**
```sql
select u.email, u.id from public.users u join auth.users a on a.id = u.id;
```
Expect your test user. Before M5 this errored with `operator does not exist: text = uuid`.

**Test 7 — foreign keys survived the conversion**
```sql
select conname, conrelid::regclass as table_name
from pg_constraint where contype='f' and confrelid='public.users'::regclass;
```
Expect 5 rows. M5 dropped and restored these; none should be missing.

**Test 8 — sign up through the UI and confirm a uuid is written**
1. http://localhost:3000/app → create an account (email/password; local auto-confirms)
2. Complete the profile form
3. Studio → Table Editor → `users` → your new row's `id` is a uuid, and it matches
   the same row in `auth.users`

**Test 9 — M5 refuses to run on bad data** (the safety guard)
```bash
./scripts/test-migrations-local.sh
```
This rebuilds the DB at the M1–M4 state, seeds rows, applies M5/M6, then seeds a
non-UUID id and confirms M5 **aborts** rather than corrupting anything.
Expect `All checks passed.`
> It resets your local database. Your test accounts are wiped.

---

## Day 2, M6 — credit repair — `c7a568f`

**What changed:** `consume_credit` / `refund_credit` rewritten to take the user id
explicitly. They were uncallable before — the server calls them with the service-role
key, where `auth.uid()` is NULL, so every analysis failed.

**Test 10 — the old broken signature is gone**
```sql
select proname, pg_get_function_identity_arguments(oid)
from pg_proc where proname in ('consume_credit','refund_credit');
```
Expect exactly two rows, both starting `uuid,`. No `text,text,integer` variant.

**Test 11 — the privilege hole is closed**
```sql
select proname,
       has_function_privilege('authenticated', oid, 'EXECUTE') as authenticated_can_run,
       has_function_privilege('service_role',  oid, 'EXECUTE') as service_role_can_run
from pg_proc where proname in ('consume_credit','refund_credit');
```
Expect `authenticated_can_run = false`, `service_role_can_run = true` for both.
Because the function now trusts the user id passed to it, letting signed-in users
call it directly would let anyone charge anyone.

**Test 12 — charging works end to end** *(this is the headline fix)*
1. Give yourself credits — Studio → SQL:
   ```sql
   update public.users set total_credits = 10 where email = 'YOUR@EMAIL';
   ```
2. Reload the app. Topbar shows `Credits Remaining: 10`.
3. Create an assessment, upload a question paper and a `.txt` answer sheet
   (`.txt` is parsed locally, so no Mistral key needed).
4. Run the analysis.
5. Studio → `credit_transactions` → expect a `consumption` row of `-1`.

Before M6 this failed at the credit step with `Authentication required` every time.

**Test 13 — idempotency: the same operation never double-charges**
```sql
select * from public.consume_credit(
  (select id from public.users where email='YOUR@EMAIL'), 'manual:test:aaa', 'first', 1);
select * from public.consume_credit(
  (select id from public.users where email='YOUR@EMAIL'), 'manual:test:aaa', 'again', 1);
```
Expect `charged = true` then `charged = false`, with `remaining_credits` unchanged
on the second call.

**Test 14 — you cannot overdraw**
```sql
update public.users set used_credits = total_credits where email='YOUR@EMAIL';
select * from public.consume_credit(
  (select id from public.users where email='YOUR@EMAIL'), 'manual:test:over', 'x', 1);
```
Expect the error `Insufficient credits`.

---

## Two bugs found by local testing — `29802af`

**Bug 1 — `column reference "used_credits" is ambiguous`.**
Inherited from M3, where it was unreachable behind the `auth.uid()` failure.
Covered by Test 12: if this had come back, the charge would error instead of working.

**Test 15 — Bug 2: no credit is charged for work that cannot run**
The provider-key check used `return`, not `throw`, so it exited before the `catch`
that issues refunds. A teacher silently lost a credit.
1. Make sure `OPENAI_API_KEY=` is **empty** in `.env`, restart `npm run dev`
2. Note your balance
3. Run an analysis → fails with `OPENAI_API_KEY is not configured.`
4. Balance **unchanged**, and `credit_transactions` has **no new row**

**Test 16 — the refund fires on a genuine mid-flight failure**
1. Set `OPENAI_API_KEY=sk-fake-anything` in `.env`, restart `npm run dev`
2. Run an analysis → fails at the OpenAI call
3. `credit_transactions` now shows a `consumption` row **and** a matching `refund` row
4. Balance back where it started

---

## Local stack & Google OAuth — `29802af`, `d9c7521`

**Test 17 — email/password sign-in** works with no Google setup at all.

**Test 18 — Google sign-in.** Needs the app published in Google Cloud
(Audience → Publish app) so any account can sign in.
Check what the stack sends:
```bash
curl -s -i "http://127.0.0.1:54321/auth/v1/authorize?provider=google&redirect_to=http%3A%2F%2Flocalhost%3A3000%2Fapp" | grep -i '^location:'
```
Expect your real `client_id`, `redirect_uri=http://127.0.0.1:54321/auth/v1/callback`,
`scope=email+profile`. If you see the literal `env(...)`, the stack needs
`npx supabase stop && npx supabase start`.

**Test 19 — `.env.example` is complete.** It documented 4 of 8 variables before;
all 8 now, including `SUPABASE_PUBLISHABLE_KEY`, without which the app returns 503
at startup.

**Test 20 — read-only schema report.** Run `supabase/checks/schema-state.sql` in
Studio. Every migration M1–M6 should say `APPLIED`, and the `GRANTS` rows should say
`service_role only`. This is the script to run against **production** before pushing.

---

## Not yet done — don't test for these

- No migration has been applied to any remote database
- M7 (roles, school status), M8 (parent links), M9/M10 (payments) not written yet
- No Razorpay code exists
- SuperAdmin / Parent roles do not exist yet — the app still only has Teacher and Admin
- Grading against a real OpenAI key is untested: the routes call model `gpt-5.6-sol`,
  which is not a published OpenAI model and will likely fail with model-not-found
