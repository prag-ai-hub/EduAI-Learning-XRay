import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = name => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8");
// Assertions about behaviour must read executable SQL, not the prose in comments
// that explains the defect being fixed.
const executable = sql => sql.replace(/^\s*--.*$/gm, "");
const m3 = read("20260812000000_credits_rbac_invitations.sql");
const m5 = read("20260902000000_identity_uuid_unification.sql");
const m6 = read("20260902000100_credit_function_repair.sql");
const gradeRoute = readFileSync(new URL("../app/api/grade/route.ts", import.meta.url), "utf8");

// ---------------------------------------------------------------- M5

test("M5 aborts rather than half-converting when a value is not a UUID", () => {
  assert.match(m5, /M5 preflight FAILED/);
  assert.match(m5, /raise exception/);
  // The UUID shape must be asserted before any ALTER runs.
  assert.ok(m5.indexOf("preflight") < m5.indexOf("alter column id type uuid"),
    "preflight must precede the type conversion");
});

test("M5 discovers its targets instead of hardcoding a table list", () => {
  // M4's tables may or may not exist in a given database, so the migration
  // must derive dependents from the catalog rather than assume them.
  assert.match(m5, /from pg_constraint/);
  assert.match(m5, /confrelid\s*=\s*'public\.users'::regclass/);
  assert.doesNotMatch(m5, /alter table public\.classes alter column teacher_id/,
    "dependent columns must be discovered, not hardcoded");
});

test("M5 preserves foreign-key definitions verbatim across the conversion", () => {
  assert.match(m5, /pg_get_constraintdef/);
  assert.match(m5, /drop constraint/);
  assert.match(m5, /add constraint/);
});

test("M5 converts users.id but deliberately leaves schools.id alone", () => {
  assert.match(m5, /alter table public\.users alter column id type uuid using id::uuid/);
  assert.doesNotMatch(m5, /alter table public\.schools alter column id/,
    "schools.id holds non-UUID 'school-{uuid}' values embedded in workspace blobs");
});

test("M5 verifies the result and refuses to leave a half-converted schema", () => {
  assert.match(m5, /M5 post-check FAILED/);
  assert.match(m5, /atttypid <> 'uuid'::regtype/);
});

// ---------------------------------------------------------------- M6

test("M6 removes the unusable text signatures from M3", () => {
  assert.match(m3, /consume_credit\(p_operation_key text/, "M3 defined the broken signature");
  assert.match(m6, /drop function if exists public\.consume_credit\(text, text, integer\)/);
  assert.match(m6, /drop function if exists public\.refund_credit\(text, text\)/);
});

test("M6 takes the user id explicitly instead of relying on auth.uid()", () => {
  assert.match(m6, /create or replace function public\.consume_credit\(\s*\n\s*p_user_id\s+uuid/);
  assert.match(m6, /create or replace function public\.refund_credit\(\s*\n\s*p_user_id\s+uuid/);
  // auth.uid() is NULL under the service-role connection the server uses.
  assert.doesNotMatch(executable(m6), /auth\.uid\(\)/,
    "the repaired functions must not depend on auth.uid()");
  assert.match(m6, /auth\.uid\(\)/,
    "the header should still explain why auth.uid() was abandoned");
});

test("M6 closes the privilege-escalation hole its own fix would otherwise open", () => {
  // Trusting p_user_id is only safe if end-user roles cannot call the function.
  assert.match(m6, /revoke all on function public\.consume_credit\(uuid, text, text, integer\) from public, anon, authenticated/);
  assert.match(m6, /revoke all on function public\.refund_credit\(uuid, text, text\)\s+from public, anon, authenticated/);
  assert.match(m6, /grant execute on function public\.consume_credit\(uuid, text, text, integer\) to service_role/);
  assert.match(m6, /grant execute on function public\.refund_credit\(uuid, text, text\)\s+to service_role/);
  assert.match(m3, /grant execute on function public\.consume_credit\(text,text,integer\) to authenticated/,
    "M3 granted authenticated; M6 must revoke it");
});

test("M6 keeps idempotency and the balance guard from M3", () => {
  assert.match(m6, /operation_key = p_operation_key/);
  assert.match(m6, /Insufficient credits/);
  assert.match(m6, /Account disabled/);
  assert.match(m6, /for update/);
  assert.match(m6, /p_operation_key \|\| ':refund'/);
});

test("M6 refuses to run without its prerequisites", () => {
  assert.match(m6, /M6 requires M3/);
  assert.match(m6, /M6 requires M5/);
});

// ---------------------------------------------------------------- caller

test("the grade route supplies the user id to both credit calls", () => {
  assert.match(gradeRoute, /rpc\("consume_credit",\{p_user_id:chargedUserId/);
  assert.match(gradeRoute, /rpc\("refund_credit",\{p_user_id:chargedUserId/);
});

test("the refund path can still identify the user after a failure", () => {
  // `user` is scoped to the try block; the catch needs its own reference.
  const hoisted = gradeRoute.indexOf("let chargedUserId");
  const tryStart = gradeRoute.indexOf("try {");
  assert.ok(hoisted > -1 && hoisted < tryStart,
    "chargedUserId must be declared outside the try block");
  assert.match(gradeRoute, /if\(chargedOperation&&chargedUserId\)\{try\{/,
    "refund must not fire without a user to refund");
});

// ------------------------------------------------- regressions found by
// ------------------------------------------------- local manual testing

test("consume_credit qualifies columns that its OUT parameters shadow", () => {
  // `returns table(total_credits, used_credits, ...)` makes those names variables
  // in function scope, so a bare `used_credits` is ambiguous with the column.
  // M3 had this defect too; it was simply unreachable behind the auth.uid() failure.
  // Symptom: 'column reference "used_credits" is ambiguous'.
  assert.match(m6, /update public\.users u\s*\n\s*set used_credits = u\.used_credits \+ p_cost/);
  assert.match(m6, /select u\.\* into v_user from public\.users u where u\.id = p_user_id/);
  assert.doesNotMatch(executable(m6), /set used_credits = used_credits \+/,
    "unqualified self-reference is ambiguous against the OUT parameter");
});

test("refund_credit qualifies the same column", () => {
  assert.match(m6, /update public\.users u\s*\n\s*set used_credits = greatest\(0, u\.used_credits - v_amount\)/);
});

test("no credit is charged before the provider key is known to exist", () => {
  // The provider-key check uses `return`, not `throw`, so it never reaches the
  // catch block that refunds. Charging first therefore lost the teacher a credit
  // for work that never ran. The check must precede the charge.
  const keyCheck = gradeRoute.indexOf('OPENAI_API_KEY is not configured');
  const charge   = gradeRoute.indexOf('rpc("consume_credit"');
  assert.ok(keyCheck > -1 && charge > -1, "both the key check and the charge must exist");
  assert.ok(keyCheck < charge,
    "the provider-key check must run before consume_credit, or an early return leaks a credit");
});
