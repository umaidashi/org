import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { SqliteMemoryProvider } from '../src/memory/sqlite.js';
import { createMemory } from '../src/memory/domain.js';

test('Memory FTS backfills legacy originals, indexes atomic inserts and preserves projections across adapters', () => {
  const dir = mkdtempSync('/tmp/org-memory-search-');
  const path = dir + '/org.db';
  const entry = (id: string, scope = 'room:r') =>
    createMemory(
      {
        type: 'semantic',
        scope,
        content: '日本語の検索と say "quoted" code',
        confidence: 1,
        sourceRefs: [{ roomId: 'r', messageId: 'm' }],
      },
      { id, at: '2026-10-05T00:00:00.000Z' },
    );
  let one: SqliteMemoryProvider | undefined, two: SqliteMemoryProvider | undefined;
  try {
    one = new SqliteMemoryProvider(path);
    const old = one.create(entry('old'));
    one.close();
    one = undefined;
    const legacy = new Database(path);
    legacy.exec(
      'DROP TRIGGER IF EXISTS memory_records_search_insert;DROP TABLE IF EXISTS memory_search;DROP VIEW IF EXISTS memory_search_content;',
    );
    legacy.close();
    one = new SqliteMemoryProvider(path);
    two = new SqliteMemoryProvider(path);
    assert.deepEqual(one.search('日本語', ['room:r']), [old]);
    assert.deepEqual(two.search('"quoted"'), [old]);
    const next = two.create({ ...entry('next'), supersedes: 'old' });
    one.create(entry('foreign', 'room:other'));
    assert.deepEqual(one.search('日本語', ['room:r']), [{ ...old, status: 'superseded' }, next]);
    one.invalidate('next', 'obsolete', 'now');
    assert.equal(two.search('日本語', ['room:r'])[1]?.status, 'invalidated');
    assert.deepEqual(one.search('foo" OR "日本語'), []);
    for (const query of ['', 'ab', ' '.repeat(3), 'x'.repeat(1025)])
      assert.throws(() => one?.search(query));
    const native = new Database(path);
    native.exec('DROP TABLE memory_search');
    assert.throws(() => one?.create(entry('rolled-back')));
    assert.equal(
      (
        native.query('SELECT count(*) AS n FROM memory_records WHERE id=?').get('rolled-back') as {
          n: number;
        }
      ).n,
      0,
    );
    native.close();
    one.close();
    one = undefined;
    two.close();
    two = undefined;
    one = new SqliteMemoryProvider(path);
    assert.deepEqual(
      one.search('日本語', ['room:r']).map((m) => m.status),
      ['superseded', 'invalidated'],
    );
    assert.equal(one.get('old').content, old.content);
  } finally {
    one?.close();
    two?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
