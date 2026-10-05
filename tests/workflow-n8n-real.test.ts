import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { N8nWorkflowRuntime } from '../src/workflows/n8n.js';
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
const realTest = process.env.ORG_N8N_TEST_CONFIG ? test : test.skip;
realTest(
  'native n8n reference workflows return verified execution IDs, success and cancellation status',
  async () => {
    const path = process.env.ORG_N8N_TEST_CONFIG;
    assert.ok(path);
    const config: unknown = await Bun.file(path).json();
    assert.ok(
      record(config) &&
        typeof config.baseUrl === 'string' &&
        typeof config.apiKey === 'string' &&
        Array.isArray(config.workflows),
    );
    const workflows = config.workflows.map((workflow: unknown) => {
      assert.ok(
        record(workflow) && typeof workflow.id === 'string' && typeof workflow.path === 'string',
      );
      return { id: workflow.id, path: workflow.path };
    });
    const check = workflows.find((w) => w.path === 'org-kernel-check');
    const wait = workflows.find((w) => w.path === 'org-kernel-wait');
    assert.ok(check && wait);
    const runtime = new N8nWorkflowRuntime(
      { baseUrl: config.baseUrl, apiKey: config.apiKey, workflows },
      (url, init) => fetch(url, init),
    );
    const successful = await runtime.invoke(check.id, { marker: 'LOCAL_ONLY' });
    const deadline = Date.now() + 5000;
    while ((await runtime.status(successful)).status !== 'success') {
      assert.ok(Date.now() < deadline, 'reference execution must complete');
      await Bun.sleep(20);
    }
    const pending = await runtime.invoke(wait.id, { marker: 'CANCEL_ONLY' });
    assert.equal((await runtime.status(pending)).workflowId, wait.id);
    assert.equal(await runtime.cancel(pending), 'canceled');
    assert.equal((await runtime.status(pending)).status, 'canceled');
  },
  20000,
);
