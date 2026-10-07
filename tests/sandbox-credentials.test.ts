import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { runGrantedSandbox, parseSandboxCredentialGrants } from '../src/sandbox/credentials.js';
import { createTask, changeTask } from '../src/tasks/domain.js';
import type { SandboxInput } from '../src/sandbox/domain.js';
import { createAgent } from '../src/agents/domain.js';

test('Sandbox credential grants bind current Task owner and reject changes during lookup before invoking Docker', async () => {
  const grants = parseSandboxCredentialGrants([
    {
      agentId: 'worker',
      taskId: 'task',
      environmentVariable: 'SERVICE_TOKEN',
      reference: 'service:task',
      sourceEnvironmentVariable: 'PRIVATE_TASK_TOKEN',
    },
  ]);
  let task = changeTask(
    changeTask(
      createTask(
        { title: 'T', objective: 'O', kind: 'execution_task' },
        { id: 'task', createdAt: 'before' },
      ),
      { owner: 'worker' },
      'assigned',
    ),
    { status: 'running' },
    'running',
  );
  let agent = createAgent(
    { name: 'Worker', role: 'Code', runtime: 'codex', capabilities: ['can_run_shell'] },
    { id: 'worker', createdAt: 'before' },
  );
  const input = {
    code: 'console.log(7)',
    writable: false,
    files: [],
    timeoutMs: 1000,
    maxOutputBytes: 4096,
  };
  let lookups = 0,
    executions = 0;
  const deps = { tasks: { get: () => task }, agents: { list: () => [agent] } };
  const run = async (_input: SandboxInput, credentials: Readonly<Record<string, string>>) => {
    executions++;
    assert.deepEqual(credentials, { SERVICE_TOKEN: 'synthetic-secret-703' });
    return 7;
  };
  assert.equal(
    await runGrantedSandbox(
      deps,
      {
        getSecret: () => {
          lookups++;
          return 'synthetic-secret-703';
        },
      },
      grants,
      'task',
      input,
      run,
    ),
    7,
  );
  agent = { ...agent, capabilities: [] };
  await assert.rejects(
    runGrantedSandbox(
      deps,
      {
        getSecret: () => {
          lookups++;
          return 'unexpected';
        },
      },
      grants,
      'task',
      input,
      run,
    ),
    /can_run_shell/,
  );
  assert.equal(lookups, 1);
  assert.equal(executions, 1);
  agent = { ...agent, capabilities: ['can_run_shell'] };
  await assert.rejects(
    runGrantedSandbox(
      deps,
      {
        getSecret: () => {
          task = changeTask(task, { status: 'failed' }, 'failed');
          return 'synthetic-secret-703';
        },
      },
      grants,
      'task',
      input,
      run,
    ),
    /running|version/,
  );
  assert.equal(executions, 1);
  assert.throws(
    () => parseSandboxCredentialGrants([{ ...grants[0], environmentVariable: 'PATH' }]),
    /credential/,
  );
});
