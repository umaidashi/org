import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { SqliteTaskProvider } from '../src/tasks/sqlite.js';
import { createTask } from '../src/tasks/domain.js';
const initial = {
  ...createTask(
    { title: 'Issue', objective: 'Source', labels: ['ORG-1'] },
    { id: 'linear:issue:11111111-1111-4111-8111-111111111111', createdAt: '2026-10-06T00:00:00Z' },
  ),
  externalRef: 'https://linear.app/example/issue/ORG-1/example',
};
test('native Linear WorkItem import preserves progress and rejects changed source across connections', () => {
  const home = mkdtempSync('/tmp/org-linear-once-'),
    path = home + '/org.db',
    a = new SqliteTaskProvider(path),
    b = new SqliteTaskProvider(path);
  try {
    assert.deepEqual(a.importWorkItemOnce(initial), initial);
    const changed = a.update(initial.id, { title: 'Local progress' }, initial.createdAt, 0);
    assert.deepEqual(
      b.importWorkItemOnce({
        ...initial,
        createdAt: '2026-10-07T00:00:00Z',
        updatedAt: '2026-10-07T00:00:00Z',
      }),
      changed,
    );
    assert.equal(a.list().length, 1);
    assert.equal(a.history(initial.id).length, 2);
    assert.throws(
      () => b.importWorkItemOnce({ ...initial, objective: 'New remote source' }),
      /conflict/,
    );
    assert.equal(a.get(initial.id).title, 'Local progress');
  } finally {
    b.close();
    a.close();
    rmSync(home, { recursive: true, force: true });
  }
});
test('native import rolls Task and initial history back together on write failure', () => {
  const home = mkdtempSync('/tmp/org-linear-rollback-'),
    path = home + '/org.db',
    a = new SqliteTaskProvider(path),
    db = new Database(path);
  try {
    db.exec(
      "CREATE TRIGGER reject_import BEFORE INSERT ON task_history BEGIN SELECT RAISE(ABORT,'history failure'); END",
    );
    assert.throws(() => a.importWorkItemOnce(initial), /history failure/);
    assert.equal(a.list().length, 0);
    assert.throws(() => a.history(initial.id), /not found/);
    assert.deepEqual(db.query('SELECT COUNT(*) AS n FROM task_history').get(), { n: 0 });
    db.exec('DROP TRIGGER reject_import');
    assert.equal(a.importWorkItemOnce(initial).id, initial.id);
    assert.equal(a.history(initial.id).length, 1);
  } finally {
    db.close();
    a.close();
    rmSync(home, { recursive: true, force: true });
  }
});
