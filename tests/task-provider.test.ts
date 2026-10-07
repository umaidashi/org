import { test } from 'bun:test';
import assert from 'node:assert/strict';
import {
  createTask,
  changeTask,
  type TaskPatch,
  parseProviderTaskPatch,
  mergeWorkItemSnapshot,
  type Task,
  type WorkItem,
} from '../src/tasks/domain.js';
import type { TaskFilter } from '../src/tasks/port.js';
import { localTaskClient, runTaskClient } from '../src/tasks/client.js';
import { createApprovalDecision, type Approval } from '../src/approvals/domain.js';
import type { Event } from '../src/events/domain.js';
import { linearTaskClient, requestLinearCoreUpdateApproval } from '../src/linear/provider.js';
const uuid = '11111111-1111-4111-8111-111111111111',
  id = 'linear:issue:' + uuid;
const state = '22222222-2222-4222-8222-222222222222';
const readOnlyWrites = {
  approvals: {
    get: () => {
      throw Error('no approval');
    },
  },
  events: { list: () => [], publish: (event: import('../src/events/domain.js').Event) => event },
};
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
    update: (key: string, patch: TaskPatch, at: string, expected?: number) => {
      const value = tasks.get(key);
      assert.ok(value);
      if (value.version !== expected) throw Error('version');
      const result = changeTask(value, patch, at);
      tasks.set(key, result);
      writes++;
      return result;
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
    syncWorkItem: (
      snapshot: WorkItem,
      expected: number,
      at: string,
      relations: Pick<TaskPatch, 'parentId' | 'dependencies'> = {},
    ) => {
      const original = tasks.get(snapshot.id);
      assert.ok(original);
      if (original.version !== expected) throw Error('version');
      const result = mergeWorkItemSnapshot(original, snapshot, at, relations);
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
        ? localTaskClient(saved, () => 'later')
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
            readOnlyWrites,
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
        localTaskClient(
          {
            ...store(),
            get: () => {
              throw Error('read failed');
            },
          },
          () => 'later',
        ),
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
    { ...localTaskClient(store(), () => 'later'), get: () => response },
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
    linearTaskClient(
      saved,
      request,
      secrets,
      { list: () => [] },
      mapping,
      'org',
      () => 'now',
      readOnlyWrites,
    ),
  );
  const provider = linearTaskClient(
    saved,
    request,
    secrets,
    { list: () => [] },
    mapping,
    'ORG',
    () => 'now',
    readOnlyWrites,
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
    readOnlyWrites,
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
      readOnlyWrites,
    );
    await assert.rejects(() => provider.list());
    assert.equal(saved.writes(), 0);
    assert.equal(saved.get(id).title, task.title);
    assert.equal(page, fault === 'overflow' ? 10 : fault === 'cursor' ? 3 : 2);
  }
});

test('common update awaits Local CAS, validates closed patches and never treats external Approval as Local authorization', async () => {
  const original = createTask(
    { title: 'Local', objective: 'Local objective' },
    { id: 'local', createdAt: 'before' },
  );
  const saved = store([original]);
  const provider = localTaskClient(saved, () => 'after');
  const result = await runTaskClient(provider, {
    kind: 'update',
    id: 'local',
    patch: { title: 'Changed', owner: null },
    context: { actor: 'human', expectedVersion: 0 },
  });
  assert.ok('title' in result);
  assert.equal(result.title, 'Changed');
  assert.equal(result.status, 'pending');
  assert.equal(result.version, 1);
  assert.equal(result.updatedAt, 'after');
  for (const patch of [
    {},
    { title: '' },
    { owner: 1 },
    { priority: -1 },
    { labels: ['same', 'same'] },
    { dependencies: [null] },
    { externalRef: 'x' },
    { status: 'unknown' },
  ]) {
    await assert.rejects(
      async () =>
        await provider.update('local', parseProviderTaskPatch(patch), {
          actor: 'human',
          expectedVersion: 1,
        }),
    );
  }
  await assert.rejects(() =>
    provider.update('local', { title: 'No' }, { actor: 'human', expectedVersion: 0 }),
  );
  await assert.rejects(() =>
    provider.update('local', { title: 'No' }, { actor: '', expectedVersion: 1 }),
  );
  await assert.rejects(() =>
    provider.update(
      'local',
      { title: 'No' },
      { actor: 'human', expectedVersion: 1, approvalId: 'approval' },
    ),
  );
  assert.equal(saved.writes(), 1);
  assert.deepEqual(saved.get('local'), result);
});

