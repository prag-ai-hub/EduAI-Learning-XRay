import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

const DIR = new URL("../../supabase/migrations/", import.meta.url);
const files = readdirSync(DIR).filter(f => f.endsWith(".sql")).sort();
const stripComments = sql => sql.replace(/^\s*--.*$/gm, "");

/**
 * A plpgsql function declared `returns table(...)` turns each OUT name into a
 * variable in the function's scope. Where that name also names a column of a
 * table the function touches, a bare reference is ambiguous and the function
 * fails at RUNTIME — it compiles and deploys without complaint.
 *
 * This has bitten twice in this codebase:
 *   M3  consume_credit          'column reference "used_credits" is ambiguous'
 *   M11 publish_student_result  'column reference "assessment_id" is ambiguous'
 *
 * Table-qualifying fixes most sites but not all: the column list in
 * ON CONFLICT (...) cannot be qualified, so there is no way to disambiguate it.
 * The convention is therefore that OUT names never collide at all.
 */
/**
 * Migrations are immutable history: M3 and M6 legitimately contain the old
 * definitions. What matters is the schema's END state, so each function is
 * judged by its LAST definition in migration order.
 */
function finalDefinitions() {
  const byName = new Map();
  for (const file of files) {
    const sql = stripComments(readFileSync(new URL(file, DIR), "utf8"));
    for (const match of sql.matchAll(/create\s+(?:or\s+replace\s+)?function\s+public\.(\w+)\s*\(([\s\S]*?)\)\s*returns([\s\S]*?)(?:language|as)\s/gi)) {
      byName.set(match[1], { file, name: match[1], args: match[2], returns: match[3] });
    }
  }
  return [...byName.values()];
}

test("every table-returning function prefixes its OUT parameters with out_", () => {
  const offenders = [];
  for (const fn of finalDefinitions()) {
    const table = fn.returns.match(/table\s*\(([\s\S]*)\)/i);
    if (!table) continue;
    for (const part of table[1].split(",")) {
      const name = part.trim().split(/\s+/)[0];
      if (name && !name.startsWith("out_")) {
        offenders.push(`${fn.file}: public.${fn.name} -> "${name}"`);
      }
    }
  }
  assert.deepEqual(offenders, [],
    "OUT parameters must be out_-prefixed so they cannot shadow a column:\n  " + offenders.join("\n  "));
});

test("the credit functions no longer depend on auth.uid()", () => {
  // auth.uid() is NULL on the service-role connection every server route uses,
  // so the pre-M6 signatures could never execute.
  for (const name of ["consume_credit", "refund_credit"]) {
    const fn = finalDefinitions().find(f => f.name === name);
    assert.ok(fn, `public.${name} has no definition`);
    assert.match(fn.args, /p_user_id\s+uuid/,
      `public.${name} must take the user id explicitly (final definition is in ${fn.file})`);
  }
});

test("security-definer functions are never executable by end-user roles", () => {
  // These functions trust an id passed to them, so a grant to `authenticated`
  // would let any signed-in user act as anyone else.
  const trusted = ["consume_credit","refund_credit","redeem_parent_invite_code",
                   "publish_student_result","parent_child_reports",
                   "platform_school_summary","get_shared_student_report",
                   "resolve_student","save_workspace_snapshot"];
  const all = files.map(f => stripComments(readFileSync(new URL(f, DIR), "utf8"))).join("\n");
  for (const fn of trusted) {
    const grants = [...all.matchAll(new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\)\\s+to\\s+([\\w, ]+)`, "gi"))]
      .flatMap(m => m[1].split(",").map(r => r.trim()));
    if (!grants.length) continue;
    const last = grants.slice(-1)[0];
    assert.equal(last, "service_role",
      `public.${fn} is granted to "${last}"; it must be service_role only`);
  }
});
