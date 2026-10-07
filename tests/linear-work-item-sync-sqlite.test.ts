import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { createTask } from '../src/tasks/domain.js';
import type { WorkItem } from '../src/tasks/domain.js';
import { SqliteTaskProvider } from '../src/tasks/sqlite.js';
test('Core WorkItem synchronization uses atomic CAS and immutable history, preserves Local originals and survives reopen', () => {
  const home = mkdtempSync('/tmp/org-linear-sync-sqlite-'),
    db = home + '/org.db';
  let provider = new SqliteTaskProvider(db);
  const id = 'linear:issue:11111111-1111-4111-8111-111111111111';
  try {
    provider.create(
      createTask({ title: 'Parent', objective: 'Parent' }, { id: 'parent', createdAt: 'created' }),
    );
    provider.create(
      createTask(
        { title: 'Dependency', objective: 'Pending' },
        { id: 'dep', createdAt: 'created' },
      ),
    );
    const initial = {
      ...createTask(
        { title: 'Local', objective: 'Old', parentId: 'parent', dependencies: ['dep'] },
        { id, createdAt: 'created' },
      ),
      externalRef: 'https://linear.app/org/issue/ORG-1/existing',
    };
    provider.importWorkItemOnce(initial);
    provider.linkArtifact(id, { id: 'in', uri: 'input-uri', createdAt: 'linked-in' }, 'input');
    provider.linkArtifact(id, { id: 'out', uri: 'output-uri', createdAt: 'linked-out' }, 'output');
    provider.addComment(id, {
      id: 'comment',
      body: 'Keep',
      actor: 'human',
      createdAt: 'comment-time',
    });
    const original = provider.get(id),
      history = provider.history(id),
      artifacts = provider.artifacts(id),
      comments = provider.comments(id);
    const snapshot: WorkItem = {
      ...original,
      kind: 'work_item',
      status: 'completed',
      owner: null,
      title: 'Remote',
      objective: 'Remote objective',
      priority: 2,
      labels: ['bug'],
      parentId: null,
      dependencies: [],
      inputArtifacts: [],
      outputArtifacts: [],
      createdAt: 'remote-created',
      updatedAt: 'remote-updated',
      version: 0,
    };
    const result = provider.syncWorkItem(snapshot, 2, 'commit-time');
    assert.deepEqual(result, {
      ...original,
      title: 'Remote',
      objective: 'Remote objective',
      status: 'completed',
      owner: null,
      priority: 2,
      labels: ['bug'],
      version: 3,
      updatedAt: 'commit-time',
    });
    assert.deepEqual(provider.history(id).slice(0, 3), history);
    assert.deepEqual(provider.artifacts(id), artifacts);
    assert.deepEqual(provider.comments(id), comments);
    assert.deepEqual(provider.syncWorkItem(snapshot, 3, 'later'), result);
    assert.equal(provider.history(id).length, 4);
    for (const stale of [2, -1, 1.5])
      assert.throws(() => provider.syncWorkItem(snapshot, stale, 'later'), /version/);
    assert.equal(provider.history(id).length, 4);
    provider.close();
    provider = new SqliteTaskProvider(db);
    assert.deepEqual(provider.get(id), result);
    const reopened = provider.syncWorkItem(
      { ...snapshot, status: 'running', owner: 'agent' },
      3,
      'reopened',
    );
    assert.equal(reopened.version, 4);
    assert.equal(reopened.status, 'running');
    const raw = new Database(db);
    try {
      raw.exec(
        "CREATE TRIGGER reject_sync_history BEFORE INSERT ON task_history WHEN NEW.status='blocked' BEGIN SELECT RAISE(ABORT,'fixture history failure'); END;",
      );
      assert.throws(
        () =>
          provider.syncWorkItem({ ...snapshot, status: 'blocked' }, 4, 'failed', {
            parentId: null,
            dependencies: [],
          }),
        /fixture history failure/,
      );
      assert.deepEqual(provider.get(id), reopened);
      assert.equal(provider.history(id).length, 5);
      assert.throws(
        () => raw.query('UPDATE task_history SET status=? WHERE task_id=?').run('failed', id),
        /immutable/,
      );
    } finally {
      raw.close();
    }
    const execution = createTask(
      { title: 'Internal', objective: 'Run', kind: 'execution_task' },
      { id: 'execution', createdAt: 'now' },
    );
    provider.create(execution);
    assert.throws(
      () => provider.syncWorkItem({ ...snapshot, id: execution.id }, 0, 'now'),
      /external WorkItem/,
    );
    assert.deepEqual(provider.get(execution.id), execution);
    assert.deepEqual(provider.artifacts(id), artifacts);
    assert.deepEqual(provider.comments(id), comments);
    const relationVersion = provider.get(id).version;
    const relations = provider.syncWorkItem(
      { ...snapshot, status: 'running', owner: 'agent' },
      relationVersion,
      'relations',
      { parentId: null, dependencies: [] },
    );
    assert.equal(relations.parentId, null);
    assert.deepEqual(relations.dependencies, []);
    assert.equal(relations.version, relationVersion + 1);
    assert.deepEqual(relations.outputArtifacts, original.outputArtifacts);
    assert.throws(
      () => provider.syncWorkItem(snapshot, relations.version, 'cycle', { parentId: id }),
      /cycle/,
    );
    assert.deepEqual(provider.get(id), relations);
    assert.equal(provider.history(id).length, relations.version + 1);
  } finally {
    provider.close();
    rmSync(home, { recursive: true, force: true });
  }
});
