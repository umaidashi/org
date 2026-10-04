import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { createRoom, createMessage } from '../src/rooms/domain.js';
import { sendA2AMessage, listA2AMessages } from '../src/a2a/service.js';
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
