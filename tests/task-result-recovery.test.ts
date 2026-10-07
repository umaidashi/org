import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { createTask, changeTask, attachArtifact } from '../src/tasks/domain.js';
import { createRoom, createMessage } from '../src/rooms/domain.js';
import { createSession } from '../src/sessions/domain.js';
import { recoverExecutionTaskResult, TaskResultPendingError } from '../src/tasks/execution.js';
test('Runtime result recovery rejects altered evidence and retries only staging with original CAS', () => {
  const running = changeTask(
    changeTask(
      createTask(
        { title: 'build', objective: 'check', kind: 'execution_task' },
        { id: 't', createdAt: 'before' },
      ),
      { owner: 'a' },
      'assigned',
    ),
    { status: 'running' },
    'started',
  );
  const blocked = changeTask(running, { status: 'blocked' }, 'blocked');
  let current = blocked;
  let history = [running, blocked].map((task) => ({
    task,
    version: task.version,
    status: task.status,
    at: task.updatedAt,
  }));
  const room = createRoom(
    { title: 'task', type: 'task', taskId: 't', participants: [{ kind: 'agent', id: 'a' }] },
    { id: 'r', createdAt: 'before' },
  );
  const session = createSession(
    { roomId: 'r', agentId: 'a', runtime: 'codex' },
    { id: 's', at: 'before' },
  );
  const source = createMessage(
    room,
    { sender: { kind: 'agent', id: 'a' }, content: 'check' },
    { id: 'source', createdAt: 'started' },
  );
  const reply = createMessage(
    room,
    {
      sender: { kind: 'agent', id: 'a' },
      content: 'result',
      replyTo: source.id,
      metadata: { sessionId: 's', taskExecution: { taskId: 't', version: running.version } },
    },
    { id: 'reply', createdAt: 'produced' },
    source,
  );
  let selected = reply;
  let stages = 0;
  let failure = '';
  const tasks = {
    get: () => current,
    history: () => history,
    update: (
      _id: string,
      patch: Parameters<typeof changeTask>[1],
      at: string,
      expected?: number,
    ) => {
      if (expected !== current.version) throw new Error('Version conflict');
      current = changeTask(current, patch, at);
      history.push({ task: current, version: current.version, status: current.status, at });
      return current;
    },
    stageExecutionResult: (
      _id: string,
      artifact: Parameters<typeof attachArtifact>[1],
      expected: number,
    ) => {
      assert.equal(expected, current.version);
      assert.equal(current.status, 'running');
      stages++;
      if (failure === 'concurrent') {
        current = changeTask(current, { status: 'failed' }, 'other');
        throw new Error('stage failure');
      }
      if (failure === 'storage') throw new Error('stage failure');
      assert.equal(artifact.id, 'reply');
      assert.equal(artifact.uri, 'org://rooms/r/messages/reply');
      current = changeTask(
        attachArtifact(current, artifact, 'output'),
        { status: 'waiting_approval' },
        artifact.createdAt,
      );
      return current;
    },
  };
  const recover = (version = current.version) =>
    recoverExecutionTaskResult(
      tasks,
      { get: () => session },
      { get: () => room, messages: () => [source, selected] },
      { taskId: 't', sessionId: 's', messageId: 'reply', expectedVersion: version },
      () => 'retry',
    );
  assert.throws(() => recover(blocked.version - 1));
  for (const taskExecution of [
    null,
    { taskId: 'other', version: running.version },
    { taskId: 't', version: running.version + 1 },
    { taskId: 't', version: NaN },
    { taskId: 't', version: running.version, extra: true },
  ]) {
    selected = { ...reply, metadata: { sessionId: 's', taskExecution } };
    assert.throws(() => recover());
  }
  selected = {
    ...reply,
    metadata: { sessionId: 'other', taskExecution: reply.metadata.taskExecution ?? null },
  };
  assert.throws(() => recover());
  selected = reply;
  current = changeTask(blocked, { title: 'changed' }, 'edited');
  history.push({ task: current, version: current.version, status: current.status, at: 'edited' });
  assert.throws(() => recover());
  assert.equal(stages, 0);
  current = blocked;
  history = history.slice(0, 2);
  failure = 'storage';
  assert.throws(() => recover(), TaskResultPendingError);
  assert.equal(current.status, 'blocked');
  assert.equal(stages, 1);
  failure = '';
  const recovered = recover();
  assert.equal(recovered.status, 'waiting_approval');
  assert.deepEqual(recovered.outputArtifacts, ['reply']);
  assert.equal(stages, 2);
  assert.throws(() => recover());
  assert.equal(stages, 2);
  current = blocked;
  history = history.slice(0, 2);
  failure = 'concurrent';
  assert.throws(() => recover(), AggregateError);
  assert.equal(current.status, 'failed');
});
