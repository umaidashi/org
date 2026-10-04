import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { createTask, changeTask, validateTaskReferences } from '../src/tasks/domain.js';
const identity = { id: 'one', createdAt: '2026-10-04T00:00:00.000Z' };
test('pure task decisions preserve identity and reject illegal state changes', () => {
  const task = createTask({ title: 'Test', objective: 'Done' }, identity);
  assert.equal(task.id, 'one');
  assert.equal(task.status, 'pending');
  assert.equal(task.createdAt, identity.createdAt);
  assert.throws(() => changeTask(task, { status: 'completed' }, identity.createdAt));
  assert.throws(() => createTask({ title: ' ', objective: 'Done' }, identity));
  assert.throws(() => createTask({ title: 'x', objective: ' ' }, identity));
});

test('task domain rejects invalid values and snapshots do not alias input arrays', () => {
  for (const input of [
    { title: 'x', objective: 'y', priority: -1 },
    { title: 'x', objective: 'y', priority: 1.5 },
    { title: 'x', objective: 'y', labels: [''] },
    { title: 'x', objective: 'y', dependencies: ['x', 'x'] },
  ])
    assert.throws(() => createTask(input, identity));
  const labels = ['review'];
  const task = createTask({ title: 'x', objective: 'y', labels }, identity);
  labels.push('changed');
  assert.deepEqual(task.labels, ['review']);
  assert.throws(() => changeTask(task, { owner: '' }, identity.createdAt));
  assert.throws(() => changeTask(task, { status: 'running' }, identity.createdAt));
  assert.throws(() => changeTask(task, { owner: 'agent', status: 'running' }, identity.createdAt));
  const assigned = changeTask(task, { owner: 'agent' }, identity.createdAt);
  assert.equal(assigned.status, 'assigned');
  assert.equal(task.status, 'pending');
  const running = changeTask(assigned, { status: 'running' }, identity.createdAt);
  const completed = changeTask(running, { status: 'completed' }, identity.createdAt);
  assert.throws(() => changeTask(completed, { title: 'edited' }, identity.createdAt));
});

test('pure graph validation rejects parent cycles, dependency cycles and unfinished prerequisites', () => {
  const first = createTask({ title: 'first', objective: 'done' }, identity);
  const second = createTask(
    { title: 'second', objective: 'done', dependencies: ['one'] },
    { ...identity, id: 'two' },
  );
  assert.doesNotThrow(() => validateTaskReferences(second, [first]));
  assert.throws(
    () => validateTaskReferences({ ...first, dependencies: ['two'] }, [first, second]),
    /cycle/,
  );
  assert.throws(
    () => validateTaskReferences({ ...first, parentId: 'two' }, [{ ...second, parentId: 'one' }]),
    /cycle/,
  );
  assert.throws(
    () => validateTaskReferences({ ...second, dependencies: ['missing'] }, [first]),
    /not found/,
  );
  assert.throws(
    () => validateTaskReferences({ ...second, owner: 'agent', status: 'running' }, [first]),
    /not completed/,
  );
});
