import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { configuredWorkflowRuntime } from '../src/workflows/cli.js';

test('Workflow config resolves only its host secret reference through the injected SecretStore', async () => {
  const home = mkdtempSync('/tmp/org-workflow-secrets-'),
    path = home + '/config.json';
  const calls: string[][] = [];
  const store = {
    getSecret: (actor: string, reference: string) => {
      calls.push([actor, reference]);
      return 'fixture-key';
    },
  };
  try {
    writeFileSync(
      path,
      JSON.stringify({
        baseUrl: 'http://127.0.0.1:1',
        apiKeyEnv: 'ORG_WORKFLOW_KEY',
        workflows: [{ id: 'flow', path: 'check' }],
      }),
    );
    const configured = await configuredWorkflowRuntime(path, store);
    assert.equal(configured.host, 'http://127.0.0.1:1');
    assert.deepEqual(calls, [['host:workflow', 'n8n-api-key']]);
    writeFileSync(
      path,
      JSON.stringify({ baseUrl: 'http://127.0.0.1:1', apiKeyEnv: 'BAD NAME', workflows: [] }),
    );
    await assert.rejects(configuredWorkflowRuntime(path, store), /Invalid Workflow host config/);
    assert.equal(calls.length, 1);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
