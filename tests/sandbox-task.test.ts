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

test('Runtime Sandbox rechecks current owner, version, permission and Room before producing an artifact', async () => {
  const { produceTaskSandboxArtifact } = await import('../src/sandbox/service.js');
  const { createRoom, createMessage } = await import('../src/rooms/domain.js');
  const task = changeTask(
    changeTask(
      createTask(
        { title: 'build', objective: 'check', kind: 'execution_task' },
        { id: 't', createdAt: '0' },
      ),
      { owner: 'a' },
      '1',
    ),
    { status: 'running' },
    '2',
  );
  const agent = createAgent(
    { name: 'worker', role: 'build', runtime: 'codex', capabilities: ['can_run_shell'] },
    { id: 'a', createdAt: '0' },
  );
  const room = createRoom(
    { title: 'task', type: 'task', taskId: 't', participants: [{ kind: 'agent', id: 'a' }] },
    { id: 'r', createdAt: '0' },
  );
  const message = createMessage(
    room,
    {
      sender: { kind: 'agent', id: 'a' },
      content: JSON.stringify({ version: 1, tool: 'sandbox', code: 'console.log(7)' }),
    },
    { id: 'm', createdAt: '3' },
  );
  let current = task;
  let owner = agent;
  let activeRoom = room;
  let calls = 0;
  const run = () =>
    produceTaskSandboxArtifact(
      { get: () => current },
      { list: () => [owner] },
      { get: () => activeRoom },
      task,
      message,
      { writable: false, files: [], timeoutMs: 1000, maxOutputBytes: 4096 },
      async () => {
        calls++;
        return { reason: 'exited', exitCode: 0, stdout: '7\n', stderr: '' };
      },
      async (bytes) => {
        assert.deepEqual(JSON.parse(Buffer.from(bytes).toString()), {
          proposalRef: 'org://rooms/r/messages/m',
          stdout: '7\n',
          files: [],
        });
        return 'org://artifacts/proof';
      },
      () => '4',
      () => 'artifact',
    );
  assert.equal((await run()).uri, 'org://artifacts/proof');
  current = changeTask(task, { status: 'blocked' }, '3');
  await assert.rejects(run(), /current running/);
  current = task;
  owner = { ...agent, capabilities: [] };
  await assert.rejects(run(), /can_run_shell/);
  owner = agent;
  activeRoom = { ...room, archivedAt: '3' };
  await assert.rejects(run(), /active Task Room/);
  assert.equal(calls, 1);
});
