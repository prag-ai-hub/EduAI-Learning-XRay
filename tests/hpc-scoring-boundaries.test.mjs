import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyParakhMiddleStageCount, buildMiddleStageAbilityProgress } from '../lib/hpc-scoring.ts';

test('all seven valid official Middle Stage counts have the expected boundary level', () => {
  const expected = ['beginner', 'beginner', 'beginner', 'proficient', 'proficient', 'advanced', 'advanced'];
  expected.forEach((level, count) => assert.equal(classifyParakhMiddleStageCount(count), level));
});

test('invalid, fractional, nonnumeric and out-of-range counts are rejected', () => {
  for (const count of [-1, 7, 1.5, NaN, Infinity, -Infinity, '3', null, undefined]) {
    assert.throws(() => classifyParakhMiddleStageCount(count), /integer from 0 to 6/);
  }
});

test('missing perspectives remain missing rather than becoming zero or a blended score', () => {
  assert.deepEqual(buildMiddleStageAbilityProgress('awareness', {}), { ability: 'awareness', perspectives: {} });
  const input = Object.freeze({ teacher: 0 });
  assert.deepEqual(buildMiddleStageAbilityProgress('awareness', input), {
    ability: 'awareness', perspectives: { teacher: { count: 0, level: 'beginner' } },
  });
});

test('conflicting perspectives retain their own evidence counts without averaging', () => {
  const result = buildMiddleStageAbilityProgress('creativity', { self: 0, peer: 6, teacher: 3 });
  assert.deepEqual(Object.keys(result).sort(), ['ability', 'perspectives']);
  assert.deepEqual(result.perspectives, {
    self: { count: 0, level: 'beginner' },
    peer: { count: 6, level: 'advanced' },
    teacher: { count: 3, level: 'proficient' },
  });
});
