import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSession, transitionSession } from '../src/sessions/domain.js';
import { SqliteSessionStore } from '../src/sessions/sqlite.js';
test('Session state and immutable history persist atomically and reject stale writers', () => {
  const dir = mkdtempSync(join(tmpdir(), 'org-session-'));
  const path = join(dir, 'org.db');
  let store: SqliteSessionStore | undefined;
  let raw: Database | undefined;
  try {
    store = new SqliteSessionStore(path);
    const session = createSession(
      { agentId: 'a', roomId: 'r', runtime: 'codex' },
      { id: 's', at: 't0' },
    );
    store.create(session);
    const running = transitionSession(session, { type: 'begin', at: 't1' });
    store.save(running, 0);
    assert.throws(() => store?.save(running, 0), /version/i);
    raw = new Database(path);
    raw.exec(
      "CREATE TRIGGER fail_session_history BEFORE INSERT ON session_history BEGIN SELECT RAISE(ABORT, 'history failure'); END",
    );
    const completed = transitionSession(running, {
      type: 'complete',
      providerSessionId: 'p',
      at: 't2',
    });
    assert.throws(() => store?.save(completed, 1), /history failure/);
    assert.deepEqual(store.get('s'), running);
    assert.equal(store.history('s').length, 2);
    raw.exec('DROP TRIGGER fail_session_history');
    store.save(completed, 1);
    assert.throws(() => raw?.exec("DELETE FROM session_history WHERE id='s'"), /immutable/);
    assert.throws(
      () => raw?.exec("UPDATE session_history SET data='{}' WHERE id='s'"),
      /immutable/,
    );
    assert.throws(
      () => raw?.exec("INSERT OR REPLACE INTO session_history(id,version,data) VALUES('s',0,'{}')"),
      /immutable/,
    );
    store.close();
    store = new SqliteSessionStore(path);
    assert.deepEqual(store.get('s'), completed);
    assert.deepEqual(store.list(), [completed]);
    assert.deepEqual(store.history('s'), [session, running, completed]);
    const child = Bun.spawnSync([
      process.execPath,
      '--no-env-file',
      '-e',
      'import {SqliteSessionStore} from "./src/sessions/sqlite.ts"; const store = new SqliteSessionStore(process.argv[1]); try { console.log(JSON.stringify(store.get("s"))); } finally { store.close(); }',
      path,
    ]);
    assert.equal(child.exitCode, 0, child.stderr.toString());
    const readBack: unknown = JSON.parse(child.stdout.toString());
    assert.deepEqual(readBack, completed);
    assert.throws(() => store?.get('missing'), /not found/);
  } finally {
    raw?.close();
    store?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Session store refuses a fabricated completion without a running turn', () => {
  const store = new SqliteSessionStore(':memory:');
  try {
    const initial = createSession(
      { agentId: 'a', roomId: 'r', runtime: 'claude' },
      { id: 's', at: 't0' },
    );
    store.create(initial);
    assert.throws(
      () => store.save({ ...initial, providerSessionId: 'p', version: 1, updatedAt: 't1' }, 0),
      /running|transition/,
    );
    assert.deepEqual(store.get('s'), initial);
    assert.deepEqual(store.history('s'), [initial]);
  } finally {
    store.close();
  }
});
