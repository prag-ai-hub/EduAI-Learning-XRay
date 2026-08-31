import test from 'node:test';
import assert from 'node:assert/strict';
import { supportsMiddleAbilityCounts, validateMiddleAbilityInput } from '../lib/hpc-stage-policy.ts';
test('Middle ability rule never leaks into other stages or unset grades',()=>{
 for(const grade of [6,7,8]) assert.equal(supportsMiddleAbilityCounts(grade),true);
 for(const grade of [null,undefined,'7',0,2,3,5,9,10,12,-1,13,6.5]) assert.equal(supportsMiddleAbilityCounts(grade),false);
});
test('count payload requires a genuine integer and a recognised perspective',()=>{
 for(const statementCount of [0,1,2,3,4,5,6]) assert.equal(validateMiddleAbilityInput(7,{perspective:'self',statementCount}),null);
 for(const statementCount of ['',null,undefined,'3',-1,7,1.5,NaN]) assert.ok(validateMiddleAbilityInput(7,{perspective:'self',statementCount}));
 assert.ok(validateMiddleAbilityInput(7,{perspective:'parent',statementCount:3}));
 assert.ok(validateMiddleAbilityInput(10,{perspective:'teacher',statementCount:3}));
});
test('overrides require teacher perspective, known level and evidence rationale',()=>{
 const input={perspective:'teacher',statementCount:3,teacherOverrideLevel:'advanced',evidenceNote:'Reviewed evidence'};
 assert.equal(validateMiddleAbilityInput(7,input),null);
 for(const patch of [{perspective:'peer'},{teacherOverrideLevel:'excellent'},{evidenceNote:''}]) assert.ok(validateMiddleAbilityInput(7,{...input,...patch}));
});
