import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {readFileSync} from 'node:fs';

const route=readFileSync(new URL('../app/api/hpc/learners/route.ts',import.meta.url),'utf8');
const ui=readFileSync(new URL('../app/ui/FunctionalEduAIApp.tsx',import.meta.url),'utf8');
test('existing-student linking retains school and active-status scope',()=>{
 assert.match(route,/if\(existingStudentId\)/);
 assert.match(route,/eq\("id",existingStudentId\)\.eq\("school_id",profile.school_id\)\.eq\("status","Active"\)/);
 assert.match(route,/student_id: studentId/);
 assert.match(route,/This student already has an HPC profile for this academic year/);
});
test('learner form exposes existing student choice and broadcasts refreshed options',()=>{
 assert.match(ui,/<Field label="Existing student">/);
 assert.match(ui,/new CustomEvent\("hpc-learners-updated",\{detail:result.learners\|\|\[\]\}\)/);
 assert.equal((ui.match(/useHpcLearnerUpdates\(setLearners\);/g)||[]).length,14);
 assert.match(ui,/removeEventListener\("hpc-learners-updated",refresh\)/);
});
test('official progress discards stale responses after changing learner',()=>{
 assert.match(ui,/setProgress\(null\);setFeedback\(null\);setMessage\(""\)/);
 assert.match(ui,/if\(request!==requestId.current\)return/);
});
test('contribution links remain visible when clipboard access is unavailable',()=>{
 const source=fs.readFileSync(new URL('../app/ui/FunctionalEduAIApp.tsx',import.meta.url),'utf8');
 assert.ok(source.includes('Latest contribution link'));
 assert.ok(source.includes('navigator.clipboard?.writeText(payload.url).catch(()=>undefined)'));
 assert.ok(source.includes('readOnly value={shareUrl}'));
});
