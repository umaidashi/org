import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { registerAgent } from '../src/agents/service.js';

test('invalid Agent inputs never reach the injected persistence port', () => {
  let writes = 0;
  assert.throws(() =>
    registerAgent(
      {
        insert: () => {
          writes += 1;
        },
      },
      { name: ' ', role: 'dev', runtime: 'codex' },
      { id: 'agent', createdAt: '2026-10-04T00:00:00.000Z' },
    ),
  );
  assert.equal(writes, 0);
});
test('Agent registration propagates injected persistence failures', () => {
  assert.throws(
    () =>
      registerAgent(
        {
          insert: () => {
            throw new Error('storage unavailable');
          },
        },
        { name: 'dev', role: 'dev', runtime: 'codex' },
        { id: 'agent', createdAt: '2026-10-04T00:00:00.000Z' },
      ),
    /storage unavailable/,
  );
});
