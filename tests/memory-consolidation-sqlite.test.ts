import { SqliteRoomRepository } from '../src/rooms/sqlite.js';
import { createRoom } from '../src/rooms/domain.js';
import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { Database } from 'bun:sqlite';
import { SqliteMemoryProvider } from '../src/memory/sqlite.js';
import { createMemory } from '../src/memory/domain.js';
import { planMemoryConsolidation, consolidateRoomMemories } from '../src/memory/consolidation.js';
test('SQLite consolidation atomically stores immutable receipt with invalidations, detects changed snapshots and rolls back storage failure', () => {
  const home = mkdtempSync('/tmp/org-memory-consolidate-'),
    path = home + '/org.db';
  let provider = new SqliteMemoryProvider(path);
  const raw = new Database(path);
  const entry = (id: string) =>
    createMemory(
      {
        type: 'semantic',
        scope: 'room:r',
        content: 'fact',
        confidence: 1,
        sourceRefs: [{ roomId: 'r', messageId: id }],
      },
      { id, at: '2026-10-01T00:00:00.000Z' },
    );
  const request = { scope: 'room:r', key: 'first', at: '2026-10-06T00:00:00.000Z' };
  try {
    for (const id of ['a', 'b', 'c']) provider.create(entry(id));
    const plan = planMemoryConsolidation(provider.list(), request);
    raw.exec(
      "CREATE TRIGGER fail_consolidation BEFORE INSERT ON memory_consolidations BEGIN SELECT RAISE(ABORT,'storage failed'); END;",
    );
    assert.throws(() => provider.commitConsolidation(plan, () => {}));
    assert.equal(provider.get('b').status, 'active');
    assert.equal(provider.get('c').status, 'active');
    assert.equal(provider.getConsolidation('first'), null);
    raw.exec('DROP TRIGGER fail_consolidation');
    const receipt = provider.commitConsolidation(plan, () => {});
    assert.deepEqual(receipt.invalidated, ['b', 'c']);
    assert.deepEqual(receipt.keepers, ['a']);
    assert.equal(provider.get('a').status, 'active');
    raw
      .query('INSERT INTO memory_consolidations(key,data) VALUES (?,?)')
      .run('stored-key', JSON.stringify({ ...receipt, key: 'different' }));
    assert.throws(() => provider.getConsolidation('stored-key'));
    assert.equal(provider.get('b').status, 'invalidated');
    assert.deepEqual(provider.get('b').sourceRefs, entry('b').sourceRefs);
    assert.deepEqual(
      provider.commitConsolidation({ ...plan, at: '2026-10-07T00:00:00.000Z' }, () => {}),
      receipt,
    );
    for (const sql of [
      "UPDATE memory_consolidations SET data='{}'",
      'DELETE FROM memory_consolidations',
      "INSERT OR REPLACE INTO memory_consolidations(key,data) VALUES ('first','{}')",
      "INSERT OR REPLACE INTO memory_consolidations(rowid,key,data) VALUES (1,'other','{}')",
    ])
      assert.throws(() => raw.exec(sql));
    provider.close();
    provider = new SqliteMemoryProvider(path);
    assert.deepEqual(provider.getConsolidation('first'), receipt);
    provider.create(entry('d'));
    const changed = planMemoryConsolidation(provider.list(), { ...request, key: 'changed' });
    provider.invalidate('d', 'manual invalidation', '2026-10-06T00:01:00.000Z');
    assert.throws(() => provider.commitConsolidation(changed, () => {}));
    assert.equal(provider.getConsolidation('changed'), null);
    assert.equal(provider.get('a').status, 'active');
  } finally {
    raw.close();
    provider.close();
    rmSync(home, { recursive: true, force: true });
  }
});

test('Room archive between selection and commit rejects consolidation without receipt or invalidation', () => {
  const home = mkdtempSync('/tmp/org-memory-consolidate-race-'),
    path = home + '/org.db';
  const provider = new SqliteMemoryProvider(path);
  const rooms = new SqliteRoomRepository(path);
  try {
    rooms.create(
      createRoom(
        {
          title: 'work',
          type: 'direct',
          participants: [
            { kind: 'human', id: 'h' },
            { kind: 'agent', id: 'a' },
          ],
        },
        { id: 'r', createdAt: '0' },
      ),
    );
    for (const id of ['a', 'b'])
      provider.create(
        createMemory(
          {
            type: 'semantic',
            scope: 'room:r',
            content: 'fact',
            confidence: 1,
            sourceRefs: [{ roomId: 'r', messageId: id }],
          },
          { id, at: '2026-10-01T00:00:00.000Z' },
        ),
      );
    assert.throws(() =>
      consolidateRoomMemories(
        rooms,
        provider,
        {
          getConsolidation: (key) => provider.getConsolidation(key),
          commitConsolidation: (plan, authorize) => {
            rooms.archive('r', '2026-10-06T00:00:00.000Z');
            return provider.commitConsolidation(plan, authorize);
          },
        },
        { scope: 'room:r', key: 'race', at: '2026-10-06T00:00:00.000Z' },
      ),
    );
    assert.equal(provider.get('b').status, 'active');
    assert.equal(provider.getConsolidation('race'), null);
  } finally {
    rooms.close();
    provider.close();
    rmSync(home, { recursive: true, force: true });
  }
});
