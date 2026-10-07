import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { createAgent } from '../src/agents/domain.js';
import { createRoom, createMessage } from '../src/rooms/domain.js';
import { SqliteMemoryProvider } from '../src/memory/sqlite.js';
import { jsonMemoryExtractor } from '../src/memory/extractor.js';
import { extractRoomMemories } from '../src/memory/extraction.js';
test('same-batch and cross-proposal exact dedup never resurrect invalidated Memory on extraction retry after SQLite reopen', async () => {
  const home = mkdtempSync('/tmp/org-memory-dedup-');
  const db = home + '/org.db';
  let provider = new SqliteMemoryProvider(db);
  const agent = createAgent(
    { name: 'a', role: 'memory', runtime: 'claude', capabilities: ['can_read', 'can_write'] },
    { id: 'a', createdAt: '0' },
  );
  const room = createRoom(
    {
      title: 'work',
      type: 'direct',
      participants: [
        { kind: 'agent', id: 'a' },
        { kind: 'human', id: 'h' },
      ],
    },
    { id: 'r', createdAt: '0' },
  );
  const source = createMessage(
    room,
    { sender: { kind: 'human', id: 'h' }, content: 'fact' },
    { id: 'source', createdAt: '1' },
  );
  const candidate = {
    type: 'semantic',
    content: 'fact',
    confidence: 1,
    sourceMessageIds: ['source'],
  };
  const first = createMessage(
    room,
    {
      sender: { kind: 'agent', id: 'a' },
      content: JSON.stringify({ version: 1, tool: 'memory', candidates: [candidate, candidate] }),
    },
    { id: 'first', createdAt: '2' },
  );
  const second = createMessage(
    room,
    {
      sender: { kind: 'agent', id: 'a' },
      content: JSON.stringify({ version: 1, tool: 'memory', candidates: [candidate] }),
    },
    { id: 'second', createdAt: '3' },
  );
  const run = (messageId: string) =>
    extractRoomMemories(
      { get: () => room, messages: () => [source, first, second] },
      { list: () => [agent] },
      provider,
      jsonMemoryExtractor,
      { roomId: 'r', messageId },
    );
  try {
    const projected = await run('first');
    assert.equal(projected.length, 2);
    assert.ok(projected[0]);
    assert.equal(projected[1]?.id, projected[0].id);
    assert.equal((await run('second'))[0]?.id, projected[0].id);
    provider.invalidate(projected[0].id, 'no longer valid', '4');
    provider.close();
    provider = new SqliteMemoryProvider(db);
    assert.deepEqual(
      (await run('first')).map((m) => [m.id, m.status]),
      [
        [projected[0].id, 'invalidated'],
        [projected[0].id, 'invalidated'],
      ],
    );
    assert.equal((await run('second'))[0]?.status, 'invalidated');
    assert.equal(provider.list().length, 1);
  } finally {
    provider.close();
    rmSync(home, { recursive: true, force: true });
  }
});
