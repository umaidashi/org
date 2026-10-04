import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { createTask, changeTask } from '../src/tasks/domain.js';
import { assignTask } from '../src/tasks/service.js';

test('assignment rejects missing Agent before invoking the injected writer', () => {
  const at = '2026-10-04T00:00:00.000Z';
  const task = createTask({ title: 'x', objective: 'y' }, { id: 'task', createdAt: at });
  let writes = 0;
  const writer = {
    update: () => {
      writes += 1;
      return task;
    },
  };
  assert.throws(() => assignTask(writer, { list: () => [] }, 'task', 'missing', at), /Agent/);
  assert.equal(writes, 0);
});

test('assignment forwards identity and time through injected ports and propagates persistence failure', () => {
  const at = '2026-10-04T00:00:00.000Z';
  const task = createTask({ title: 'x', objective: 'y' }, { id: 'task', createdAt: at });
  const reader = {
    list: () => [{ id: 'agent', name: 'dev', role: 'dev', runtime: 'codex', createdAt: at }],
  };
  const writer = {
    update: (id: string, patch: { owner?: string }, timestamp: string) => {
      assert.equal(id, 'task');
      assert.deepEqual(patch, { owner: 'agent' });
      assert.equal(timestamp, at);
      return changeTask(task, patch, timestamp);
    },
  };
  assert.equal(assignTask(writer, reader, 'task', 'agent', at).status, 'assigned');
  assert.throws(
    () =>
      assignTask(
        {
          update: () => {
            throw new Error('storage unavailable');
          },
        },
        reader,
        'task',
        'agent',
        at,
      ),
    /storage unavailable/,
  );
});
