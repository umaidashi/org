import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { createAgent } from '../src/agents/domain.js';

test('agent construction preserves values and uses the supplied identity and timestamp', () => {
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

test('agent construction rejects each missing textual value', () => {
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

test('Agent capabilities reject unknown and duplicate grants and copy caller-owned values', () => {
  const identity = { id: 'chief', createdAt: 'before' };
  const base = { name: 'chief', role: 'Chief', runtime: 'codex' };
  assert.throws(() => createAgent({ ...base, capabilities: ['unknown'] }, identity), /capabilit/i);
  assert.throws(
    () => createAgent({ ...base, capabilities: ['can_delegate', 'can_delegate'] }, identity),
    /capabilit/i,
  );
  assert.throws(
    () => createAgent({ ...base, capabilities: new Array<string>(1) }, identity),
    /capabilit/i,
  );
  const grants = ['can_delegate'];
  const agent = createAgent({ ...base, capabilities: grants }, identity);
  grants.length = 0;
  assert.deepEqual(agent.capabilities, ['can_delegate']);
});
