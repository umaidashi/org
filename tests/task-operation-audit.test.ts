import { buildAudit } from '../src/audit/domain.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { Database } from 'bun:sqlite';
import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { createTask } from '../src/tasks/domain.js';
import { planTaskReview } from '../src/tasks/review.js';
import { SqliteTaskProvider } from '../src/tasks/sqlite.js';
const at = '2026-10-08T00:00:00.000Z';
test('Task mutation Audit reuses originals and preserves writer, real clock and operation order', () => {
  const store = new SqliteTaskProvider(':memory:', { kind: 'system', id: 'core' }, () => at);
  try {
    store.create(
      createTask(
        { title: 'Synthetic', objective: 'private body', kind: 'execution_task' },
        { id: 'task', createdAt: '2026-10-01T00:00:00.000Z' },
      ),
    );
    store.update('task', { owner: 'agent' }, at);
    store.addComment('task', {
      id: 'comment',
      actor: 'declared',
      body: 'private body',
      createdAt: at,
    });
    store.update('task', { status: 'running' }, at);
    const ready = store.stageExecutionResult(
      'task',
      { id: 'result', uri: 'org://synthetic/result', createdAt: at },
      2,
    );
    store.recordReview(
      planTaskReview(
        ready,
        {
          actor: 'declared',
          decision: 'approve',
          reason: 'private body',
          expectedVersion: ready.version,
        },
        { id: 'review', createdAt: at },
      ),
    );
    const entries = store.operationHistory();
    assert.deepEqual(
      entries.map((entry) => entry.tool),
      [
        'task.create',
        'task.update',
        'task.comment',
        'task.update',
        'task.result.stage',
        'task.review',
      ],
    );
    assert.ok(
      entries.every(
        (entry) =>
          entry.actor.kind === 'system' &&
          entry.actor.id === 'core' &&
          entry.taskId === 'task' &&
          entry.at === at &&
          entry.result === 'succeeded',
      ),
    );
    assert.equal(entries[2]?.outputRef, 'org://tasks/task/comments/comment');
    assert.equal(entries[5]?.inputRef, 'org://tasks/task/reviews/review');
    assert.equal(JSON.stringify(entries).includes('private body'), false);
  } finally {
    store.close();
  }
});

