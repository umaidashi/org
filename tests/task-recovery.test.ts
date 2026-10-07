import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { createTask, changeTask } from '../src/tasks/domain.js';
import { recoverInterruptedExecutionTasks } from '../src/tasks/service.js';
test('startup recovery blocks verified saved results and propagates proof failures before writing', () => {
  const running = changeTask(
    changeTask(
      createTask(
        { title: 'task', objective: 'work', kind: 'execution_task' },
        { id: 'e', createdAt: 'before' },
      ),
      { owner: 'agent' },
      'assigned',
    ),
    { status: 'running' },
    'started',
  );
  const statuses: string[] = [];
  const provider = {
    list: () => [running],
    update: (
      _id: string,
      patch: Parameters<typeof changeTask>[1],
      at: string,
      version?: number,
    ) => {
      assert.equal(version, running.version);
      statuses.push(patch.status ?? '');
      return changeTask(running, patch, at);
    },
  };
  recoverInterruptedExecutionTasks(
    provider,
    () => 'recovered',
    (task) => {
      assert.equal(task, running);
      return true;
    },
  );
  assert.deepEqual(statuses, ['blocked']);
  assert.throws(
    () =>
      recoverInterruptedExecutionTasks(
        provider,
        () => 'recovered',
        () => {
          throw new Error('proof read failure');
        },
      ),
    /proof read failure/,
  );
  assert.deepEqual(statuses, ['blocked']);
});

test('recovery fails only running executions using the observed version and injected time', () => {
  const base = createTask(
    { title: 'task', objective: 'work', kind: 'execution_task' },
    { id: 'e', createdAt: 'before' },
  );
  const running = changeTask(
    changeTask(base, { owner: 'agent' }, 'assigned'),
    { status: 'running' },
    'started',
  );
  const writes: string[] = [];
  recoverInterruptedExecutionTasks(
    {
      list: () => [
        running,
        { ...running, id: 'work', kind: 'work_item' },
        { ...running, id: 'review', status: 'waiting_approval' },
      ],
      update: (id, patch, at, version) => {
        assert.equal(id, 'e');
        assert.deepEqual(patch, { status: 'failed' });
        assert.equal(at, 'recovered');
        assert.equal(version, running.version);
        writes.push(id);
        return changeTask(running, patch, at);
      },
    },
    () => 'recovered',
  );
  assert.deepEqual(writes, ['e']);
});

test('recovery propagates write conflicts instead of accepting new commands with stale state', () => {
  const task = createTask(
    { title: 'task', objective: 'work', kind: 'execution_task' },
    { id: 'e', createdAt: 'before' },
  );
  assert.throws(
    () =>
      recoverInterruptedExecutionTasks(
        {
          list: () => [{ ...task, status: 'running' }],
          update: () => {
            throw new Error('version conflict');
          },
        },
        () => 'now',
      ),
    /version conflict/,
  );
});
