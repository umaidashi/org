import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { createRoom, createMessage } from '../src/rooms/domain.js';
import {
  sendA2AMessage,
  listA2AMessages,
  delegateA2ATask,
  pollDelegationResults,
} from '../src/a2a/service.js';
import { createA2AMessage } from '../src/a2a/domain.js';
const room = createRoom(
  {
    title: 'Agents',
    type: 'agent',
    participants: [
      { kind: 'agent', id: 'chief' },
      { kind: 'agent', id: 'cto' },
    ],
  },
  { id: 'room', createdAt: 'before' },
);
const agents = {
  list: () =>
    ['chief', 'cto'].map((id) => ({
      id,
      name: id,
      role: id,
      runtime: 'codex',
      createdAt: 'before',
    })),
};
const input = {
  from: 'chief',
  to: 'cto',
  type: 'request' as const,
  payload: { objective: 'Research' },
  taskId: 'task',
};
test('A2A service verifies Agent and Task references before writing through the injected Room port', () => {
  let writes = 0,
    lookups = 0;
  const store = {
    get: () => room,
    messages: () => [],
    append: (
      id: string,
      data: Parameters<typeof createMessage>[1],
      identity: Parameters<typeof createMessage>[2],
    ) => {
      writes++;
      assert.equal(id, room.id);
      return createMessage(room, data, identity);
    },
  };
  const tasks = {
    get: (id: string) => {
      lookups++;
      assert.equal(id, 'task');
      return { id };
    },
  };
  const result = sendA2AMessage(store, agents, tasks, room.id, input, {
    id: 'request',
    createdAt: 'sent',
  });
  assert.equal(result.id, 'request');
  assert.equal(writes, 1);
  assert.equal(lookups, 1);
  assert.throws(() =>
    sendA2AMessage(store, { list: () => [] }, tasks, room.id, input, {
      id: 'bad',
      createdAt: 'sent',
    }),
  );
  assert.throws(
    () =>
      sendA2AMessage(
        store,
        agents,
        {
          get: () => {
            throw new Error('Task not found');
          },
        },
        room.id,
        input,
        { id: 'bad', createdAt: 'sent' },
      ),
    /Task not found/,
  );
  assert.equal(writes, 1);
});
test('A2A reading leaves ordinary Room messages alone and rejects a malformed reserved envelope', () => {
  const ordinary = createMessage(
    room,
    { sender: { kind: 'agent', id: 'chief' }, content: 'Note' },
    { id: 'note', createdAt: 'sent' },
  );
  assert.deepEqual(
    listA2AMessages({ get: () => room, messages: () => [ordinary] }, room.id, {
      get: () => undefined,
    }),
    [],
  );
  assert.throws(
    () =>
      listA2AMessages(
        { get: () => room, messages: () => [{ ...ordinary, metadata: { a2a: { version: 1 } } }] },
        room.id,
        { get: () => undefined },
      ),
    /Invalid A2A/,
  );
});
test('A2A reading validates referenced Tasks instead of trusting arbitrary reserved metadata', () => {
  const message = createA2AMessage(room, input, { id: 'request', createdAt: 'sent' });
  assert.throws(
    () =>
      listA2AMessages({ get: () => room, messages: () => [message] }, room.id, {
        get: () => {
          throw new Error('Task not found');
        },
      }),
    /Task not found/,
  );
});
test('A2A reading rejects a reply whose correlation differs from its source', () => {
  const parent = createA2AMessage(room, input, { id: 'request', createdAt: 'sent' });
  const forged = createMessage(
    room,
    {
      sender: { kind: 'agent', id: 'cto' },
      content: 'Result',
      replyTo: parent.id,
      metadata: {
        a2a: {
          version: 1,
          from: 'cto',
          to: 'chief',
          type: 'result',
          payload: null,
          taskId: 'task',
          correlationId: 'other',
        },
      },
    },
    { id: 'reply', createdAt: 'replied' },
    parent,
  );
  assert.throws(
    () =>
      listA2AMessages({ get: () => room, messages: () => [parent, forged] }, room.id, {
        get: () => undefined,
      }),
    /A2A.*reference/,
  );
});

