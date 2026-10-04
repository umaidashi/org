import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { createTask } from '../src/tasks/domain.js';
import { SqliteTaskProvider } from '../src/tasks/sqlite.js';
import { planTaskReview } from '../src/tasks/review.js';

test('approval preserves the completed-dependency invariant and leaves no partial decision', () => {
  const provider = new SqliteTaskProvider(':memory:');
  try {
    provider.create(
      createTask(
        { title: 'Dependency', objective: 'Pending work' },
        { id: 'dep', createdAt: 'before' },
      ),
    );
    provider.create(
      createTask(
        { kind: 'execution_task', title: 'Result', objective: 'Research' },
        { id: 'task', createdAt: 'before' },
      ),
    );
    provider.update('task', { owner: 'agent' }, 'assigned');
    provider.update('task', { status: 'running' }, 'started');
    provider.stageExecutionResult(
      'task',
      { id: 'output', uri: 'org://result', createdAt: 'produced' },
      2,
    );
    provider.update('task', { dependencies: ['dep'] }, 'changed', 4);
    const before = provider.get('task');
    const history = provider.history('task');
    const review = planTaskReview(
      before,
      { decision: 'approve', actor: 'founder', reason: 'Verified', expectedVersion: 5 },
      { id: 'decision', createdAt: 'reviewed' },
    );
    assert.throws(() => provider.recordReview(review), /dependencies are not completed/);
    assert.deepEqual(provider.get('task'), before);
    assert.deepEqual(provider.history('task'), history);
    assert.deepEqual(provider.reviews('task'), []);
    assert.equal(provider.recordReview({ ...review, decision: 'reject' }).status, 'failed');
    assert.equal(provider.get('dep').status, 'pending');
  } finally {
    provider.close();
  }
});

test('SQLite result review commits a decision with Task history and rejects stale or changed evidence', () => {
  const home = mkdtempSync('/tmp/org-task-review-');
  const path = home + '/org.db';
  const provider = new SqliteTaskProvider(path);
  const db = new Database(path);
  try {
    for (const id of ['approve', 'reject', 'rollback', 'stale']) {
      provider.create(
        createTask(
          { kind: 'execution_task', title: id, objective: 'Research' },
          { id, createdAt: 'before' },
        ),
      );
      provider.update(id, { owner: 'agent' }, 'assigned');
      provider.update(id, { status: 'running' }, 'started');
      provider.stageExecutionResult(
        id,
        { id: 'output', uri: 'org://result', createdAt: 'produced' },
        2,
      );
    }
    const review = planTaskReview(
      provider.get('approve'),
      { decision: 'approve', actor: 'founder', reason: 'Verified', expectedVersion: 4 },
      { id: 'decision', createdAt: 'reviewed' },
    );
    assert.throws(
      () => provider.recordReview({ ...review, outputArtifacts: ['other'] }),
      /evidence/,
    );
    const task = provider.recordReview(review);
    assert.equal(task.status, 'completed');
    assert.equal(task.version, 5);
    assert.deepEqual(provider.reviews('approve'), [review]);
    assert.equal(provider.history('approve').at(-1)?.status, 'completed');
    const rejected = planTaskReview(
      provider.get('reject'),
      { decision: 'reject', actor: 'founder', reason: 'Needs evidence', expectedVersion: 4 },
      { id: 'rejection', createdAt: 'reviewed' },
    );
    assert.equal(provider.recordReview(rejected).status, 'failed');
    const stale = planTaskReview(
      provider.get('stale'),
      { decision: 'approve', actor: 'founder', reason: 'Verified', expectedVersion: 4 },
      { id: 'old', createdAt: 'reviewed' },
    );
    provider.update('stale', { title: 'Updated' }, 'changed', 4);
    assert.throws(() => provider.recordReview(stale), /version conflict/);
    assert.deepEqual(provider.reviews('stale'), []);
    const before = provider.get('rollback');
    const history = provider.history('rollback');
    db.exec(
      "CREATE TRIGGER fail_review BEFORE INSERT ON task_reviews WHEN NEW.task_id='rollback' BEGIN SELECT RAISE(ABORT, 'review persistence failure'); END",
    );
    const failed = planTaskReview(
      before,
      { decision: 'approve', actor: 'founder', reason: 'Verified', expectedVersion: 4 },
      { id: 'failed', createdAt: 'reviewed' },
    );
    assert.throws(() => provider.recordReview(failed), /review persistence failure/);
    assert.deepEqual(provider.get('rollback'), before);
    assert.deepEqual(provider.history('rollback'), history);
    assert.deepEqual(provider.reviews('rollback'), []);
    db.exec('PRAGMA recursive_triggers=OFF');
    for (const sql of [
      "UPDATE task_reviews SET data='{}' WHERE id='decision'",
      "DELETE FROM task_reviews WHERE id='decision'",
      "INSERT OR REPLACE INTO task_reviews(id,task_id,task_version,data) VALUES('decision','other',1,'{}')",
      "INSERT OR REPLACE INTO task_reviews(id,task_id,task_version,data) VALUES('other','approve',4,'{}')",
      "INSERT OR REPLACE INTO task_reviews(rowid,id,task_id,task_version,data) SELECT rowid,'other','other',1,'{}' FROM task_reviews WHERE id='decision'",
    ])
      assert.throws(() => db.exec(sql), /immutable/);
    assert.deepEqual(provider.reviews('approve'), [review]);
  } finally {
    db.close();
    provider.close();
    rmSync(home, { recursive: true, force: true });
  }
});
