import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { createMemory, decodeMemory, memoryIsValidAt } from '../src/memory/domain.js';
test('Memory validity preserves optional original periods and excludes future, expired and invalidated entries at exact boundaries', () => {
  const input = {
    type: 'semantic' as const,
    scope: 'company',
    content: 'Temporary fact',
    confidence: 1,
    sourceRefs: [{ roomId: 'room', messageId: 'message' }],
    validFrom: 100,
    validUntil: 200,
  };
  const memory = createMemory(input, { id: 'memory', at: '0' });
  assert.equal(memory.validFrom, 100);
  assert.equal(memory.validUntil, 200);
  assert.deepEqual(decodeMemory(memory), memory);
  assert.equal(memoryIsValidAt(memory, 99), false);
  assert.equal(memoryIsValidAt(memory, 100), true);
  assert.equal(memoryIsValidAt(memory, 199), true);
  assert.equal(memoryIsValidAt(memory, 200), false);
  assert.equal(memoryIsValidAt({ ...memory, status: 'invalidated' }, 150), false);
  assert.throws(() => memoryIsValidAt(memory, NaN));
  for (const patch of [
    { validFrom: 200 },
    { validUntil: 100 },
    { validFrom: NaN },
    { validUntil: 0.5 },
    { validFrom: -8640000000000001 },
  ])
    assert.throws(() => createMemory({ ...input, ...patch }, { id: 'memory', at: '0' }));
  const legacy = createMemory(
    {
      type: input.type,
      scope: input.scope,
      content: input.content,
      confidence: input.confidence,
      sourceRefs: input.sourceRefs,
    },
    { id: 'legacy', at: '0' },
  );
  assert.equal(memoryIsValidAt(legacy, NaN), true);
  assert.ok(!('validFrom' in legacy));
});
