import assert from "node:assert/strict";
import { classifyParakhMiddleStageCount, buildMiddleStageAbilityProgress } from "../lib/hpc-scoring.ts";

assert.equal(classifyParakhMiddleStageCount(0), "beginner");
assert.equal(classifyParakhMiddleStageCount(2), "beginner");
assert.equal(classifyParakhMiddleStageCount(3), "proficient");
assert.equal(classifyParakhMiddleStageCount(4), "proficient");
assert.equal(classifyParakhMiddleStageCount(5), "advanced");
assert.equal(classifyParakhMiddleStageCount(6), "advanced");
assert.throws(() => classifyParakhMiddleStageCount(7));
const progress=buildMiddleStageAbilityProgress("awareness",{self:2,peer:5,teacher:4});
assert.deepEqual(progress.perspectives,{self:{count:2,level:"beginner"},peer:{count:5,level:"advanced"},teacher:{count:4,level:"proficient"}});
assert.equal("overall" in progress,false);
console.log("hpc scoring tests passed");
