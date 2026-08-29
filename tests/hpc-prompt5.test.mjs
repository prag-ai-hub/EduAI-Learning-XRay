import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const api=readFileSync(new URL("../app/api/hpc/annual-reports/route.ts",import.meta.url),"utf8");
const principal=readFileSync(new URL("../app/api/hpc/principal-dashboard/route.ts",import.meta.url),"utf8");
const migration=readFileSync(new URL("../supabase/migrations/20260829000000_hpc_prompt5_annual_reporting.sql",import.meta.url),"utf8");
const ui=readFileSync(new URL("../app/ui/FunctionalEduAIApp.tsx",import.meta.url),"utf8");

test("Prompt 5 finalization uses the required normalized immutable tables",()=>{
  for(const table of ["hpc_annual_summaries","hpc_report_versions","hpc_report_evidence_snapshot"])assert.match(migration,new RegExp(`create table if not exists public\\.${table}`));
  assert.match(migration,/enable row level security/g);
  assert.match(migration,/prevent_hpc_final_report_mutation/);
});

test("annual finalization validates mandatory evidence and teacher approval",()=>{
  for(const check of ["stage_sections","teacher_assessment","student_reflection","peer_feedback","parent_feedback","applied_learning","official_scoring","evidence_mapping","conflicts","teacher_approval"])assert.ok(api.includes(check),`missing ${check}`);
  assert.match(api,/review_status","approved/);
  assert.match(api,/SHA-256/);
});

test("principal reporting is aggregate, contextual and non-ranked",()=>{
  assert.match(principal,/requireAdmin/);
  assert.match(principal,/Aggregate, non-ranked HPC operational view/);
  assert.doesNotMatch(principal,/best|worst|leaderboard/i);
  for(const metric of ["completionRate","participationRate","evidenceApproved","insufficient","appliedComplete","supportActive"])assert.ok(principal.includes(metric),`missing ${metric}`);
});

test("Prompt 5 UI exposes finalization checks and validates PDF signature",()=>{
  assert.match(ui,/Annual Holistic Progress Card and reporting/);
  assert.match(ui,/Finalize immutable HPC/);
  assert.match(ui,/signature!=="%PDF-"/);
  assert.match(ui,/Academic X-Ray marks remain separate/);
  assert.match(ui,/foundation\?\.enabled\?<><HpcLearnerProfiles/);
  assert.match(ui,/All Academic X-Ray workflows continue unchanged/);
});
