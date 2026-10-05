import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { createMemory } from '../src/memory/domain.js';
import { SqliteMemoryProvider } from '../src/memory/sqlite.js';
test('Memory projection preserves original evidence and atomically supersedes active same-scope records', () => {
  const home = mkdtempSync('/tmp/org-memory-');
  const path = home + '/org.db';
  let store: SqliteMemoryProvider | undefined;
  let db: Database | undefined;
  try {
    store = new SqliteMemoryProvider(path);
    db = new Database(path);
    const input = {
      type: 'semantic' as const,
      scope: 'room:r',
      content: 'old',
      confidence: 0.9,
      sourceRefs: [{ roomId: 'r', messageId: 'm' }],
    };
    const first = createMemory(input, { id: 'one', at: 'now' });
    store.create(first);
    store.create(
      createMemory({ ...input, content: 'new', supersedes: 'one' }, { id: 'two', at: 'later' }),
    );
    assert.equal(store.get('one').status, 'superseded');
    assert.equal(store.get('one').content, 'old');
    assert.equal(store.get('two').status, 'active');
    assert.throws(() =>
      db
        ?.query('INSERT OR REPLACE INTO memory_records(id,data,supersedes) VALUES (?,?,?)')
        .run(
          'replacement',
          JSON.stringify({ ...first, id: 'replacement', supersedes: 'one' }),
          'one',
        ),
    );
    assert.throws(() =>
      db
        ?.query(
          'INSERT OR REPLACE INTO memory_records(sequence,id,data,supersedes) VALUES (?,?,?,?)',
        )
        .run(
          1,
          'sequence-replacement',
          JSON.stringify({ ...first, id: 'sequence-replacement' }),
          null,
        ),
    );
    assert.equal(store.get('two').content, 'new');
    assert.equal(store.get('one').content, 'old');
    assert.throws(() =>
      store?.create(createMemory({ ...input, supersedes: 'one' }, { id: 'three', at: 'later' })),
    );
    assert.equal(store.list().length, 2);
    assert.throws(() => db?.exec("UPDATE memory_records SET data='{}' WHERE id='one'"));
    assert.throws(() => db?.exec("DELETE FROM memory_records WHERE id='one'"));
    assert.throws(() =>
      db
        ?.query('INSERT OR REPLACE INTO memory_records(id,data,supersedes) VALUES (?,?,?)')
        .run('one', JSON.stringify(first), null),
    );
    store.invalidate('two', 'obsolete', 'last');
    assert.equal(store.get('two').status, 'invalidated');
    assert.throws(() => store?.invalidate('two', 'again', 'last'));
    assert.throws(() => db?.exec('DELETE FROM memory_invalidations'));
    store.close();
    store = new SqliteMemoryProvider(path);
    assert.equal(store.get('one').status, 'superseded');
    assert.equal(store.get('two').status, 'invalidated');
    assert.deepEqual(store.list(['room:other']), []);
  } finally {
    db?.close();
    store?.close();
    rmSync(home, { recursive: true, force: true });
  }
});

test('Memory createOnce retains immutable originals and explicit invalidation without reviving them', () => {
  const dir = mkdtempSync('/tmp/org-memory-once-');
  const path = dir + '/org.db';
  const one = new SqliteMemoryProvider(path),
    two = new SqliteMemoryProvider(path);
  try {
    const memory = createMemory(
      {
        type: 'episodic',
        scope: 'task:t',
        content: 'reviewed',
        confidence: 1,
        sourceRefs: [{ uri: 'org://tasks/t/reviews/review' }],
      },
      { id: 'memory', at: 'now' },
    );
    assert.deepEqual(one.createOnce(memory), memory);
    assert.deepEqual(two.createOnce(memory), memory);
    assert.equal(one.list().length, 1);
    const invalid = one.invalidate(memory.id, 'obsolete', 'later');
    assert.deepEqual(two.createOnce(memory), invalid);
    assert.throws(
      () => one.createOnce({ ...memory, content: 'conflicting' }),
      /idempotency conflict/,
    );
    assert.equal(two.get(memory.id).status, 'invalidated');
  } finally {
    one.close();
    two.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