test('delegate requires an explicit sender capability before persisting Room evidence', () => {
  let writes = 0;
  const store = {
    get: () => room,
    messages: () => [],
    append: (
      _id: string,
      data: Parameters<typeof createMessage>[1],
      identity: Parameters<typeof createMessage>[2],
    ) => {
      writes++;
      return createMessage(room, data, identity);
    },
  };
  const delegate = { ...input, type: 'delegate' as const };
  const tasks = { get: () => ({ id: 'task' }) };
  assert.throws(
    () => sendA2AMessage(store, agents, tasks, room.id, delegate, { id: 'deny', createdAt: 'now' }),
    /can_delegate/,
  );
  assert.equal(writes, 0);
  const allowed = {
    list: () =>
      agents.list().map((agent) => ({ ...agent, capabilities: ['can_delegate'] as const })),
  };
  assert.equal(
    sendA2AMessage(store, allowed, tasks, room.id, delegate, { id: 'grant', createdAt: 'now' })
      .type,
    'delegate',
  );
  assert.equal(writes, 1);
});

test('typed delegation creates an assigned target Task from immutable source without reassigning an advanced Task', () => {
  const source = createA2AMessage(
    room,
    { ...input, type: 'delegate' },
    { id: 'delegate', createdAt: 'sent' },
  );
  const permitted = {
    list: () =>
      agents.list().map((agent) => ({ ...agent, capabilities: ['can_delegate'] as const })),
  };
  let writes = 0;
  const planned: import('../src/tasks/domain.js').Task[] = [];
  const tasks = {
    get: () => ({ id: 'task' }),
    createAssignedOnce: (
      task: import('../src/tasks/domain.js').Task,
      owner: string,
      at: string,
    ) => {
      writes++;
      planned.push(task);
      assert.equal(owner, 'cto');
      assert.equal(at, 'sent');
      return { ...task, owner, status: 'assigned' as const, version: 1 };
    },
  };
  const store = { get: () => room, messages: () => [source] };
  const first = delegateA2ATask(store, permitted, tasks, room.id, source.id);
  assert.equal(first.owner, 'cto');
  assert.equal(first.parentId, 'task');
  assert.match(first.objective, /Research/);
  assert.equal(first.externalRef, 'org://rooms/room/messages/delegate');
  delegateA2ATask(store, permitted, tasks, room.id, source.id);
  assert.deepEqual(planned[0], planned[1]);
  const advanced = { ...first, status: 'completed' as const, version: 5 };
  assert.equal(
    delegateA2ATask(
      store,
      permitted,
      { ...tasks, createAssignedOnce: () => advanced },
      room.id,
      source.id,
    ),
    advanced,
  );
  assert.throws(() => delegateA2ATask(store, agents, tasks, room.id, source.id), /can_delegate/);
  assert.throws(
    () =>
      delegateA2ATask(
        { ...store, get: () => ({ ...room, archivedAt: 'now' }) },
        permitted,
        tasks,
        room.id,
        source.id,
      ),
    /archived/,
  );
  assert.throws(() => delegateA2ATask(store, permitted, tasks, room.id, 'missing'), /delegate/i);
  assert.equal(writes, 2);
});