test('Task Audit is atomic, immutable, persistent, and idempotent import/adoption/sync adds no replay', () => {
  const home = mkdtempSync('/tmp/org-task-operation-');
  const path = home + '/org.db';
  const store = new SqliteTaskProvider(path, { kind: 'system', id: 'core' }, () => at);
  const db = new Database(path);
  let closed = false;
  try {
    const initial = createTask(
      { title: 'Synthetic', objective: 'Done', kind: 'execution_task' },
      { id: 'adopted', createdAt: at },
    );
    const adopted = store.createAssignedOnce(initial, 'agent', at, { eventId: 'event' });
    assert.deepEqual(store.createAssignedOnce(initial, 'agent', at), adopted);
    const work = {
      ...createTask({ title: 'External', objective: 'Done' }, { id: 'work', createdAt: at }),
      kind: 'work_item' as const,
      externalRef: 'org://synthetic/issue',
    };
    store.importWorkItemOnce(work);
    store.importWorkItemOnce({ ...work, createdAt: 'later', updatedAt: 'later' });
    store.syncWorkItem(work, 0, at);
    store.syncWorkItem({ ...work, title: 'Changed' }, 0, at);
    store.linkArtifact(
      'work',
      { id: 'input', uri: 'org://synthetic/input', createdAt: at },
      'input',
    );
    const legacy = createTask(
      { title: 'Legacy', objective: 'Unknown writer' },
      { id: 'legacy', createdAt: at },
    );
    db.query('INSERT INTO tasks(id,version,data) VALUES (?,?,?)').run(
      legacy.id,
      legacy.version,
      JSON.stringify(legacy),
    );
    db.query('INSERT INTO task_history(task_id,version,status,data) VALUES (?,?,?,?)').run(
      legacy.id,
      legacy.version,
      legacy.status,
      JSON.stringify(legacy),
    );
    assert.equal(store.history('legacy').length, 1);
    assert.equal(
      store.operationHistory().some((entry) => entry.taskId === 'legacy'),
      false,
    );
    const original = store.operationHistory();
    assert.deepEqual(
      original.map((entry) => entry.tool),
      ['task.adopt', 'task.import', 'task.sync', 'task.artifact.link'],
    );
    assert.equal(original[0]?.eventId, 'event');
    assert.equal(store.history('adopted').length, 2);
    assert.deepEqual(
      buildAudit([], [], original).map((entry) => entry.id),
      original.map((entry) => entry.id),
    );
    db.exec(
      "CREATE TRIGGER reject_audit BEFORE INSERT ON task_operation_history BEGIN SELECT RAISE(ABORT, 'audit failure'); END",
    );
    assert.throws(
      () =>
        store.create(
          createTask({ title: 'Rejected', objective: 'Done' }, { id: 'rejected', createdAt: at }),
        ),
      /audit failure/,
    );
    assert.throws(() => store.get('rejected'), /not found/);
    assert.throws(() => store.update('work', { title: 'Rejected' }, at), /audit failure/);
    assert.equal(store.get('work').title, 'Changed');
    assert.throws(
      () =>
        store.addComment('work', {
          id: 'rejected-comment',
          actor: 'declared',
          body: 'body',
          createdAt: at,
        }),
      /audit failure/,
    );
    assert.equal(store.comments('work').length, 0);
    assert.throws(
      () =>
        store.linkArtifact(
          'work',
          { id: 'rejected-artifact', uri: 'org://synthetic/rejected', createdAt: at },
          'output',
        ),
      /audit failure/,
    );
    assert.equal(store.artifacts('work').length, 1);
    assert.deepEqual(store.operationHistory(), original);
    db.exec('DROP TRIGGER reject_audit');
    store.update('adopted', { status: 'running' }, at);
    const running = store.get('adopted');
    db.exec(
      "CREATE TRIGGER reject_audit BEFORE INSERT ON task_operation_history BEGIN SELECT RAISE(ABORT, 'audit failure'); END",
    );
    assert.throws(
      () =>
        store.stageExecutionResult(
          'adopted',
          { id: 'out', uri: 'org://synthetic/out', createdAt: at },
          running.version,
        ),
      /audit failure/,
    );
    assert.deepEqual(store.get('adopted'), running);
    assert.equal(store.artifacts('adopted').length, 0);
    db.exec('DROP TRIGGER reject_audit');
    const ready = store.stageExecutionResult(
      'adopted',
      { id: 'out', uri: 'org://synthetic/out', createdAt: at },
      running.version,
    );
    db.exec(
      "CREATE TRIGGER reject_audit BEFORE INSERT ON task_operation_history BEGIN SELECT RAISE(ABORT, 'audit failure'); END",
    );
    assert.throws(
      () =>
        store.recordReview(
          planTaskReview(
            ready,
            {
              decision: 'approve',
              actor: 'declared',
              reason: 'Checked',
              expectedVersion: ready.version,
            },
            { id: 'review', createdAt: at },
          ),
        ),
      /audit failure/,
    );
    assert.deepEqual(store.get('adopted'), ready);
    assert.equal(store.reviews('adopted').length, 0);
    db.exec('DROP TRIGGER reject_audit');
    const persisted = store.operationHistory();
    for (const sql of [
      'UPDATE task_operation_history SET data=data',
      'DELETE FROM task_operation_history',
      'INSERT OR REPLACE INTO task_operation_history SELECT * FROM task_operation_history',
    ])
      assert.throws(() => db.exec(sql), /immutable/);
    store.close();
    closed = true;
    const reopened = new SqliteTaskProvider(path);
    try {
      assert.deepEqual(reopened.operationHistory(), persisted);
    } finally {
      reopened.close();
    }
  } finally {
    if (!closed) store.close();
    db.close();
    rmSync(home, { recursive: true, force: true });
  }
});
