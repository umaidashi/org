import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { runExecutionTask } from '../src/tasks/execution.js';
import { createTask, changeTask } from '../src/tasks/domain.js';
import { createRoom, createMessage } from '../src/rooms/domain.js';
import { createSession } from '../src/sessions/domain.js';
test('ExecutionTask persists running before the runtime and stages its result for human review', async () => {
  let task = changeTask(
    createTask(
      { title: 'research', objective: 'Review options', kind: 'execution_task' },
      { id: 't', createdAt: 'now' },
    ),
    { owner: 'a' },
    'now',
  );
  const room = createRoom(
    {
      title: 'task',
      type: 'task',
      taskId: 't',
      participants: [
        { kind: 'human', id: 'h' },
        { kind: 'agent', id: 'a' },
      ],
    },
    { id: 'r', createdAt: 'now' },
  );
  const source = createMessage(
    room,
    { sender: { kind: 'human', id: 'h' }, content: 'question' },
    { id: 'source', createdAt: 'now' },
  );
  const reply = createMessage(
    room,
    { sender: { kind: 'agent', id: 'a' }, content: 'result', replyTo: 'source' },
    { id: 'reply', createdAt: 'later' },
    source,
  );
  const session = createSession(
    { roomId: 'r', agentId: 'a', runtime: 'codex' },
    { id: 's', at: 'now' },
  );
  const provider = {
    get: () => task,
    update: (
      _id: string,
      patch: Parameters<typeof changeTask>[1],
      at: string,
      expected?: number,
    ) => {
      assert.equal(expected, task.version);
      task = changeTask(task, patch, at);
      return task;
    },
    stageExecutionResult: (
      _id: string,
      artifact: { id: string; uri: string; createdAt: string },
      expected: number,
    ) => {
      assert.equal(expected, task.version);
      assert.equal(task.status, 'running');
      assert.equal(artifact.id, 'reply');
      assert.ok(artifact.uri.includes('reply'));
      task = changeTask(task, { status: 'waiting_approval' }, artifact.createdAt);
      return task;
    },
  };
  let calls = 0;
  const send = async (_sessionId: string, _messageId: string, instruction: string) => {
    calls++;
    assert.equal(task.status, 'running');
    assert.ok(instruction.includes('Review options'));
    return reply;
  };
  const result = await runExecutionTask(
    provider,
    { get: () => session },
    { get: () => room, messages: () => [source] },
    send,
    { taskId: 't', sessionId: 's', messageId: 'source' },
    () => 'later',
  );
  assert.equal(result.task.status, 'waiting_approval');
  assert.equal(result.reply.id, 'reply');
  assert.equal(calls, 1);
  await assert.rejects(
    runExecutionTask(
      provider,
      { get: () => session },
      { get: () => room, messages: () => [source] },
      send,
      { taskId: 't', sessionId: 's', messageId: 'source' },
      () => 'later',
    ),
  );
  assert.equal(calls, 1);
});

