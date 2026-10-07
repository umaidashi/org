import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { createAgent } from '../src/agents/domain.js';
import {
  linearCoreTaskPatch,
  parseLinearTaskMapping,
  readLinearCoreWorkItem,
} from '../src/linear/projection.js';
const id = '11111111-1111-4111-8111-111111111111';
const state = '22222222-2222-4222-8222-222222222222';
const user = '33333333-3333-4333-8333-333333333333';
const mapping = { states: { [state]: 'running' as const }, owners: { [user]: 'reader' } };
const agent = createAgent(
  { name: 'Reader', role: 'reader', runtime: 'claude' },
  { id: 'reader', createdAt: 'now' },
);
const issue = {
  id,
  identifier: 'ORG-1',
  title: 'Existing',
  description: null,
  url: 'https://linear.app/org/issue/ORG-1/existing',
  priority: 0,
  state: { id: state },
  assignee: { id: user },
  labels: { nodes: [], pageInfo: { hasNextPage: false } },
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-07T00:00:00.000Z',
};
test('Core Linear projection rejects malformed mapping and incomplete or unknown remote fields without inventing authority', async () => {
  let lookups = 0,
    calls = 0;
  const secrets = {
    getSecret: () => {
      lookups++;
      return 'fixture-core-key';
    },
  };
  const read = (value: unknown, agents = [agent]) =>
    readLinearCoreWorkItem(
      async () => {
        calls++;
        return Response.json({ data: { issue: value } });
      },
      secrets,
      { list: () => agents },
      mapping,
      id,
    );
  for (const bad of [
    null,
    { ...mapping, extra: true },
    { states: {}, owners: {} },
    { states: { [state]: 'unknown' }, owners: {} },
    { states: { bad: 'pending' }, owners: {} },
    { ...mapping, owners: { [user]: '' } },
  ])
    assert.throws(() => parseLinearTaskMapping(bad));
  await assert.rejects(() => read(issue, []));
  assert.equal(lookups, 0);
  assert.equal(calls, 0);
  for (const patch of [
    { id: user },
    { id: user, identifier: id, url: 'https://linear.app/org/issue/' + id + '/existing' },
    { state: { id: user } },
    { assignee: { id: state } },
    { priority: 5 },
    { labels: { nodes: [], pageInfo: { hasNextPage: true } } },
    { labels: { nodes: [{ id: state }], pageInfo: { hasNextPage: false } } },
    { createdAt: 'invalid' },
    { updatedAt: '2026-09-01T00:00:00.000Z' },
    { title: 'fixture-core-key' },
  ])
    await assert.rejects(() => read({ ...issue, ...patch }));
  const projected = await read(issue);
  assert.equal(projected.owner, agent.id);
  assert.equal(projected.status, 'running');
  assert.equal(projected.objective, issue.title);
  assert.equal(projected.externalRef, issue.url);
  let registered = [agent];
  await assert.rejects(
    () =>
      readLinearCoreWorkItem(
        async () => {
          registered = [];
          return Response.json({ data: { issue } });
        },
        secrets,
        { list: () => registered },
        mapping,
        id,
      ),
    /Agent/,
  );
});
test('Core Linear projection accepts long identifier requests independently of UUID string length', async () => {
  const identifier = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ-123456789';
  assert.equal(identifier.length, 36);
  const result = await readLinearCoreWorkItem(
    async () =>
      Response.json({
        data: {
          issue: {
            ...issue,
            identifier,
            url: 'https://linear.app/org/issue/' + identifier + '/existing',
          },
        },
      }),
    { getSecret: () => 'fixture-core-key' },
    { list: () => [agent] },
    mapping,
    identifier,
  );
  assert.equal(result.id, 'linear:issue:' + id);
});

test('Core outbound mapping requires explicit unique registered targets and keeps Local relations out of Linear fields', () => {
  const agents = { list: () => [agent] };
  const configured = { ...mapping, labels: { Reviewed: state } };
  assert.deepEqual(
    linearCoreTaskPatch(agents, configured, {
      title: 'Changed',
      objective: 'Objective',
      status: 'running',
      owner: 'reader',
      priority: 0,
      labels: ['Reviewed'],
      parentId: null,
      dependencies: [],
    }),
    {
      stateId: state,
      assigneeId: user,
      labelIds: [state],
      priority: 0,
      title: 'Changed',
      description: 'Objective',
    },
  );
  assert.deepEqual(linearCoreTaskPatch(agents, configured, { owner: null, labels: [] }), {
    assigneeId: null,
    labelIds: [],
  });
  assert.deepEqual(linearCoreTaskPatch(agents, configured, { parentId: null }), {});
  for (const patch of [
    { status: 'completed' },
    { owner: 'missing' },
    { labels: ['unknown'] },
    { priority: 5 },
    { stateId: state },
  ])
    assert.throws(() => linearCoreTaskPatch(agents, configured, patch));
  assert.throws(
    () =>
      linearCoreTaskPatch(
        agents,
        { ...configured, states: { [state]: 'running', [user]: 'running' } },
        { status: 'running' },
      ),
    /ambiguous/,
  );
  assert.throws(
    () =>
      linearCoreTaskPatch(
        agents,
        { ...configured, owners: { [user]: 'reader', [state]: 'reader' } },
        { owner: 'reader' },
      ),
    /ambiguous/,
  );
  assert.throws(
    () => linearCoreTaskPatch({ list: () => [] }, configured, { title: 'Changed' }),
    /Agent/,
  );
  for (const labels of [null, [], { Reviewed: 1 }, { '': state }])
    assert.throws(() => parseLinearTaskMapping({ ...mapping, labels }));
});
