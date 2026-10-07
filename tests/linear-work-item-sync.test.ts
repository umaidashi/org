import { test } from 'bun:test';
import assert from 'node:assert/strict';
import {
  createTask,
  changeTask,
  mergeWorkItemSnapshot,
  validateTaskReferences,
} from '../src/tasks/domain.js';
import type { Task, WorkItem } from '../src/tasks/domain.js';
import { syncLinearWorkItem } from '../src/linear/import.js';
const id = 'linear:issue:11111111-1111-4111-8111-111111111111';
const initial: WorkItem = {
  ...createTask({ title: 'Local', objective: 'Old' }, { id, createdAt: 'local-created' }),
  kind: 'work_item',
  externalRef: 'https://linear.app/org/issue/ORG-1/existing',
};
const snapshot: WorkItem = {
  ...initial,
  title: 'Remote',
  objective: 'Remote objective',
  status: 'running',
  owner: null,
  priority: 2,
  labels: ['bug'],
  createdAt: 'remote-created',
  updatedAt: 'remote-updated',
};
test('external WorkItem merge preserves Local fields and accepts remote reopening without weakening internal transitions', () => {
  const current: Task = {
    ...initial,
    status: 'completed',
    version: 4,
    parentId: 'parent',
    dependencies: ['dep'],
    inputArtifacts: ['in'],
    outputArtifacts: ['out'],
  };
  const result = mergeWorkItemSnapshot(current, snapshot, 'commit-time');
  assert.deepEqual(result, {
    ...current,
    title: snapshot.title,
    objective: snapshot.objective,
    status: 'running',
    owner: null,
    priority: 2,
    labels: ['bug'],
    version: 5,
    updatedAt: 'commit-time',
  });
  assert.equal(mergeWorkItemSnapshot(result, snapshot, 'later'), result);
  assert.equal(current.status, 'completed');
  const labels = ['first'];
  const copied = mergeWorkItemSnapshot(initial, { ...snapshot, labels }, 'now');
  labels.push('changed');
  assert.deepEqual(copied.labels, ['first']);
  for (const bad of [
    { ...snapshot, id: 'other' },
    { ...snapshot, externalRef: null },
    { ...snapshot, labels: ['x', 'x'] },
    { ...snapshot, priority: -1 },
    { ...snapshot, title: ' ' },
    { ...snapshot, owner: '' },
  ])
    assert.throws(() => mergeWorkItemSnapshot(initial, bad, 'now'));
  assert.throws(() =>
    mergeWorkItemSnapshot({ ...initial, kind: 'execution_task' }, snapshot, 'now'),
  );
  assert.throws(() =>
    mergeWorkItemSnapshot({ ...initial, version: Number.MAX_SAFE_INTEGER }, snapshot, 'now'),
  );
  const execution = createTask(
    { title: 'Internal', objective: 'Execute', kind: 'execution_task' },
    { id: 'execution', createdAt: 'now' },
  );
  assert.throws(() => changeTask(execution, { status: 'running' }, 'now'));
  assert.throws(() =>
    changeTask({ ...execution, owner: 'agent', status: 'completed' }, { status: 'running' }, 'now'),
  );
});
test('external snapshot status does not assert Local prerequisite completion while ExecutionTask still requires it', () => {
  const dependency = createTask(
    { title: 'Dependency', objective: 'Pending' },
    { id: 'dep', createdAt: 'now' },
  );
  const remote = { ...snapshot, dependencies: ['dep'] };
  assert.doesNotThrow(() => validateTaskReferences(remote, [dependency]));
  assert.throws(
    () =>
      validateTaskReferences({ ...remote, kind: 'execution_task', owner: 'agent' }, [dependency]),
    /not completed/,
  );
  assert.throws(
    () => validateTaskReferences({ ...remote, externalRef: null }, [dependency]),
    /not completed/,
  );
  assert.throws(
    () => validateTaskReferences({ ...remote, dependencies: ['missing'] }, [dependency]),
    /not found/,
  );
  assert.throws(
    () => validateTaskReferences({ ...remote, dependencies: [id] }, [dependency]),
    /cycle/,
  );
});
test('Linear Core sync refuses wrong identity, versions and authority before write and rejects changes during read', async () => {
  let current: Task = initial,
    reads = 0,
    writes = 0,
    times = 0;
  const provider = {
    get: () => current,
    syncWorkItem: (value: WorkItem, expected: number, at: string) => {
      assert.equal(expected, current.version);
      writes++;
      return (current = mergeWorkItemSnapshot(current, value, at));
    },
  };
  const read = async () => {
    reads++;
    return snapshot;
  };
  const now = () => {
    times++;
    return 'commit-time';
  };
  for (const version of [-1, 1.5, 1])
    await assert.rejects(() => syncLinearWorkItem(provider, read, id, version, now), /version/);
  for (const changed of [
    { ...initial, kind: 'execution_task' as const },
    { ...initial, externalRef: null },
    { ...initial, externalRef: 'https://evil.example/issue/ORG-1/existing' },
  ]) {
    current = changed;
    await assert.rejects(() => syncLinearWorkItem(provider, read, id, 0, now));
  }
  assert.equal(reads, 0);
  current = initial;
  for (const value of [
    { ...snapshot, id: 'other' },
    { ...snapshot, externalRef: 'https://linear.app/other/issue/ORG-1/existing' },
  ])
    await assert.rejects(() => syncLinearWorkItem(provider, async () => value, id, 0, now));
  await assert.rejects(
    () =>
      syncLinearWorkItem(
        provider,
        async () => {
          throw Error('read failed');
        },
        id,
        0,
        now,
      ),
    /read failed/,
  );
  await assert.rejects(
    () =>
      syncLinearWorkItem(
        provider,
        async () => {
          current = { ...initial, version: 1 };
          return snapshot;
        },
        id,
        0,
        now,
      ),
    /version/,
  );
  assert.equal(writes, 0);
  assert.equal(times, 0);
  current = initial;
  const result = await syncLinearWorkItem(
    provider,
    async () => ({ ...snapshot, externalRef: snapshot.externalRef + '-renamed' }),
    id,
    0,
    now,
  );
  assert.equal(result.status, 'running');
  assert.equal(result.externalRef, initial.externalRef);
  assert.equal(result.updatedAt, 'commit-time');
  assert.equal(writes, 1);
  assert.equal(times, 1);
  await assert.rejects(
    () =>
      syncLinearWorkItem(
        {
          ...provider,
          syncWorkItem: () => {
            throw Error('write failed');
          },
        },
        read,
        id,
        1,
        now,
      ),
    /write failed/,
  );
});
