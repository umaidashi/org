import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { SqliteTaskProvider } from '../src/tasks/sqlite.js';
import { createTask } from '../src/tasks/domain.js';
test('Task result atomically links artifact and waiting approval history, preserving running on rollback', () => {
  const home = mkdtempSync('/tmp/org-task-result-');
  const path = home + '/org.db';
  const store = new SqliteTaskProvider(path);
  const db = new Database(path);
  try {
    store.create(
      createTask(
        { title: 'research', objective: 'read', kind: 'execution_task' },
        { id: 't', createdAt: 'now' },
      ),
    );
    store.update('t', { owner: 'a' }, 'now');
    const running = store.update('t', { status: 'running' }, 'now');
    const artifact = { id: 'reply', uri: 'org://rooms/r/messages/reply', createdAt: 'later' };
    db.exec(
      "CREATE TRIGGER reject_result BEFORE INSERT ON task_artifacts BEGIN SELECT RAISE(ABORT,'reject result'); END;",
    );
    assert.throws(() => store.stageExecutionResult('t', artifact, running.version));
    assert.deepEqual(store.get('t'), running);
    assert.deepEqual(store.artifacts('t'), []);
    assert.equal(store.history('t').length, 3);
    db.exec('DROP TRIGGER reject_result');
    const ready = store.stageExecutionResult('t', artifact, running.version);
    assert.equal(ready.status, 'waiting_approval');
    assert.deepEqual(ready.outputArtifacts, ['reply']);
    assert.equal(store.artifacts('t').length, 1);
    assert.throws(() =>
      db
        .query('INSERT OR REPLACE INTO task_artifacts(task_id,id,uri,created_at) VALUES (?,?,?,?)')
        .run('t', 'reply', 'changed', 'later'),
    );
    assert.throws(() =>
      db
        .query('INSERT OR REPLACE INTO task_history(task_id,version,status,data) VALUES (?,?,?,?)')
        .run('t', 0, 'failed', '{}'),
    );
    assert.throws(() =>
      db
        .query(
          'INSERT OR REPLACE INTO task_artifacts(rowid,task_id,id,uri,created_at) VALUES (?,?,?,?,?)',
        )
        .run(1, 'other', 'new', 'changed', 'later'),
    );
    store.addComment('t', { id: 'comment', body: 'original', actor: 'a', createdAt: 'later' });
    assert.throws(() =>
      db
        .query(
          'INSERT OR REPLACE INTO task_comments(task_id,id,body,actor,created_at) VALUES (?,?,?,?,?)',
        )
        .run('t', 'comment', 'changed', 'a', 'later'),
    );
    assert.equal(store.artifacts('t')[0]?.uri, artifact.uri);
    assert.equal(store.comments('t')[0]?.body, 'original');
    assert.equal(store.history('t').at(-1)?.status, 'waiting_approval');
    assert.throws(() =>
      store.stageExecutionResult('t', { ...artifact, id: 'late' }, running.version),
    );
    assert.equal(store.artifacts('t').length, 1);
  } finally {
    db.close();
    store.close();
    rmSync(home, { recursive: true, force: true });
  }
});
