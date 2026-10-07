import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import { test } from 'bun:test';
import { createTask } from '../src/tasks/domain.js';
import { SqliteTaskProvider } from '../src/tasks/sqlite.js';

const identity = { id: 'one', createdAt: '2026-10-04T00:00:00.000Z' };

test('task state and immutable history rollback together on storage failure', () => {
  const directory = mkdtempSync(join(tmpdir(), 'org-task-transaction-'));
  const path = join(directory, 'org.db');
  const provider = new SqliteTaskProvider(path);
  const inspector = new Database(path);
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

test('comments and artifact references persist without rewriting existing task history', () => {
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

test('comment and artifact originals cannot be modified and artifact linking rolls back with history', () => {
  const directory = mkdtempSync(join(tmpdir(), 'org-task-artifact-'));
  const path = join(directory, 'org.db');
  const provider = new SqliteTaskProvider(path);
  const inspector = new Database(path);
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

test('converging dependency graphs do not repeatedly load the same completed subtree', () => {
  class CountingProvider extends SqliteTaskProvider {
    reads = 0;
    override get(id: string) {
      this.reads += 1;
      return super.get(id);
    }
  }
  const provider = new CountingProvider(':memory:');
  try {
    const ids: string[] = [];
    for (let index = 0; index < 18; index += 1) {
      provider.create(
        createTask(
          { title: 'Task', objective: 'Done', dependencies: [...ids] },
          { ...identity, id: `task-${index}` },
        ),
      );
      ids.push(`task-${index}`);
    }
    provider.reads = 0;
    provider.update('task-17', { title: 'Edited' }, identity.createdAt);
    assert.ok(
      provider.reads <= 400,
      `Expected graph-sized work, observed ${provider.reads} DB loads`,
    );
  } finally {
    provider.close();
  }
});

test('common comment and artifact version checks run inside their Local transaction and preserve history on refusal', () => {
  const directory = mkdtempSync(join(tmpdir(), 'org-task-common-cas-'));
  const path = join(directory, 'org.db'),
    provider = new SqliteTaskProvider(path),
    inspector = new Database(path);
  try {
    provider.create(createTask({ title: 'Task', objective: 'Task' }, identity));
    const comment = { id: 'comment', body: 'Note', actor: 'human', createdAt: 'before' },
      artifact = { id: 'artifact', uri: 'https://example.test/artifact', createdAt: 'after' };
    for (const version of [1, -1, 0.5]) {
      assert.throws(() => provider.addComment('one', comment, version), /version/);
      assert.throws(() => provider.linkArtifact('one', artifact, 'output', version), /version/);
    }
    assert.deepEqual(provider.comments('one'), []);
    assert.deepEqual(provider.artifacts('one'), []);
    assert.equal(provider.history('one').length, 1);
    provider.addComment('one', comment, 0);
    assert.equal(provider.get('one').version, 0);
    inspector.exec(
      "CREATE TRIGGER reject_common_artifact_history BEFORE INSERT ON task_history WHEN NEW.version>0 BEGIN SELECT RAISE(ABORT,'fixture artifact history failure'); END",
    );
    assert.throws(
      () => provider.linkArtifact('one', artifact, 'output', 0),
      /fixture artifact history failure/,
    );
    assert.deepEqual(provider.artifacts('one'), []);
    assert.equal(provider.get('one').version, 0);
    assert.equal(provider.history('one').length, 1);
    inspector.exec('DROP TRIGGER reject_common_artifact_history');
    assert.equal(provider.linkArtifact('one', artifact, 'output', 0).version, 1);
    assert.throws(() => provider.addComment('one', { ...comment, id: 'stale' }, 0), /version/);
    assert.deepEqual(provider.comments('one'), [comment]);
  } finally {
    inspector.close();
    provider.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('all Local comment and artifact callers share boundary guards against NUL and invalid metadata before saving', () => {
  const directory = mkdtempSync(join(tmpdir(), 'org-task-write-boundary-'));
  const provider = new SqliteTaskProvider(join(directory, 'org.db'));
  try {
    provider.create(createTask({ title: 'Task', objective: 'Task' }, identity));
    assert.throws(() =>
      provider.addComment('one', {
        id: 'comment',
        body: 'bad\0body',
        actor: 'human',
        createdAt: 'now',
      }),
    );
    assert.throws(() =>
      provider.linkArtifact(
        'one',
        { id: 'artifact', uri: 'https://example.test/\0', createdAt: 'now' },
        'output',
      ),
    );
    assert.deepEqual(provider.comments('one'), []);
    assert.deepEqual(provider.artifacts('one'), []);
    assert.equal(provider.get('one').version, 0);
  } finally {
    provider.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
