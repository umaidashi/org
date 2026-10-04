import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateSemanticReview } from '../scripts/semantic-result.js';

const complete = {
  findings: [{ severity: 'warning' }],
  stats: { subjects: 2, missing: 0 },
  errors: [],
  degraded: [],
};

await test('semantic review accepts complete warning-only results', () => {
  assert.doesNotThrow(() => validateSemanticReview(complete));
  assert.doesNotThrow(() =>
    validateSemanticReview({ ...complete, findings: [{ severity: 'hint' }] }),
  );
});

await test('semantic review rejects incomplete results even when warnings exist', () => {
  for (const result of [
    { ...complete, errors: ['request failed'] },
    { ...complete, stats: { subjects: 2, missing: 1 } },
    { ...complete, degraded: ['fallback'] },
    { ...complete, stats: { subjects: 0, missing: 0 } },
    { ...complete, findings: [{ severity: 'error' }] },
    { ...complete, findings: [{ severity: ['warning'] }] },
    {},
    null,
  ]) {
    assert.throws(() => validateSemanticReview(result));
  }
});