test('Linear relation-only common update is Local CAS and rejects cycles without credentials or external claims', async () => {
  const parent = createTask(
    { title: 'Parent', objective: 'Parent' },
    { id: 'parent', createdAt: 'before' },
  );
  const saved = store([task, parent]);
  let calls = 0;
  const provider = linearTaskClient(
    saved,
    async () => {
      calls++;
      throw Error('unexpected HTTP');
    },
    {
      getSecret: () => {
        calls++;
        throw Error('unexpected key');
      },
    },
    { list: () => [] },
    mapping,
    'ORG',
    () => 'later',
    readOnlyWrites,
  );
  await assert.rejects(
    () => provider.update(id, { parentId: id }, { actor: 'human', expectedVersion: 0 }),
    /cycle|parent/i,
  );
  await assert.rejects(
    () =>
      provider.update(
        id,
        { parentId: 'parent' },
        { actor: 'human', expectedVersion: 0, approvalId: 'approval' },
      ),
    /Approval/,
  );
  const result = await runTaskClient(provider, {
    kind: 'update',
    id,
    patch: { parentId: 'parent', dependencies: [] },
    context: { actor: 'human', expectedVersion: 0 },
  });
  assert.ok('parentId' in result);
  assert.equal(result.parentId, 'parent');
  assert.equal(result.version, 1);
  assert.equal(calls, 0);
});

test('approved common Linear update preserves receipts across read/save/CAS failures and never resends during recovery', async () => {
  for (const fault of ['', 'read', 'save', 'race', 'projection']) {
    const saved = store([task]);
    let approval: Approval | undefined;
    const records: Event[] = [];
    let remote = issue,
      mutations = 0,
      reads = 0,
      failing = false;
    const request = async (_url: string, init: RequestInit) => {
      assert.ok(typeof init.body === 'string');
      const body: unknown = JSON.parse(init.body);
      assert.ok(
        body && typeof body === 'object' && 'query' in body && typeof body.query === 'string',
      );
      if (body.query.startsWith('mutation ')) {
        mutations++;
        remote = { ...remote, title: 'Changed' };
        return Response.json({ data: { issueUpdate: { success: true, issue: remote } } });
      }
      reads++;
      if (failing && body.query.startsWith('query KernelCoreWorkItem(')) {
        if (fault === 'read') throw Error('owned read fault');
        if (fault === 'race') saved.tasks.set(id, { ...task, version: 1 });
        if (fault === 'projection')
          return Response.json({ data: { issue: { ...remote, title: 'Other writer' } } });
      }
      return Response.json({ data: { issue: remote } });
    };
    const secrets = { getSecret: () => 'fixture-provider-key' };
    const agents = { list: () => [] };
    const writes = {
      approvals: {
        get: () => {
          assert.ok(approval);
          return approval;
        },
      },
      events: {
        list: () => records,
        publish: (event: Event) => {
          records.push(event);
          return event;
        },
      },
    };
    const requested = await requestLinearCoreUpdateApproval(
      saved,
      { requestOnce: (value) => value },
      request,
      secrets,
      agents,
      mapping,
      'ORG',
      { taskId: id, patch: { title: 'Changed' }, actor: 'human', expectedVersion: 0, key: 'core' },
      { id: 'approval', createdAt: 'before' },
    );
    approval = {
      request: requested,
      decision: createApprovalDecision(
        requested,
        { actor: { kind: 'human', id: 'reviewer' }, decision: 'approve', reason: 'verified' },
        'after',
      ),
    };
    const provider = linearTaskClient(
      {
        ...saved,
        syncWorkItem: (...args: Parameters<typeof saved.syncWorkItem>) => {
          if (failing && fault === 'save') throw Error('owned save fault');
          return saved.syncWorkItem(...args);
        },
      },
      request,
      secrets,
      agents,
      mapping,
      'ORG',
      () => 'after',
      writes,
    );
    const action = {
      kind: 'update' as const,
      id,
      patch: { title: 'Changed' },
      context: { actor: 'human', expectedVersion: 0, approvalId: requested.id },
    };
    failing = true;
    if (!fault) {
      const result = await runTaskClient(provider, action);
      assert.ok('title' in result);
      assert.equal(result.title, 'Changed');
      assert.equal(result.version, 1);
    } else {
      await assert.rejects(
        () => runTaskClient(provider, action),
        /confirmed by .*Core synchronization failed/,
      );
      assert.equal(saved.writes(), 0);
    }
    assert.equal(mutations, 1);
    assert.equal(records.filter((event) => event.type === 'linear.update.updated').length, 1);
    const calls = reads;
    await assert.rejects(() => runTaskClient(provider, action));
    assert.equal(mutations, 1);
    assert.equal(reads, calls);
    failing = false;
    const result = await provider.get(id);
    assert.ok('title' in result);
    assert.equal(result.title, 'Changed');
    assert.equal(mutations, 1);
  }
});
