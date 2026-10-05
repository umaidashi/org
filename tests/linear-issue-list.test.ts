import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { listLinearIssues } from '../src/linear/read.js';
const issue = {
  id: '11111111-1111-4111-8111-111111111111',
  identifier: 'ORG-1',
  title: 'Read',
  description: null,
  url: 'https://linear.app/example/issue/ORG-1/read',
};
test('Linear list validates one scoped page, preserves cursor and rejects invalid and partial responses without another request', async () => {
  let value: unknown = {
      data: { issues: { nodes: [issue], pageInfo: { hasNextPage: true, endCursor: 'next' } } },
    },
    calls = 0,
    lookups = 0;
  const secrets = {
    getSecret: () => {
      lookups++;
      return 'fixture-list-key';
    },
  };
  const request = async (url: string, init: RequestInit) => {
    calls++;
    assert.equal(url, 'https://api.linear.app/graphql');
    assert.equal(init.redirect, 'error');
    assert.equal(new Headers(init.headers).get('Authorization'), 'fixture-list-key');
    assert.equal(init.method, 'POST');
    assert.equal(typeof init.body, 'string');
    if (typeof init.body !== 'string') throw new Error('Expected string request body');
    const body: unknown = JSON.parse(init.body);
    assert.ok(body !== null && typeof body === 'object' && 'variables' in body);
    assert.deepEqual(body.variables, { team: 'ORG', first: 1, after: null });
    return Response.json(value);
  };
  const page = await listLinearIssues(request, secrets, { team: 'ORG', limit: 1 });
  assert.equal(page.nodes.length, 1);
  assert.equal(page.nodes[0]?.identifier, 'ORG-1');
  assert.deepEqual(page.pageInfo, { hasNextPage: true, endCursor: 'next' });
  assert.equal(calls, 1);
  for (const input of [
    { team: 'org', limit: 1 },
    { team: 'ORG', limit: 0 },
    { team: 'ORG', limit: 51 },
    { team: 'ORG', limit: 1, after: '' },
    { team: 'ORG', limit: 1, after: 'x\n' },
    { team: 'ORG', limit: 1, after: 'x'.repeat(2049) },
  ])
    await assert.rejects(listLinearIssues(request, secrets, input));
  assert.equal(lookups, 1);
  for (const bad of [
    {
      errors: [{ message: 'fixture-list-key' }],
      data: { issues: { nodes: [issue], pageInfo: { hasNextPage: false, endCursor: null } } },
    },
    {
      data: {
        issues: { nodes: [issue, issue], pageInfo: { hasNextPage: false, endCursor: null } },
      },
    },
    {
      data: {
        issues: {
          nodes: [{ ...issue, identifier: 'OTHER-1' }],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      },
    },
    { data: { issues: { nodes: [issue], pageInfo: { hasNextPage: true, endCursor: null } } } },
    {
      data: {
        issues: {
          nodes: [{ ...issue, title: 'fixture-list-key' }],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      },
    },
  ]) {
    value = bad;
    await assert.rejects(listLinearIssues(request, secrets, { team: 'ORG', limit: 1 }));
  }
  value = { data: { issues: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } } };
  assert.equal(
    (await listLinearIssues(request, secrets, { team: 'ORG', limit: 1 })).nodes.length,
    0,
  );
  const nextRequest = async (_url: string, init: RequestInit) => {
    assert.ok(typeof init.body === 'string');
    const body: unknown = JSON.parse(init.body);
    assert.ok(body !== null && typeof body === 'object' && 'variables' in body);
    assert.deepEqual(body.variables, { team: 'ORG', first: 2, after: 'next' });
    return Response.json(value);
  };
  value = {
    data: {
      issues: { nodes: [issue, issue], pageInfo: { hasNextPage: false, endCursor: 'last' } },
    },
  };
  await assert.rejects(
    listLinearIssues(nextRequest, secrets, { team: 'ORG', limit: 2, after: 'next' }),
    /identity/,
  );
  value = {
    data: {
      issues: {
        nodes: [
          { ...issue, identifier: 'OTHER-1', url: 'https://linear.app/example/issue/OTHER-1/read' },
        ],
        pageInfo: { hasNextPage: false, endCursor: 'last' },
      },
    },
  };
  await assert.rejects(
    listLinearIssues(nextRequest, secrets, { team: 'ORG', limit: 2, after: 'next' }),
    /scope/,
  );
  value = {
    data: { issues: { nodes: [issue], pageInfo: { hasNextPage: true, endCursor: 'next' } } },
  };
  await assert.rejects(
    listLinearIssues(nextRequest, secrets, { team: 'ORG', limit: 2, after: 'next' }),
    /page info/,
  );
  value = {
    data: { issues: { nodes: [issue], pageInfo: { hasNextPage: false, endCursor: 'last' } } },
  };
  assert.deepEqual(
    (await listLinearIssues(nextRequest, secrets, { team: 'ORG', limit: 2, after: 'next' }))
      .pageInfo,
    { hasNextPage: false, endCursor: 'last' },
  );
});
