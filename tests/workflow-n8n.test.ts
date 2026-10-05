import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { N8nWorkflowRuntime } from '../src/workflows/n8n.js';
test('n8n invoke uses a host allowlist, status verifies Workflow and cancel stops only a verified execution', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const responses: unknown[] = [
    { executionId: '123' },
    { id: '123', workflowId: 'build', status: 'running' },
    { id: '123', workflowId: 'build', status: 'running' },
    { id: '123', workflowId: 'build', status: 'running' },
    { status: 'canceled' },
  ];
  const runtime = new N8nWorkflowRuntime(
    {
      baseUrl: 'http://127.0.0.1:5678',
      apiKey: 'fixture-key',
      workflows: [{ id: 'build', path: 'org-build' }],
    },
    async (url, init) => {
      calls.push({ url, init });
      return Response.json(responses.shift());
    },
  );
  assert.equal(await runtime.invoke('build', { issue: 7 }), '123');
  assert.deepEqual(await runtime.status('123'), {
    id: '123',
    workflowId: 'build',
    status: 'running',
  });
  assert.equal(await runtime.cancel('123'), 'canceled');
  assert.deepEqual(
    calls.map((c) => [c.url, c.init.method]),
    [
      ['http://127.0.0.1:5678/webhook/org-build', 'POST'],
      ['http://127.0.0.1:5678/api/v1/executions/123?includeData=false', 'GET'],
      ['http://127.0.0.1:5678/api/v1/executions/123?includeData=false', 'GET'],
      ['http://127.0.0.1:5678/api/v1/executions/123?includeData=false', 'GET'],
      ['http://127.0.0.1:5678/api/v1/executions/123/stop', 'POST'],
    ],
  );
  assert.equal(new Headers(calls[0]?.init.headers).get('X-N8N-API-KEY'), null);
  assert.equal(new Headers(calls[1]?.init.headers).get('X-N8N-API-KEY'), 'fixture-key');
  assert.ok(calls.every((c) => c.init.redirect === 'error' && c.init.signal));
  await assert.rejects(runtime.invoke('foreign', {}));
  await assert.rejects(runtime.status('../secret'));
  assert.equal(calls.length, 5);
});

test('n8n rejects redirect and malformed or foreign results without retry or cancellation', async () => {
  let calls = 0;
  let value: unknown = { id: '12', workflowId: 'foreign', status: 'running' };
  const runtime = new N8nWorkflowRuntime(
    {
      baseUrl: 'https://n8n.example',
      apiKey: 'fixture-key',
      workflows: [{ id: 'build', path: 'build' }],
    },
    async () => {
      calls++;
      return Response.json(value);
    },
  );
  await assert.rejects(runtime.cancel('12'), /Workflow/);
  assert.equal(calls, 1);
  value = { executionId: '../secret' };
  await assert.rejects(runtime.invoke('build', {}));
  assert.equal(calls, 2);
  value = { id: '13', workflowId: 'build', status: 'success' };
  await assert.rejects(runtime.status('12'));
  value = { id: '12', workflowId: 'build', status: 'made-up' };
  await assert.rejects(runtime.status('12'));
  for (const baseUrl of [
    'http://remote.example',
    'https://user:secret@n8n.example',
    'https://n8n.example?token=x',
  ])
    assert.throws(
      () =>
        new N8nWorkflowRuntime({ baseUrl, apiKey: 'fixture-key', workflows: [] }, async () =>
          Response.json({}),
        ),
    );
});

test('n8n bounds input and streaming response, redacts HTTP failures and never retries invocation', async () => {
  let calls = 0;
  let response = new Response('fixture-private-body', { status: 302 });
  const runtime = new N8nWorkflowRuntime(
    {
      baseUrl: 'https://n8n.example',
      apiKey: 'fixture-key',
      workflows: [{ id: 'build', path: 'build' }],
    },
    async () => {
      calls++;
      return response;
    },
  );
  await assert.rejects(runtime.invoke('build', { huge: 'x'.repeat(1048576) }), /input size/);
  assert.equal(calls, 0);
  await assert.rejects(
    runtime.invoke('build', {}),
    (error) => error instanceof Error && error.message === 'Workflow HTTP failure: 302',
  );
  assert.equal(calls, 1);
  response = new Response('x'.repeat(1048577));
  await assert.rejects(runtime.status('12'), /response size limit/);
  assert.equal(calls, 2);
});

test('malformed successful HTTP JSON never exposes response text in an exception', async () => {
  const marker = 'fixture_secret_api_key';
  const runtime = new N8nWorkflowRuntime(
    {
      baseUrl: 'https://n8n.example',
      apiKey: 'fixture-key',
      workflows: [{ id: 'build', path: 'build' }],
    },
    async () => new Response(marker),
  );
  await assert.rejects(
    runtime.status('12'),
    (error) =>
      error instanceof Error &&
      error.message === 'Invalid HTTP response JSON' &&
      !error.message.includes(marker),
  );
});

test('invalid Workflow host URL never exposes config text in its exception', () => {
  assert.throws(
    () =>
      new N8nWorkflowRuntime(
        { baseUrl: 'PRIVATE_HOST_CREDENTIAL', apiKey: 'fixture-key', workflows: [] },
        async () => Response.json({}),
      ),
    (error) => error instanceof Error && error.message === 'Invalid Workflow host URL',
  );
});
