import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { createTask, changeTask } from '../src/tasks/domain.js';
import { createAgent } from '../src/agents/domain.js';
import { runSandboxTask } from '../src/sandbox/service.js';
test('Sandbox Task stages successful stdout for review and never executes a denied capability', async () => {
  let task = changeTask(
    createTask(
      { title: 'Code', objective: '7', kind: 'execution_task' },
      { id: 'task', createdAt: 'before' },
    ),
    { owner: 'worker' },
    'assigned',
  );
  const states: string[] = [];
  const provider = {
    get: () => task,
    update: (
      _id: string,
      patch: { status?: 'running' | 'failed' },
      at: string,
      version?: number,
    ) => {
      assert.equal(version, task.version);
      task = changeTask(task, patch, at);
      states.push(task.status);
      return task;
    },
    stageExecutionResult: (_id: string, artifact: { uri: string }, version: number) => {
      assert.equal(version, task.version);
      assert.equal(artifact.uri, 'org://artifacts/blob');
      task = changeTask(task, { status: 'waiting_approval' }, 'result');
      states.push(task.status);
      return task;
    },
  };
  const agent = createAgent(
    { name: 'worker', role: 'Code', runtime: 'codex', capabilities: ['can_run_shell'] },
    { id: 'worker', createdAt: 'before' },
  );
  let calls = 0;
  const input = {
    code: 'console.log(7)',
    writable: false,
    files: [],
    timeoutMs: 1000,
    maxOutputBytes: 4096,
  };
  await assert.rejects(
    runSandboxTask(
      provider,
      { ...agent, capabilities: [] },
      async () => {
        calls++;
        throw new Error('unexpected');
      },
      async () => '',
      input,
      'task',
      () => 'now',
      () => 'artifact',
    ),
    /can_run_shell/,
  );
  assert.equal(calls, 0);
  assert.deepEqual(states, []);
  const result = await runSandboxTask(
    provider,
    agent,
    async () => {
      calls++;
      return { reason: 'exited', exitCode: 0, stdout: '7\n', stderr: '' };
    },
    async (bytes) => {
      assert.equal(Buffer.from(bytes).toString(), '7\n');
      return 'org://artifacts/blob';
    },
    input,
    'task',
    () => 'now',
    () => 'artifact',
  );
  assert.equal(result.status, 'waiting_approval');
  assert.deepEqual(states, ['running', 'waiting_approval']);
  assert.equal(calls, 1);
});
