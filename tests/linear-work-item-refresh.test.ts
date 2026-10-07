import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { createTask, changeTask } from '../src/tasks/domain.js';
import type { Task } from '../src/tasks/domain.js';
import { refreshLinearWorkItem } from '../src/linear/import.js';
const id = '11111111-1111-4111-8111-111111111111';
const issue = {
  provider: 'linear' as const,
  id,
  identifier: 'ORG-1',
  title: 'Remote',
  description: 'Updated',
  url: 'https://linear.app/example/issue/ORG-1/example',
};
const initial = {
  ...createTask(
    { title: 'Local', objective: 'Old', labels: ['keep'] },
    { id: 'linear:issue:' + id, createdAt: '2026-10-06T00:00:00Z' },
  ),
  externalRef: issue.url,
};
test('explicit Linear refresh preserves internal state, replaces source fields and rejects races including unchanged result', async () => {
  let current: Task = initial;
  let reads = 0,
    writes = 0;
  const provider = {
    get: () => current,
    update: (
      taskId: string,
      patch: Parameters<typeof changeTask>[1],
      at: string,
      expected?: number,
    ) => {
      assert.equal(taskId, initial.id);
      assert.equal(current.version, expected);
      writes++;
      current = changeTask(current, patch, at);
      return current;
    },
  };
  const read = async () => {
    reads++;
    return issue;
  };
  const result = await refreshLinearWorkItem(provider, read, initial.id, 0, '2026-10-06T00:01:00Z');
  assert.equal(result.title, 'Remote');
  assert.equal(result.objective, 'Linear source: ' + issue.url + '\n\nUpdated');
  assert.deepEqual(result.labels, ['keep']);
  assert.equal(result.status, 'pending');
  assert.equal(writes, 1);
  await refreshLinearWorkItem(provider, read, initial.id, 1, '2026-10-06T00:02:00Z');
  assert.equal(writes, 1);
  await assert.rejects(
    refreshLinearWorkItem(provider, read, initial.id, 0, '2026-10-06T00:02:00Z'),
    /version/i,
  );
  assert.equal(reads, 2);
  await assert.rejects(
    refreshLinearWorkItem(
      provider,
      async () => {
        current = changeTask(current, { priority: 2 }, '2026-10-06T00:03:00Z');
        return issue;
      },
      initial.id,
      1,
      '2026-10-06T00:04:00Z',
    ),
    /version/i,
  );
  assert.equal(writes, 1);
  await assert.rejects(
    refreshLinearWorkItem(
      provider,
      async () => ({ ...issue, id: '22222222-2222-4222-8222-222222222222' }),
      initial.id,
      2,
      '2026-10-06T00:04:00Z',
    ),
    /identity/i,
  );
  await assert.rejects(
    refreshLinearWorkItem(
      provider,
      async () => ({ ...issue, url: 'https://linear.app/other/issue/ORG-1/changed' }),
      initial.id,
      2,
      '2026-10-06T00:04:00Z',
    ),
    /identity/i,
  );
  await assert.rejects(
    refreshLinearWorkItem(
      provider,
      async () => {
        throw Error('read failed');
      },
      initial.id,
      2,
      '2026-10-06T00:04:00Z',
    ),
    /read failed/,
  );
  assert.equal(writes, 1);
  await assert.rejects(
    refreshLinearWorkItem(
      { ...provider, get: () => ({ ...current, kind: 'execution_task' }) },
      read,
      initial.id,
      2,
      '2026-10-06T00:04:00Z',
    ),
    /WorkItem/,
  );
  assert.equal(reads, 2);
});
test('Linear refresh accepts same-Issue slug changes and retains the original source reference', async () => {
  let current = initial;
  const result = await refreshLinearWorkItem(
    {
      get: () => current,
      update: (_id, patch, at, version) => {
        assert.equal(version, 0);
        current = { ...changeTask(current, patch, at), externalRef: initial.externalRef };
        return current;
      },
    },
    async () => ({ ...issue, url: issue.url + '-renamed' }),
    initial.id,
    0,
    'later',
  );
  assert.equal(result.title, 'Remote');
  assert.equal(result.externalRef, initial.externalRef);
  assert.equal(result.objective, 'Linear source: ' + issue.url + '-renamed\n\nUpdated');
});