test('ExecutionTask rejects reused Room replies before running and records failure without overwriting concurrent decisions', async () => {
  const initial = changeTask(
    createTask(
      { title: 'research', objective: 'Review options', kind: 'execution_task' },
      { id: 't', createdAt: 'now' },
    ),
    { owner: 'a' },
    'now',
  );
  let task = initial;
  const room = createRoom(
    {
      title: 'task',
      type: 'task',
      taskId: 't',
      participants: [
        { kind: 'human', id: 'h' },
        { kind: 'agent', id: 'a' },
      ],
    },
    { id: 'r', createdAt: 'now' },
  );
  const source = createMessage(
    room,
    { sender: { kind: 'human', id: 'h' }, content: 'question' },
    { id: 'source', createdAt: 'now' },
  );
  const oldReply = createMessage(
    room,
    {
      sender: { kind: 'agent', id: 'a' },
      content: 'old manual reply',
      replyTo: 'source',
      metadata: { sessionId: 's' },
    },
    { id: 'old', createdAt: 'now' },
    source,
  );
  const session = createSession(
    { roomId: 'r', agentId: 'a', runtime: 'codex' },
    { id: 's', at: 'now' },
  );
  const provider = {
    get: () => task,
    update: (
      _id: string,
      patch: Parameters<typeof changeTask>[1],
      at: string,
      expected?: number,
    ) => {
      if (expected !== task.version) throw new Error('Version conflict');
      task = changeTask(task, patch, at);
      return task;
    },
    stageExecutionResult: () => {
      throw new Error('Result must not be persisted');
    },
  };
  let calls = 0;
  const fail = async () => {
    calls++;
    throw new Error('runtime failure');
  };
  const input = { taskId: 't', sessionId: 's', messageId: 'source' };
  await assert.rejects(
    runExecutionTask(
      provider,
      { get: () => session },
      { get: () => room, messages: () => [source, oldReply] },
      fail,
      input,
      () => 'later',
    ),
  );
  assert.equal(task.status, 'assigned');
  assert.equal(calls, 0);
  await assert.rejects(
    runExecutionTask(
      provider,
      { get: () => session },
      { get: () => room, messages: () => [source] },
      fail,
      input,
      () => 'later',
    ),
  );
  assert.equal(task.status, 'failed');
  task = initial;
  await assert.rejects(
    runExecutionTask(
      provider,
      { get: () => session },
      { get: () => room, messages: () => [source] },
      async () => {
        task = changeTask(task, { status: 'blocked' }, 'later');
        throw new Error('runtime failure');
      },
      input,
      () => 'later',
    ),
    AggregateError,
  );
  assert.equal(task.status, 'blocked');
});

test('ExecutionTask stages the injected artifact only after production and records producer failure', async () => {
  const initial = changeTask(
    createTask(
      { title: 'build', objective: 'Run checks', kind: 'execution_task' },
      { id: 't', createdAt: 'now' },
    ),
    { owner: 'a' },
    'now',
  );
  let task = initial;
  const room = createRoom(
    { title: 'task', type: 'task', taskId: 't', participants: [{ kind: 'agent', id: 'a' }] },
    { id: 'r', createdAt: 'now' },
  );
  const source = createMessage(
    room,
    { sender: { kind: 'agent', id: 'a' }, content: 'build' },
    { id: 'source', createdAt: 'now' },
  );
  const reply = createMessage(
    room,
    { sender: { kind: 'agent', id: 'a' }, content: 'proposal', replyTo: 'source' },
    { id: 'reply', createdAt: 'later' },
    source,
  );
  const session = createSession(
    { roomId: 'r', agentId: 'a', runtime: 'codex' },
    { id: 's', at: 'now' },
  );
  let produced = false;
  let staged = 0;
  const artifact = { id: 'sandbox', uri: 'org://artifacts/proof', createdAt: 'later' };
  const provider = {
    get: () => task,
    update: (
      _id: string,
      patch: Parameters<typeof changeTask>[1],
      at: string,
      expected?: number,
    ) => {
      assert.equal(expected, task.version);
      task = changeTask(task, patch, at);
      return task;
    },
    stageExecutionResult: (_id: string, output: typeof artifact, expected: number) => {
      assert.equal(expected, task.version);
      assert.equal(produced, true);
      assert.deepEqual(output, artifact);
      staged++;
      task = changeTask(task, { status: 'waiting_approval' }, 'later');
      return task;
    },
  };
  const run = (
    produce: (running: typeof task, message: typeof reply) => Promise<typeof artifact>,
  ) =>
    runExecutionTask(
      provider,
      { get: () => session },
      { get: () => room, messages: () => [source] },
      async () => reply,
      { taskId: 't', sessionId: 's', messageId: 'source' },
      () => 'later',
      produce,
    );
  await run(async (running, message) => {
    assert.equal(running.status, 'running');
    assert.equal(running.version, task.version);
    assert.equal(message, reply);
    produced = true;
    return artifact;
  });
  assert.equal(task.status, 'waiting_approval');
  assert.equal(staged, 1);
  task = initial;
  await assert.rejects(
    run(async () => {
      throw new Error('native tool failed');
    }),
    /native tool failed/,
  );
  assert.equal(task.status, 'failed');
  assert.equal(staged, 1);
});
