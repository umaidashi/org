import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { configuredWorkflowRuntime } from '../src/workflows/cli.js';

test('Agent Workflow scope rejects unapproved targets before reading its own native-only credential', async () => {
  const home = mkdtempSync('/tmp/org-workflow-agent-scope-'),
    path = home + '/config.json';
  const reads: string[][] = [];
  try {
    writeFileSync(
      path,
      JSON.stringify({
        baseUrl: 'http://127.0.0.1:1',
        apiKeyEnv: 'ORG_HOST_KEY',
        workflows: [
          { id: 'flow', path: 'check' },
          { id: 'other', path: 'other' },
        ],
        agentScopes: [
          {
            agentId: 'agent-a',
            workflowIds: ['flow'],
            apiKeyEnv: 'ORG_AGENT_A_KEY',
            effect: 'read_only',
          },
        ],
      }),
    );
    const configured = await configuredWorkflowRuntime(path, {
      getSecret: (actor, reference) => {
        reads.push([actor, reference]);
        return 'fixture-key';
      },
    });
    assert.deepEqual(reads, [['host:workflow', 'n8n-api-key']]);
    assert.throws(() => configured.agentRuntime('agent-b', 'flow'), /Workflow scope denied/);
    assert.throws(() => configured.agentRuntime('agent-a', 'other'), /Workflow scope denied/);
    assert.equal(reads.length, 1);
    assert.ok(configured.agentRuntime('agent-a', 'flow'));
    assert.deepEqual(reads[1], ['agent-a', 'n8n-api-key']);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('Agent scope rejects write contracts, duplicate actors and unknown Workflow IDs before any credential lookup', async () => {
  const home = mkdtempSync('/tmp/org-workflow-scope-denial-'),
    path = home + '/config.json';
  let reads = 0;
  const scope = {
    agentId: 'agent-a',
    workflowIds: ['flow'],
    apiKeyEnv: 'ORG_AGENT_A_KEY',
    effect: 'read_only',
  };
  try {
    for (const agentScopes of [
      [{ ...scope, effect: 'write' }],
      [scope, scope],
      [{ ...scope, workflowIds: ['unknown'] }],
      [{ ...scope, agentId: 'host:workflow' }],
    ]) {
      writeFileSync(
        path,
        JSON.stringify({
          baseUrl: 'http://127.0.0.1:1',
          apiKeyEnv: 'ORG_HOST_KEY',
          workflows: [{ id: 'flow', path: 'check' }],
          agentScopes,
        }),
      );
      await assert.rejects(
        configuredWorkflowRuntime(path, {
          getSecret: () => {
            reads++;
            return 'fixture-key';
          },
        }),
        /Workflow scope/,
      );
    }
    assert.equal(reads, 0);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
