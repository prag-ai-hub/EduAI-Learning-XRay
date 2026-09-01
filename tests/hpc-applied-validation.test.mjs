import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {isSecondaryGrade,validateAppliedNumbers} from '../lib/hpc-applied-validation.ts';
test('record editor cannot retain fields from a previously selected record',()=>{
 const source=fs.readFileSync(new URL('../app/ui/FunctionalEduAIApp.tsx',import.meta.url),'utf8');
 assert.ok(source.includes('const record=detail?.record?.id===recordId?detail.record:null'));
 assert.ok(source.includes('<form key={record.id} className="hpc-subform"'));
});
test('bulk observations hide invalid class filters and isolate Middle performance levels',()=>{
 const source=fs.readFileSync(new URL('../app/ui/HpcBulkObservations.tsx',import.meta.url),'utf8');
 assert.ok(source.includes('value!==null&&value!==undefined&&value!==""&&Number.isInteger(Number(value))'));
 assert.ok(source.includes('learners.filter(l=>validGrade(l.grade))'));
 assert.ok(source.includes('"Grade not set"'));
 assert.ok(source.includes('g>=6&&g<=8'));
});
test('mobile forms cannot widen the HPC workspace',()=>{
 const css=fs.readFileSync(new URL('../app/globals.css',import.meta.url),'utf8');
 assert.ok(css.includes('.form-grid>*,.form-grid label{min-width:0}'));
 assert.ok(css.includes('.form-grid input,.form-grid select,.form-grid textarea{width:100%;max-width:100%;min-width:0}'));
 assert.ok(css.includes('@media(max-width:900px){.crumb span,.crumb i,.top-actions .sync-indicator,.top-actions .credit-badge,.top-actions .demo-role-badge{display:none}}'));
 assert.ok(css.includes('.top-actions .sync-indicator,.top-actions .credit-badge{display:none}'));
});
test('applied learning allows only integer Secondary grades',()=>{
 for(const grade of [9,10,11,12])assert.equal(isSecondaryGrade(grade),true);
 for(const grade of [null,undefined,0,8,13,9.5,'10',NaN])assert.equal(isSecondaryGrade(grade),false);
});
test('hours and credits reject invalid numbers without rejecting zero',()=>{
 for(const key of ['hoursSpent','credits']){
  for(const value of [-1,'-1','invalid',Infinity,true,{}])assert.ok(validateAppliedNumbers({[key]:value}));
  for(const value of [0,'0',1.5,'2.5',null,''])assert.equal(validateAppliedNumbers({[key]:value}),null);
 }
});
test('applied stage and completion statuses are constrained',()=>{
 for(const stageNumber of [0,4,-1,1.5,'bad',true])assert.ok(validateAppliedNumbers({stageNumber}));
 for(const stageNumber of [1,2,3,'2',null,''])assert.equal(validateAppliedNumbers({stageNumber}),null);
 assert.ok(validateAppliedNumbers({completionStatus:'unknown'}));
 assert.equal(validateAppliedNumbers({completionStatus:'completed'}),null);
});
