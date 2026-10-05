import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { createMemory, replaceMemory } from '../src/memory/domain.js';
test('Typed Memory keeps evidence and validates scope, confidence and replacement identity', () => {
  const input = {
    type: 'semantic' as const,
    scope: 'room:r',
    content: 'decision',
    confidence: 0.8,
    sourceRefs: [{ roomId: 'r', messageId: 'm' }],
  };
  const first = createMemory(input, { id: 'one', at: 'now' });
  assert.equal(first.status, 'active');
  assert.deepEqual(first.sourceRefs, input.sourceRefs);
  for (const patch of [
    { scope: 'room:' },
    { confidence: NaN },
    { confidence: 1.1 },
    { sourceRefs: [] },
    { content: ' ' },
  ])
    assert.throws(() => createMemory({ ...input, ...patch }, { id: 'bad', at: 'now' }));
  const second = createMemory(
    { ...input, content: 'new decision', supersedes: 'one' },
    { id: 'two', at: 'later' },
  );
  assert.deepEqual(replaceMemory(first, second), { ...first, status: 'superseded' });
  assert.equal(first.status, 'active');
  assert.throws(() => replaceMemory(first, { ...second, scope: 'room:other' }));
  assert.throws(() => replaceMemory({ ...first, status: 'invalidated' }, second));
});

test('Memory scope preserves namespaced Task IDs without accepting unknown or empty namespaces', () => {
  const input = {
    type: 'semantic' as const,
    scope: 'task:a2a:source',
    content: 'Task fact',
    confidence: 1,
    sourceRefs: [{ roomId: 'r', messageId: 'm' }],
  };
  for (const scope of ['task:a2a:source', 'task:schedule:slot', 'agent:adapter:identity'])
    assert.equal(createMemory({ ...input, scope }, { id: 'memory', at: '0' }).scope, scope);
  for (const scope of ['task:', 'task:with space', 'unknown:source', 'company:source'])
    assert.throws(() => createMemory({ ...input, scope }, { id: 'memory', at: '0' }));
});
