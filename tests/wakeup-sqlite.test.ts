import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { SqliteWakeupJournal } from '../src/activation/sqlite.js';
test('Wakeup SQLite claims once, preserves immutable intent and result, rejects failure and reopens', () => {
  const home = mkdtempSync('/tmp/org-wakeup-db-'),
    path = home + '/org.db';
  const journal = new SqliteWakeupJournal(path),
    other = new SqliteWakeupJournal(path),
    db = new Database(path);
  try {
    const intent = { messageId: 'message', roomId: 'room', startedAt: 'start' };
    assert.equal(journal.claim(intent), true);
    assert.equal(other.claim(intent), false);
    assert.equal(journal.get('message')?.status, 'running');
    const result = {
      status: 'completed' as const,
      replyIds: ['reply'],
      error: null,
      finishedAt: 'finish',
    };
    assert.throws(() => journal.finish('missing', result), /intent/i);
    db.exec(
      "CREATE TRIGGER reject_wakeup_result BEFORE INSERT ON wakeup_results BEGIN SELECT RAISE(ABORT, 'test failure'); END;",
    );
    assert.throws(() => journal.finish('message', result), /test failure/);
    assert.equal(journal.get('message')?.status, 'running');
    db.exec('DROP TRIGGER reject_wakeup_result');
    journal.finish('message', result);
    assert.deepEqual(other.get('message'), { ...intent, ...result });
    assert.throws(() => journal.finish('message', result));
    for (const table of ['wakeup_intents', 'wakeup_results']) {
      assert.throws(() => db.exec(`UPDATE ${table} SET message_id='changed'`));
      assert.throws(() => db.exec(`DELETE FROM ${table}`));
      assert.throws(() => db.exec(`INSERT OR REPLACE INTO ${table} SELECT * FROM ${table}`));
      assert.throws(() =>
        db.exec(`INSERT OR REPLACE INTO ${table} SELECT sequence,'other',data FROM ${table}`),
      );
    }
    assert.deepEqual(journal.list(), [{ ...intent, ...result }]);
    const reopened = new SqliteWakeupJournal(path);
    try {
      assert.deepEqual(reopened.list(), journal.list());
    } finally {
      reopened.close();
    }
    assert.throws(() => journal.claim({ ...intent, messageId: ' ' }));
    assert.throws(() => journal.finish('message', { ...result, finishedAt: ' ' }));
  } finally {
    db.close();
    other.close();
    journal.close();
    rmSync(home, { recursive: true, force: true });
  }
});
