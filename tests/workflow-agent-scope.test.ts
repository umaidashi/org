import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { configuredWorkflowRuntime } from '../src/workflows/cli.js';

test('Workflow required capabilities reject invalid or read-only publish/spend contracts before credentials', async () => {
  const home = mkdtempSync('/tmp/org-workflow-capabilities-'),
    path = home + '/config.json';
  let reads = 0;
  const secrets = {
    getSecret: () => {
      reads++;
      return 'fixture-key';
    },
  };
  try {
    for (const requiredCapabilities of [
      null,
      'can_publish',
      ['unknown'],
      ['can_publish', 'can_publish'],
    ]) {
      writeFileSync(
        path,
        JSON.stringify({
          baseUrl: 'http://127.0.0.1:1',
          apiKeyEnv: 'ORG_KEY',
          workflows: [{ id: 'flow', path: 'check', effect: 'write', requiredCapabilities }],
        }),
      );
      await assert.rejects(configuredWorkflowRuntime(path, secrets), /capabilities/);
    }
    for (const capability of ['can_publish', 'can_spend']) {
      writeFileSync(
        path,
        JSON.stringify({
          baseUrl: 'http://127.0.0.1:1',
          apiKeyEnv: 'ORG_KEY',
          workflows: [{ id: 'flow', path: 'check', requiredCapabilities: [capability] }],
        }),
      );
      await assert.rejects(configuredWorkflowRuntime(path, secrets), /operation Approval/);
    }
    assert.equal(reads, 0);
    writeFileSync(
      path,
      JSON.stringify({
        baseUrl: 'http://127.0.0.1:1',
        apiKeyEnv: 'ORG_KEY',
        workflows: [
          {
            id: 'flow',
            path: 'check',
            effect: 'irreversible',
            requiredCapabilities: ['can_publish', 'can_spend'],
          },
        ],
      }),
    );
    const configured = await configuredWorkflowRuntime(path, secrets);
    assert.deepEqual(configured.workflows[0]?.requiredCapabilities, ['can_publish', 'can_spend']);
    assert.equal(reads, 1);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

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
    writeFileSync(
      path,
      JSON.stringify({
        baseUrl: 'http://127.0.0.1:1',
        apiKeyEnv: 'ORG_HOST_KEY',
        workflows: [{ id: 'flow', path: 'check', effect: 'write' }],
        agentScopes: [scope],
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
    assert.equal(reads, 0);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
