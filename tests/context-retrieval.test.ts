import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { createMemory } from '../src/memory/domain.js';
import { createScopedMemoryRetriever } from '../src/memory/retriever.js';
test('scoped Retriever uses literal full-text after higher priorities, rejects foreign/expired hits and propagates search failure', () => {
  const entry = (id: string, scope = 'room:r') =>
    createMemory(
      {
        type: 'semantic',
        scope,
        content: id,
        confidence: 1,
        sourceRefs: [{ roomId: 'r', messageId: 'm' }],
      },
      { id, at: '2026-10-01T00:00:00.000Z' },
    );
  const miss = entry('a-miss'),
    hit = entry('z-hit'),
    foreign = entry('foreign', 'agent:other'),
    expired = { ...entry('expired'), validUntil: 1 },
    newer = { ...entry('newer'), createdAt: '2026-10-02T00:00:00.000Z' };
  let searches = 0;
  const retriever = createScopedMemoryRetriever({
    list: () => [miss, hit, foreign, expired, newer],
    search: (query, scopes) => {
      searches++;
      assert.equal(query, 'SQLite');
      assert.deepEqual(scopes, ['room:r']);
      return [hit, foreign, expired];
    },
  });
  assert.deepEqual(
    retriever.retrieve({ scopes: ['room:r'], at: 2, query: 'SQLite' }).map((m) => m.id),
    ['newer', 'z-hit', 'a-miss'],
  );
  assert.deepEqual(
    retriever.retrieve({ scopes: ['room:r'], at: 2, query: 'x' }).map((m) => m.id),
    ['newer', 'a-miss', 'z-hit'],
  );
  retriever.retrieve({ scopes: ['room:r'], at: 2, query: 'x'.repeat(1025) });
  assert.equal(searches, 1);
  const broken = createScopedMemoryRetriever({
    list: () => [hit],
    search: () => {
      throw new Error('FTS unavailable');
    },
  });
  assert.throws(
    () => broken.retrieve({ scopes: ['room:r'], at: 2, query: 'SQLite' }),
    /FTS unavailable/,
  );
  assert.equal(hit.scope, 'room:r');
});
