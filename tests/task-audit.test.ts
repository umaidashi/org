import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { buildTaskExecutionAudit } from '../src/audit/tasks.js';
import { createTask, changeTask, attachArtifact } from '../src/tasks/domain.js';
test('Task execution Audit preserves original actor, Event and result refs without treating review as execution', () => {
  const assigned = {
    ...changeTask(
      createTask(
        { title: 'task', objective: 'work', kind: 'execution_task' },
        { id: 't', createdAt: '0' },
      ),
      { owner: 'worker' },
      '1',
    ),
    externalRef: 'org:event:event-1',
  };
  const running = changeTask(assigned, { status: 'running' }, '2');
  const linked = {
    ...attachArtifact(
      running,
      { id: 'artifact', uri: 'org://artifacts/blob', createdAt: '3' },
      'output',
    ),
    owner: 'replacement',
  };
  const ready = changeTask(linked, { status: 'waiting_approval' }, '3');
  const rejected = changeTask(ready, { status: 'failed' }, '4');
  const history = [assigned, running, linked, ready, rejected].map((task) => ({
    task,
    version: task.version,
    status: task.status,
    at: task.updatedAt,
  }));
  const entries = buildTaskExecutionAudit(history);
  assert.deepEqual(
    entries.map((x) => x.result),
    ['started', 'succeeded'],
  );
  assert.deepEqual(
    entries.map((x) => x.actor),
    [
      { kind: 'agent', id: 'worker' },
      { kind: 'agent', id: 'worker' },
    ],
  );
  assert.equal(entries[0]?.eventId, 'event-1');
  assert.equal(entries[1]?.outputRef, `org://tasks/t/versions/${ready.version}`);
  assert.equal(entries[0]?.approvalId, null);
  const failed = changeTask(running, { status: 'failed' }, '3');
  assert.deepEqual(
    buildTaskExecutionAudit(
      [assigned, running, failed].map((task) => ({
        task,
        version: task.version,
        status: task.status,
        at: task.updatedAt,
      })),
    ).map((x) => x.result),
    ['started', 'failed'],
  );
});
