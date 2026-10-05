import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { createMemory, decodeMemory } from '../src/memory/domain.js';
import { selectMemories } from '../src/memory/retrieval.js';

test('Memory retrieval preserves bounded metadata, scope isolation and literal relevance before recency', () => {
  const input = {
    type: 'semantic' as const,
    scope: 'room:r',
    content: 'fact',
    confidence: 0.8,
    sourceRefs: [{ roomId: 'r', messageId: 'm' }],
    tags: ['日本語'],
    entities: ['org'],
    importance: 0.9,
  };
  const tagged = createMemory(input, { id: 'tagged', at: '2026-10-01T00:00:00.000Z' });
  assert.deepEqual(decodeMemory(JSON.parse(JSON.stringify(tagged))), tagged);
  for (const patch of [
    { tags: [''] },
    { tags: ['x', 'x'] },
    { entities: ['x'.repeat(129)] },
    { tags: Array.from({ length: 33 }, (_, i) => String(i)) },
    { importance: NaN },
    { importance: -0.1 },
    { importance: 1.1 },
  ])
    assert.throws(() => createMemory({ ...input, ...patch }, { id: 'invalid', at: 'now' }));
  assert.throws(() => decodeMemory({ ...tagged, tags: [7] }));
  const latest = createMemory(
    { ...input, tags: [], entities: [], importance: 0.1 },
    { id: 'latest', at: '2026-10-05T00:00:00.000Z' },
  );
  const global = createMemory(
    { ...input, scope: 'global' },
    { id: 'global', at: '2026-10-05T00:00:00.000Z' },
  );
  const expired = createMemory(
    { ...input, validUntil: 1 },
    { id: 'expired', at: '2026-10-05T00:00:00.000Z' },
  );
  const foreign = createMemory(
    { ...input, scope: 'task:other' },
    { id: 'foreign', at: '2026-10-05T00:00:00.000Z' },
  );
  const records = [latest, foreign, expired, global, tagged];
  assert.deepEqual(
    selectMemories(records, {
      scopes: ['room:r', 'global'],
      at: 2,
      query: '日本語でORGの説明',
    }).map((m) => m.id),
    ['tagged', 'latest', 'global'],
  );
  assert.deepEqual(
    selectMemories(records, {
      scopes: ['room:r'],
      at: 2,
      tag: '日本語',
      entity: 'org',
      type: 'semantic',
    }).map((m) => m.id),
    ['tagged'],
  );
  assert.deepEqual(selectMemories(records, { scopes: ['room:r'], at: 2, type: 'procedural' }), []);
  assert.deepEqual(
    selectMemories([latest, tagged], { scopes: ['room:r'], at: 2 }).map((m) => m.id),
    ['latest', 'tagged'],
  );
  assert.equal(tagged.tags?.[0], '日本語');
  const important = createMemory(
    { ...input, tags: [], entities: [] },
    { id: 'z-important', at: latest.createdAt },
  );
  assert.deepEqual(
    selectMemories([latest, important], { scopes: ['room:r'], at: 2 }).map((m) => m.id),
    ['z-important', 'latest'],
  );
  const legacy = createMemory(
    {
      type: 'semantic',
      scope: 'global',
      content: 'legacy',
      confidence: 1,
      sourceRefs: input.sourceRefs,
    },
    { id: 'legacy', at: 'now' },
  );
  assert.equal(Object.hasOwn(legacy, 'tags'), false);
  assert.equal(Object.hasOwn(legacy, 'importance'), false);
});
