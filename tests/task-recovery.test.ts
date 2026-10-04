import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { createTask, changeTask } from '../src/tasks/domain.js';
import { recoverInterruptedExecutionTasks } from '../src/tasks/service.js';

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
