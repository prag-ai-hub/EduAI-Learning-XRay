import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("../supabase/migrations/20260826000000_hpc_foundation.sql", import.meta.url), "utf8");
const foundation = readFileSync(new URL("../lib/hpc-foundation.ts", import.meta.url), "utf8");

test("HPC foundation is additive, feature-flagged, and keeps intelligence traceable", () => {
  for (const table of ["hpc_school_settings", "hpc_framework_versions", "hpc_stage_templates", "hpc_learner_profiles", "hpc_goals_aspirations", "learning_events"]) {
    assert.match(migration, new RegExp(`create table if not exists public\\.${table}`));
  }
  assert.match(migration, /enabled boolean not null default false/);
  assert.match(migration, /unique \(source_type, source_record_id\)/);
  assert.match(migration, /enable row level security/);
  assert.doesNotMatch(migration, /insert into public\.hpc_framework_versions/i);
  assert.match(foundation, /foundational/);
  assert.match(foundation, /preparatory/);
  assert.match(foundation, /secondary/);
});
