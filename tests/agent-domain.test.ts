import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAgent } from '../src/agents/domain.js';

await test('agent construction preserves values and uses the supplied identity and timestamp', () => {
  const input = Object.freeze({ name: ' CTO ', role: '技術責任者', runtime: 'codex' });
  const identity = Object.freeze({ id: 'agent-1', createdAt: '2026-10-04T00:00:00.000Z' });
  const expected = {
    name: ' CTO ',
    role: '技術責任者',
    runtime: 'codex',
    id: 'agent-1',
    createdAt: '2026-10-04T00:00:00.000Z',
  };
  assert.deepEqual(createAgent(input, identity), expected);
  assert.deepEqual(createAgent(input, identity), expected);
  assert.deepEqual(input, { name: ' CTO ', role: '技術責任者', runtime: 'codex' });
});

await test('agent construction rejects each missing textual value', () => {
  for (const field of ['name', 'role', 'runtime'] as const) {
    for (const value of ['', ' \t\n']) {
      const input = { name: 'cto', role: 'CTO', runtime: 'codex', [field]: value };
      assert.throws(
        () => createAgent(input, { id: 'agent-1', createdAt: '2026-10-04T00:00:00.000Z' }),
        new RegExp(`${field} must not be empty`),
      );
    }
  }
});
