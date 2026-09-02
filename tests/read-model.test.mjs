import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const m11        = read("supabase/migrations/20260904000000_read_model_publication.sql");
const publishApi = read("app/api/publish/route.ts");
const parentApi  = read("app/api/parent/children/route.ts");
const platformApi= read("app/api/admin/platform-summary/route.ts");
const appUi      = read("app/ui/FunctionalEduAIApp.tsx");
const executable = sql => sql.replace(/^\s*--.*$/gm, "");

test("M11 fixes the integer score column before publishing into it", () => {
  // The evaluator awards half and quarter marks; an integer column would round
  // 14.5 to 14 or reject it.
  assert.match(m11, /alter table public\.grade_results alter column score\s+type numeric\(10,2\)/);
  assert.match(m11, /alter table public\.grade_results alter column max_marks type numeric\(10,2\)/);
});

test("M11 drops the foreign key that would reject every publish", () => {
  // grade_results.file_id referenced uploaded_files, which the app never writes.
  assert.match(m11, /drop constraint if exists grade_results_file_id_fkey/);
});

test("M11 gives resources a student and an assessment to be queried by", () => {
  assert.match(m11, /alter table public\.resources add column if not exists student_id/);
  assert.match(m11, /alter table public\.resources add column if not exists assessment_id/);
});

test("student identity is resolved, not trusted", () => {
  // GradeResult.studentName is guessed from a filename by guessStudentName(),
  // so two spellings must not become two children.
  assert.match(m11, /create or replace function public\.resolve_student/);
  assert.match(m11, /regexp_replace\(name, '\\s\+', ' ', 'g'\)/);
  assert.match(m11, /create unique index if not exists students_school_class_name_idx/);
  // A roll number is the school's own identifier and outranks a guessed name.
  assert.match(m11, /if v_roll is not null then/);
});

test("publication is atomic", () => {
  // A partially published result would show a parent a score with no gaps.
  assert.match(m11, /create or replace function public\.publish_student_result/);
  assert.match(m11, /on conflict \(assessment_id, file_id, grading_version\) do update/);
});

test("publish_student_result avoids the OUT-parameter shadowing that broke M6", () => {
  // A column list inside ON CONFLICT cannot be table-qualified, so unprefixed
  // OUT names like assessment_id are unresolvable there.
  assert.match(m11, /returns table\(out_assessment_id text, out_student_id text/);
  assert.doesNotMatch(executable(m11), /returns table\(assessment_id text/);
});

test("the parent read path withholds evidence by construction", () => {
  const fn = m11.slice(m11.indexOf("function public.parent_child_reports"),
                       m11.indexOf("function public.platform_school_summary"));
  assert.match(fn, /jsonb_build_object/);
  assert.doesNotMatch(fn, /ocr_text/);
  assert.doesNotMatch(fn, /question_decisions_json/);
  // Access comes only from an active link.
  assert.match(fn, /parent_student_links l/);
  assert.match(fn, /l\.status = 'active'/);
});

test("the platform summary carries no student names", () => {
  const fn = m11.slice(m11.indexOf("function public.platform_school_summary"));
  assert.doesNotMatch(fn, /s\.name/);
  assert.match(fn, /count\(\*\)/);
});

test("read-model functions are server-only", () => {
  for (const fn of ["publish_student_result","parent_child_reports","platform_school_summary","resolve_student"]) {
    assert.match(m11, new RegExp(`grant execute on function public\\.${fn}`), `${fn} not granted to service_role`);
  }
  assert.doesNotMatch(m11, /grant execute on function public\.(publish_student_result|parent_child_reports)[^;]*to authenticated/);
});

test("each endpoint is restricted to the role that should reach it", () => {
  assert.match(publishApi,  /requireRole\(profile, "Teacher", "SchoolAdmin"\)/);
  assert.match(parentApi,   /requireRole\(profile, "Parent"\)/);
  assert.match(platformApi, /requireRole\(profile, "SuperAdmin"\)/);
});

test("rehydration refuses to cross a school boundary", () => {
  assert.match(publishApi, /belongs to another school/);
  assert.match(publishApi, /profile\.role !== "SuperAdmin" && data\.school_id !== profile\.school_id/);
});

test("the blob is trimmed only after publication has succeeded", () => {
  // Trimming on a failed publish would drop data with no durable copy.
  assert.match(appUi, /if\(published\.ok\)\{/);
  assert.match(appUi, /trimPublishedResult\(result\)/);
  assert.match(appUi, /trimPublishedResource\(/);
});

test("trimming removes the three heavy fields and keeps the heatmap's inputs", () => {
  assert.match(appUi, /const \{ocrText,questionDecisions,\.\.\.rest\}=result/);
  assert.match(appUi, /gaps:\(result\.gaps\|\|\[\]\)\.map\(gap=>\(\{concept:gap\.concept,mastery:gap\.mastery,severity:gap\.severity\}\)\)/);
  assert.match(appUi, /const \{guide,content,\.\.\.rest\}=resource/);
});

test("hydrated detail never flows back into the workspace snapshot", () => {
  // Writing it into `state` would undo the trimming on the next autosave.
  assert.match(appUi, /const \[hydrated,setHydrated\]=useState<GradeResult\|null>\(null\)/);
  assert.match(appUi, /const active=hydrated\?\?current/);
});

test("every screen that needs the trimmed detail hydrates first", () => {
  assert.match(appUi, /hydrateResult\(assessment\.id,result\)/);
  assert.match(appUi, /hydrateResource\(guide\)/);
  assert.match(appUi, /hydrateResource\(worksheet\)/);
  assert.match(appUi, /const detailedResult=await hydrateResult/);
});
