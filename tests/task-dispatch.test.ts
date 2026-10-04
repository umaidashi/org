import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createTask } from '../src/tasks/domain.js';
import { SqliteTaskProvider } from '../src/tasks/sqlite.js';
test('idempotent assigned creation rolls back both snapshots and never reassigns advanced Task', () => {
  const dir = mkdtempSync(join(tmpdir(), 'org-dispatch-task-'));
  let provider: SqliteTaskProvider | undefined;
  let db: Database | undefined;
  try {
    const path = join(dir, 'org.db');
    provider = new SqliteTaskProvider(path);
    db = new Database(path);
    const input = createTask(
      { title: 'event', objective: 'process', kind: 'execution_task' },
      { id: 'delivery', createdAt: 'now' },
    );
    db.exec(
      "CREATE TRIGGER fail_assignment BEFORE INSERT ON task_history WHEN NEW.version=1 BEGIN SELECT RAISE(ABORT, 'assignment failure'); END",
    );
    assert.throws(() => provider?.createAssignedOnce(input, 'dev', 'now'), /assignment failure/);
    assert.deepEqual(provider.list(), []);
    assert.equal(
      db.query<{ count: number }, []>('SELECT COUNT(*) AS count FROM task_history').get()?.count,
      0,
    );
    db.exec('DROP TRIGGER fail_assignment');
    const task = provider.createAssignedOnce(input, 'dev', 'now');
    assert.equal(task.status, 'assigned');
    assert.deepEqual(
      provider.history(input.id).map((h) => h.status),
      ['pending', 'assigned'],
    );
    provider.update(input.id, { status: 'running' }, 'later');
    const history = provider.history(input.id);
    assert.equal(provider.createAssignedOnce(input, 'dev', 'now').status, 'running');
    assert.deepEqual(provider.history(input.id), history);
    assert.throws(
      () => provider?.createAssignedOnce({ ...input, title: 'different' }, 'dev', 'now'),
      /conflict/,
    );
    assert.throws(() => provider?.createAssignedOnce(input, 'other', 'now'), /conflict/);
  } finally {
    db?.close();
    provider?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
