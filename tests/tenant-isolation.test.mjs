import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const MIG = new URL("../supabase/migrations/", import.meta.url);
const migrations = readdirSync(MIG).filter(f => f.endsWith(".sql")).sort();
const m14 = read("supabase/migrations/20260905000200_close_rls_gap.sql");
const adminUsers = read("app/api/admin/users/route.ts");
const authz = read("lib/authorization.ts");

test("M14 sweeps every table rather than naming the two that were exposed", () => {
  // M3 created credit_transactions and invitations with neither RLS nor a
  // revoke, leaving them readable AND deletable by anon through PostgREST.
  // Naming them would fix today and miss the next migration that forgets.
  assert.match(m14, /from pg_class c[\s\S]*?where n\.nspname = 'public' and c\.relkind = 'r'/);
  assert.match(m14, /revoke all on public\.%I from anon, authenticated/);
  assert.match(m14, /enable row level security/);
});

test("M14 fails rather than leaving a table exposed", () => {
  assert.match(m14, /M14 post-check FAILED: no row level security on/);
  assert.match(m14, /M14 post-check FAILED: anon\/authenticated still hold grants on/);
});

/**
 * Migrations are immutable history, so the one that caused this cannot be
 * edited. It is named here with its remedy rather than silently skipped, and
 * M14's own post-check is the end-state backstop that would catch any
 * regression this list hides.
 */
const REMEDIATED = new Map([
  ["20260812000000_credits_rbac_invitations.sql",
   "created credit_transactions and invitations unprotected; swept and closed by M14 (20260905000200)"],
]);

test("every migration that creates a table also protects it", () => {
  // The rule M3 broke. A new table in public is readable by anon by default.
  const offenders = [];
  for (const file of migrations) {
    if (REMEDIATED.has(file)) continue;
    const sql = readFileSync(new URL(file, MIG), "utf8").replace(/^\s*--.*$/gm, "");
    const created = [...sql.matchAll(/create table if not exists public\.(\w+)/gi)].map(m => m[1]);
    if (!created.length) continue;
    const protects = /enable row level security/i.test(sql) && /revoke all on/i.test(sql);
    if (!protects) offenders.push(`${file} creates ${created.join(", ")} without RLS + revoke`);
  }
  assert.deepEqual(offenders, [],
    "a migration created tables without protecting them:\n  " + offenders.join("\n  "));
});

test("the remediated list stays honest", () => {
  // If a listed migration is ever made compliant, it must leave the list, or
  // the exemption starts hiding real regressions.
  for (const [file, why] of REMEDIATED) {
    assert.ok(migrations.includes(file), `${file} is listed as remediated but does not exist`);
    const sql = readFileSync(new URL(file, MIG), "utf8").replace(/^\s*--.*$/gm, "");
    const compliant = /enable row level security/i.test(sql) && /revoke all on/i.test(sql);
    assert.equal(compliant, false,
      `${file} now protects its tables — remove it from REMEDIATED (${why})`);
  }
});

test("admin/users confines a SchoolAdmin to their own school", () => {
  // Both handlers were unscoped: GET listed every user of every school, and
  // PATCH would disable or credit any user given only an id.
  assert.match(adminUsers, /eq\("school_id",schoolId\)/);
  assert.match(adminUsers, /requireSchoolScope/);
  assert.doesNotMatch(adminUsers, /from\("users"\)\.select\([^)]*\)\.order\("name"\)\s*,/,
    "the users query must be school-filtered before ordering");
});

test("admin/users verifies the PATCH target belongs to the school being administered", () => {
  assert.match(adminUsers, /target\.school_id!==schoolId/);
  assert.match(adminUsers, /This user is not in the school you are administering/);
});

test("a SuperAdmin must name a school and hold a grant", () => {
  assert.match(adminUsers, /profile\.role==="SuperAdmin"\?requested:profile\.school_id/);
  assert.match(adminUsers, /Name a school with \?schoolId=/);
  // requireSchoolScope is what demands the unexpired support grant and writes
  // the cross-tenant audit event.
  assert.match(authz, /support_access_grants/);
  assert.match(authz, /support\.cross_tenant_read/);
});

test("the regression harness derives its migration chain from disk", () => {
  // It previously hardcoded the list. M15 was added and the list was not, so
  // the harness exercised an incomplete chain and reported a clean run against
  // the very behaviour M15 fixed. A guard that can silently go stale is worse
  // than no guard, because it is trusted.
  const harness = read("scripts/test-migration-regression.sh");
  assert.match(harness, /mapfile -t CHAIN < <\(ls "\$MIG"/);
  assert.doesNotMatch(harness, /CHAIN=\(\s*\n\s*2026/,
    "the chain must not be a hardcoded list");
});
