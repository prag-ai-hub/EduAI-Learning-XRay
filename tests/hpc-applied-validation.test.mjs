import test from 'node:test';
import assert from 'node:assert/strict';
import {isSecondaryGrade,validateAppliedNumbers} from '../lib/hpc-applied-validation.ts';
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
