import { test } from 'bun:test';
import assert from 'node:assert/strict';
import {
  createTask,
  mergeWorkItemSnapshot,
  type Task,
  type WorkItem,
} from '../src/tasks/domain.js';
import type { TaskFilter } from '../src/tasks/port.js';
import { localTaskClient, runTaskClient } from '../src/tasks/client.js';
import { linearTaskClient } from '../src/linear/provider.js';
const uuid = '11111111-1111-4111-8111-111111111111',
  id = 'linear:issue:' + uuid;
const state = '22222222-2222-4222-8222-222222222222';
const mapping = { states: { [state]: 'pending' as const }, owners: {} };
const task: WorkItem = {
  ...createTask(
    { title: 'Existing', objective: 'Objective', priority: 2 },
    { id, createdAt: '2026-10-01T00:00:00.000Z' },
  ),
  kind: 'work_item',
  externalRef: 'https://linear.app/org/issue/ORG-1/existing',
};
const issue = {
  id: uuid,
  identifier: 'ORG-1',
  title: task.title,
  description: task.objective,
  url: task.externalRef,
  priority: 2,
  state: { id: state },
  assignee: null,
  labels: { nodes: [], pageInfo: { hasNextPage: false } },
  createdAt: task.createdAt,
  updatedAt: task.createdAt,
};
function store(initial: readonly Task[] = []) {
  const tasks = new Map(initial.map((value) => [value.id, value]));
  let writes = 0;
  return {
    tasks,
    writes: () => writes,
    create: (value: Task) => {
      if (tasks.has(value.id)) throw Error('duplicate');
      tasks.set(value.id, value);
      writes++;
    },
    get: (key: string) => {
      const value = tasks.get(key);
      if (!value) throw Error('missing');
      return value;
    },
    list: (filter: TaskFilter = {}) =>
      [...tasks.values()].filter(
        (value) =>
          (filter.kind === undefined || value.kind === filter.kind) &&
          (filter.status === undefined || value.status === filter.status) &&
          (filter.owner === undefined || value.owner === filter.owner),
      ),
    syncWorkItem: (snapshot: WorkItem, expected: number, at: string) => {
      const original = tasks.get(snapshot.id);
      assert.ok(original);
      if (original.version !== expected) throw Error('version');
      const result = mergeWorkItemSnapshot(original, snapshot, at);
      if (result !== original) {
        tasks.set(result.id, result);
        writes++;
      }
      return result;
    },
  };
}
test('same async Core consumer creates, gets and lists through both concrete adapters and propagates failures', async () => {
  for (const backend of ['local', 'linear']) {
    const saved = store();
    const provider =
      backend === 'local'
        ? localTaskClient(saved)
        : linearTaskClient(
            saved,
            async (_url, init) => {
              assert.ok(typeof init.body === 'string');
              const body: unknown = JSON.parse(init.body);
              assert.ok(
                body !== null &&
                  typeof body === 'object' &&
                  'query' in body &&
                  typeof body.query === 'string',
              );
              assert.ok(body.query.startsWith('query '));
              return Response.json({
                data: body.query.startsWith('query KernelCoreWorkItems(')
                  ? {
                      issues: { nodes: [issue], pageInfo: { hasNextPage: false, endCursor: null } },
                    }
                  : { issue },
              });
            },
            { getSecret: () => 'fixture-provider-key' },
            { list: () => [] },
            mapping,
            'ORG',
            () => 'later',
          );
    assert.deepEqual(await runTaskClient(provider, { kind: 'create', task }), task);
    assert.deepEqual(await runTaskClient(provider, { kind: 'get', id }), task);
    assert.deepEqual(
      await runTaskClient(provider, { kind: 'list', filter: { status: 'pending' } }),
      [task],
    );
    assert.deepEqual(
      await runTaskClient(provider, { kind: 'list', filter: { status: 'completed' } }),
      [],
    );
    assert.equal(saved.writes(), 1);
    await assert.rejects(() => runTaskClient(provider, { kind: 'create', task }));
  }
  await assert.rejects(
    () =>
      runTaskClient(
        localTaskClient({
          ...store(),
          get: () => {
            throw Error('read failed');
          },
        }),
        { kind: 'get', id },
      ),
    /read failed/,
  );
});
test('Core consumer awaits the injected async result before reporting success', async () => {
  let resolve: ((value: Task) => void) | undefined,
    completed = false;
  const response = new Promise<Task>((done) => {
    resolve = done;
  });
  const result = runTaskClient(
    { ...localTaskClient(store()), get: () => response },
    { kind: 'get', id },
  );
  const watched = result.then((value) => {
    completed = true;
    return value;
  });
  await Promise.resolve();
  assert.equal(completed, false);
  assert.ok(resolve);
  resolve(task);
  assert.deepEqual(await watched, task);
  assert.equal(completed, true);
});
test('Linear client refuses invalid Core IDs and stored scope before credentials and rejects acquisition races', async () => {
  const saved = store([task]);
  let lookups = 0,
    calls = 0;
  const secrets = {
    getSecret: () => {
      lookups++;
      return 'fixture-provider-key';
    },
  };
  const request = async () => {
    calls++;
    return Response.json({ data: { issue } });
  };
  assert.throws(() =>
    linearTaskClient(saved, request, secrets, { list: () => [] }, mapping, 'org', () => 'now'),
  );
  const provider = linearTaskClient(
    saved,
    request,
    secrets,
    { list: () => [] },
    mapping,
    'ORG',
    () => 'now',
  );
  await assert.rejects(() => provider.get('ORG-1'));
  saved.tasks.set(id, { ...task, externalRef: 'https://linear.app/org/issue/OTHER-1/existing' });
  await assert.rejects(() => provider.get(id), /scope/);
  assert.equal(lookups, 0);
  assert.equal(calls, 0);
  saved.tasks.set(id, task);
  const race = linearTaskClient(
    saved,
    async () => {
      saved.tasks.set(id, { ...task, version: 1 });
      return Response.json({ data: { issue } });
    },
    secrets,
    { list: () => [] },
    mapping,
    'ORG',
    () => 'now',
  );
  await assert.rejects(() => race.get(id), /version/);
  assert.equal(saved.writes(), 0);
});
test('Linear list validates all pages before reconciliation and rejects duplicate IDs, cursor cycles, partial fields and page overflow', async () => {
  for (const fault of [
    'duplicate',
    'cursor',
    'labels',
    'scope',
    'fragment',
    'query',
    'overflow',
    'race',
  ]) {
    const saved = store([task]);
    let page = 0;
    const provider = linearTaskClient(
      saved,
      async () => {
        page++;
        const next = fault === 'overflow' || fault === 'cursor' || page === 1;
        const index = fault === 'duplicate' ? 1 : page;
        const node = {
          ...issue,
          id: index === 1 ? uuid : `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
          identifier: `ORG-${index}`,
          url: `https://linear.app/org/issue/ORG-${index}/existing`,
          title: 'Changed',
          ...(page === 2 && (fault === 'fragment' || fault === 'query')
            ? {
                url: `https://linear.app/org/issue/ORG-${index}/existing${fault === 'fragment' ? '#fragment' : '?query=value'}`,
              }
            : {}),
          ...(fault === 'labels' && page === 2
            ? { labels: { nodes: [], pageInfo: { hasNextPage: true } } }
            : {}),
          ...(fault === 'scope' && page === 2
            ? { identifier: 'OTHER-2', url: 'https://linear.app/org/issue/OTHER-2/existing' }
            : {}),
        };
        if (fault === 'race' && page === 2) saved.tasks.set(id, { ...task, version: 1 });
        return Response.json({
          data: {
            issues: {
              nodes: [node],
              pageInfo: {
                hasNextPage: next,
                endCursor: next
                  ? fault === 'cursor' && page === 3
                    ? 'cursor-1'
                    : 'cursor-' + page
                  : null,
              },
            },
          },
        });
      },
      { getSecret: () => 'fixture-provider-key' },
      { list: () => [] },
      mapping,
      'ORG',
      () => 'now',
    );
    await assert.rejects(() => provider.list());
    assert.equal(saved.writes(), 0);
    assert.equal(saved.get(id).title, task.title);
    assert.equal(page, fault === 'overflow' ? 10 : fault === 'cursor' ? 3 : 2);
  }
});