test('delegation result polling returns staged artifacts once and retries only the Room write after failure', async () => {
  const source = createA2AMessage(
    room,
    { ...input, type: 'delegate' },
    { id: 'delegate', createdAt: 'sent' },
  );
  const permitted = {
    list: () =>
      agents.list().map((agent) => ({ ...agent, capabilities: ['can_delegate'] as const })),
  };
  const task = delegateA2ATask(
    { get: () => room, messages: () => [source] },
    permitted,
    {
      get: () => ({ id: 'task' }),
      createAssignedOnce: (planned, owner) => ({
        ...planned,
        owner,
        status: 'assigned',
        version: 1,
      }),
    },
    room.id,
    source.id,
  );
  const staged = {
    ...task,
    status: 'waiting_approval' as const,
    version: 3,
    outputArtifacts: ['artifact'],
  };
  const messages = [source];
  let attempts = 0;
  const store = {
    list: () => [room],
    get: () => room,
    messages: () => messages,
    append: (
      _id: string,
      data: Parameters<typeof createMessage>[1],
      identity: Parameters<typeof createMessage>[2],
    ) => {
      attempts++;
      if (attempts === 1) throw new Error('write interrupted');
      const reply = createMessage(room, data, identity, source);
      messages.push(reply);
      return reply;
    },
  };
  const provider = {
    list: () => [staged],
    get: () => ({ id: 'task' }),
    history: () => [{ version: staged.version, status: staged.status, at: 'after', task: staged }],
  };
  const identity = () => ({ id: 'result', createdAt: 'after' });
  await assert.rejects(
    () => pollDelegationResults(store, permitted, provider, identity),
    /write interrupted/,
  );
  assert.equal(staged.status, 'waiting_approval');
  assert.equal(messages.length, 1);
  await pollDelegationResults(store, permitted, provider, identity);
  assert.equal(messages.length, 2);
  const result = listA2AMessages(store, room.id, provider)[1];
  assert.ok(result);
  assert.equal(result.type, 'result');
  assert.equal(result.from, 'cto');
  assert.equal(result.to, 'chief');
  assert.equal(result.replyTo, source.id);
  assert.equal(result.taskId, 'task');
  assert.equal(result.correlationId, source.id);
  assert.deepEqual(result.payload, {
    executionTaskId: staged.id,
    status: 'waiting_approval',
    version: 3,
    outputArtifacts: ['artifact'],
  });
  await pollDelegationResults(store, permitted, provider, identity);
  assert.equal(attempts, 2);
  const signal = AbortSignal.abort();
  await pollDelegationResults(store, permitted, provider, identity, signal);
  assert.equal(attempts, 2);

  await assert.rejects(
    () =>
      pollDelegationResults(
        store,
        permitted,
        {
          ...provider,
          list: () => {
            throw new Error('DB unavailable');
          },
        },
        identity,
      ),
    /DB unavailable/,
  );
  const forged = createA2AMessage(
    room,
    {
      from: 'cto',
      to: 'chief',
      type: 'result',
      replyTo: source.id,
      payload: {
        executionTaskId: 'other',
        version: 3,
        status: 'waiting_approval',
        outputArtifacts: ['artifact'],
      },
    },
    { id: 'forged', createdAt: 'after' },
    source,
  );
  await assert.rejects(
    () =>
      pollDelegationResults(
        { ...store, messages: () => [source, forged] },
        permitted,
        provider,
        identity,
      ),
    /Invalid delegation result reference/,
  );
  const failed = { ...staged, status: 'failed' as const, outputArtifacts: [] };
  const failureMessages = [source];
  const failureStore = {
    ...store,
    messages: () => failureMessages,
    append: (
      _id: string,
      data: Parameters<typeof createMessage>[1],
      id: Parameters<typeof createMessage>[2],
    ) => {
      const message = createMessage(room, data, id, source);
      failureMessages.push(message);
      return message;
    },
  };
  const failureProvider = {
    ...provider,
    list: () => [failed],
    history: () => [{ version: failed.version, status: failed.status, at: 'after', task: failed }],
  };
  await pollDelegationResults(failureStore, permitted, failureProvider, identity);
  assert.equal(listA2AMessages(failureStore, room.id, failureProvider)[1]?.type, 'blocker');
  await pollDelegationResults(failureStore, permitted, failureProvider, identity);
  assert.equal(failureMessages.length, 2);
});
