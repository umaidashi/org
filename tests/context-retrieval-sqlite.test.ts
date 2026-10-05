import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { SqliteMemoryProvider } from '../src/memory/sqlite.js';
import { createMemory } from '../src/memory/domain.js';
import { createScopedMemoryRetriever } from '../src/memory/retriever.js';
test('real SQLite FTS ranks literal current-scope hits only after recency and importance while excluding invalid evidence', () => {
  const provider = new SqliteMemoryProvider(':memory:');
  const entry = (id: string, content: string, scope = 'room:r') =>
    createMemory(
      {
        type: 'semantic',
        scope,
        content,
        confidence: 1,
        sourceRefs: [{ roomId: 'r', messageId: 'm' }],
      },
      { id, at: '2026-10-01T00:00:00.000Z' },
    );
  try {
    for (const memory of [
      entry('a-miss', 'different fact'),
      entry('z-hit', 'SQLite is local'),
      entry('foreign', 'SQLite private', 'agent:other'),
      { ...entry('expired', 'SQLite expired'), validUntil: 1 },
      { ...entry('newer', 'recent unrelated'), createdAt: '2026-10-02T00:00:00.000Z' },
    ])
      provider.create(memory);
    const retriever = createScopedMemoryRetriever(provider);
    assert.deepEqual(
      retriever.retrieve({ scopes: ['room:r'], at: 2, query: 'SQLite' }).map((m) => m.id),
      ['newer', 'z-hit', 'a-miss'],
    );
    provider.invalidate('z-hit', 'changed', '3');
    assert.deepEqual(
      retriever.retrieve({ scopes: ['room:r'], at: 3, query: 'SQLite' }).map((m) => m.id),
      ['newer', 'a-miss'],
    );
  } finally {
    provider.close();
  }
});
