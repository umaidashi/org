import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { createTask, changeTask } from '../src/tasks/domain.js';
import { SqliteTaskProvider } from '../src/tasks/sqlite.js';

const identity = { id: 'one', createdAt: '2026-10-04T00:00:00.000Z' };
await test('pure task decisions preserve identity and reject illegal state changes', () => {
  const task = createTask({ title: 'Test', objective: 'Done' }, identity);
  assert.equal(task.id, 'one');
  assert.equal(task.status, 'pending');
  assert.equal(task.createdAt, identity.createdAt);
  assert.throws(() => changeTask(task, { status: 'completed' }, identity.createdAt));
  assert.throws(() => createTask({ title: ' ', objective: 'Done' }, identity));
  assert.throws(() => createTask({ title: 'x', objective: ' ' }, identity));
});

await test('task state and immutable history rollback together on storage failure', () => {
  const directory = mkdtempSync(join(tmpdir(), 'org-task-transaction-'));
  const path = join(directory, 'org.db');
  const provider = new SqliteTaskProvider(path);
  const inspector = new DatabaseSync(path);
  try {
    provider.create(createTask({ title: 'Test', objective: 'Done' }, identity));
    inspector.exec(`CREATE TRIGGER reject_history BEFORE INSERT ON task_history
      WHEN NEW.version > 0 BEGIN SELECT RAISE(ABORT, 'history failure'); END`);
    assert.throws(
      () => provider.update('one', { title: 'Changed' }, identity.createdAt),
      /history failure/,
    );
    assert.equal(provider.get('one').title, 'Test');
    assert.equal(provider.history('one').length, 1);
    inspector.exec('DROP TRIGGER reject_history');
    const changed = provider.update('one', { title: 'Changed' }, identity.createdAt);
    assert.equal(changed.version, 1);
    assert.equal(provider.history('one').length, 2);
    assert.throws(() => inspector.exec("UPDATE task_history SET status='failed'"), /immutable/);
    assert.throws(() => inspector.exec('DELETE FROM task_history'), /immutable/);
    assert.throws(
      () => provider.update('one', { title: 'Stale' }, identity.createdAt, 0),
      /version/,
    );
    assert.equal(provider.get('one').title, 'Changed');
  } finally {
    inspector.close();
    provider.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

await test('comments and artifact references persist without rewriting existing task history', () => {
  const directory = mkdtempSync(join(tmpdir(), 'org-task-notes-'));
  const path = join(directory, 'org.db');
  const provider = new SqliteTaskProvider(path);
  try {
    provider.create(createTask({ title: 'Test', objective: 'Done' }, identity));
    const original = provider.history('one')[0];
    provider.addComment('one', {
      id: 'comment',
      body: 'Reviewed',
      actor: 'human',
      createdAt: identity.createdAt,
    });
    provider.linkArtifact(
      'one',
      { id: 'artifact', uri: 'file:///tmp/result.txt', createdAt: identity.createdAt },
      'output',
    );
    assert.deepEqual(provider.get('one').outputArtifacts, ['artifact']);
    assert.deepEqual(provider.history('one')[0], original);
    assert.throws(
      () =>
        provider.addComment('missing', {
          id: 'bad',
          body: 'x',
          actor: 'human',
          createdAt: identity.createdAt,
        }),
      /not found/,
    );
  } finally {
    provider.close();
  }
  const reopened = new SqliteTaskProvider(path);
  try {
    assert.deepEqual(
      reopened.comments('one').map((comment) => comment.body),
      ['Reviewed'],
    );
    assert.deepEqual(
      reopened.artifacts('one').map((artifact) => artifact.uri),
      ['file:///tmp/result.txt'],
    );
  } finally {
    reopened.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

await test('comment and artifact originals cannot be modified and artifact linking rolls back with history', () => {
  const directory = mkdtempSync(join(tmpdir(), 'org-task-artifact-'));
  const path = join(directory, 'org.db');
  const provider = new SqliteTaskProvider(path);
  const inspector = new DatabaseSync(path);
  try {
    provider.create(createTask({ title: 'Test', objective: 'Done' }, identity));
    provider.addComment('one', {
      id: 'comment',
      body: 'Review',
      actor: 'human',
      createdAt: identity.createdAt,
    });
    assert.throws(() => inspector.exec("UPDATE task_comments SET body='Forged'"), /immutable/);
    inspector.exec(`CREATE TRIGGER reject_artifact_history BEFORE INSERT ON task_history
      WHEN NEW.version > 0 BEGIN SELECT RAISE(ABORT, 'artifact history failure'); END`);
    assert.throws(
      () =>
        provider.linkArtifact(
          'one',
          { id: 'artifact', uri: 'file:///result', createdAt: identity.createdAt },
          'output',
        ),
      /artifact history failure/,
    );
    assert.deepEqual(provider.get('one').outputArtifacts, []);
    assert.deepEqual(provider.artifacts('one'), []);
    assert.equal(provider.get('one').version, 0);
    inspector.exec('DROP TRIGGER reject_artifact_history');
    provider.linkArtifact(
      'one',
      { id: 'artifact', uri: 'file:///result', createdAt: identity.createdAt },
      'output',
    );
    assert.throws(() => inspector.exec('DELETE FROM task_artifacts'), /immutable/);
  } finally {
    inspector.close();
    provider.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
