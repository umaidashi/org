import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { pollDispatch } from '../src/daemon/service.js';
test('injected poll failures are explicitly degraded and the next successful poll recovers', () => {
  const failed = pollDispatch(() => {
    throw new Error('database unavailable');
  });
  assert.equal(failed.state, 'degraded');
  assert.equal(failed.error, 'database unavailable');
  const recovered = pollDispatch(() => []);
  assert.equal(recovered.state, 'running');
  assert.equal(recovered.error, null);
  assert.equal(recovered.processed, 0);
});
