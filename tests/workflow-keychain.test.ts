import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { configuredWorkflowRuntime } from '../src/workflows/cli.js';
test('Workflow Keychain configuration swaps SecretStore by explicit host and Agent grants before native credential lookup', async () => {
  const home = mkdtempSync('/tmp/org-workflow-keychain-'),
    path = home + '/config.json',
    location = { path: '/private/tmp/proof.keychain-db', service: 'org-proof', account: 'host' };
  const scope = {
    agentId: 'agent-a',
    workflowIds: ['flow'],
    apiKeyKeychain: { ...location, account: 'agent-a' },
    effect: 'read_only',
  };
  const config = {
    baseUrl: 'http://127.0.0.1:1',
    apiKeyKeychain: location,
    workflows: [{ id: 'flow', path: 'check' }],
    agentScopes: [scope],
  };
  let reads = 0;
  const secrets = {
    getSecret: () => {
      reads++;
      return 'fixture-key';
    },
  };
  try {
    writeFileSync(path, JSON.stringify(config));
    const configured = await configuredWorkflowRuntime(path, secrets);
    assert.equal(reads, 1);
    assert.throws(() => configured.agentRuntime('agent-b', 'flow'), /scope denied/);
    assert.equal(reads, 1);
    assert.ok(configured.agentRuntime('agent-a', 'flow'));
    assert.equal(reads, 2);
    for (const bad of [
      { ...config, apiKeyEnv: 'ORG_HOST_KEY' },
      { ...config, apiKeyKeychain: { ...location, password: 'PRIVATE_SECRET' } },
      { ...config, agentScopes: [{ ...scope, apiKeyKeychain: { ...location, path: 'relative' } }] },
      { ...config, agentScopes: [{ ...scope, apiKeyEnv: 'ORG_AGENT_KEY' }] },
    ]) {
      writeFileSync(path, JSON.stringify(bad));
      const readCountBefore: number = reads;
      await assert.rejects(
        configuredWorkflowRuntime(path, secrets),
        /secret|credential|config|grant/i,
      );
      assert.equal(reads, readCountBefore);
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
