import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { createRoom } from '../src/rooms/domain.js';
import { createA2AMessage, readA2AMessage, a2aTypes, isJsonValue } from '../src/a2a/domain.js';
test('A2A JSON validation rejects non-JSON objects and non-finite values', () => {
  for (const value of [new Date(), new Map(), undefined, 1n, Infinity, { value: NaN }])
    assert.equal(isJsonValue(value), false);
  assert.equal(isJsonValue({ value: [null, true, 'text', 1] }), true);
});
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
const input = {
  from: 'chief',
  to: 'cto',
  type: 'delegate' as const,
  taskId: 'task',
  payload: { objective: 'Research' },
};
test('typed A2A stores every protocol type and copies its payload into immutable Room evidence', () => {
  for (const type of a2aTypes) {
    const source = { ...input, type };
    const message = createA2AMessage(room, source, { id: type, createdAt: 'sent' });
    const envelope = readA2AMessage(message);
    assert.equal(envelope.type, type);
    assert.equal(envelope.correlationId, type);
    assert.equal(envelope.from, 'chief');
    assert.equal(envelope.to, 'cto');
    assert.equal(envelope.taskId, 'task');
    assert.deepEqual(envelope.payload, { objective: 'Research' });
  }
  const message = createA2AMessage(room, input, { id: 'message', createdAt: 'sent' });
  input.payload.objective = 'Changed';
  assert.deepEqual(readA2AMessage(message).payload, { objective: 'Research' });
  input.payload.objective = 'Research';
  assert.throws(() =>
    createA2AMessage(room, { ...input, to: 'missing' }, { id: 'x', createdAt: 'sent' }),
  );
  assert.throws(() =>
    createA2AMessage(
      room,
      { ...input, payload: { bad: Infinity } },
      { id: 'x', createdAt: 'sent' },
    ),
  );
});
test('A2A replies reverse endpoints and retain Task and correlation instead of accepting inconsistent references', () => {
  const first = createA2AMessage(room, input, { id: 'request', createdAt: 'sent' });
  const reply = {
    from: 'cto',
    to: 'chief',
    type: 'result' as const,
    payload: { result: 'Done' },
    replyTo: first.id,
  };
  const result = readA2AMessage(
    createA2AMessage(room, reply, { id: 'reply', createdAt: 'replied' }, first),
  );
  assert.equal(result.taskId, 'task');
  assert.equal(result.correlationId, 'request');
  assert.equal(result.replyTo, 'request');
  for (const invalid of [
    { ...reply, to: 'cto' },
    { ...reply, taskId: 'other' },
    { ...reply, correlationId: 'other' },
  ])
    assert.throws(() =>
      createA2AMessage(room, invalid, { id: 'bad', createdAt: 'replied' }, first),
    );
  assert.throws(() =>
    createA2AMessage({ ...room, id: 'other' }, reply, { id: 'bad', createdAt: 'replied' }, first),
  );
  assert.throws(() => readA2AMessage({ ...first, sender: { kind: 'human', id: 'chief' } }));
});
test('Task Room A2A inherits its Task and rejects a different explicit Task reference', () => {
  const taskRoom = { ...room, type: 'task' as const, taskId: 'task' };
  const message = createA2AMessage(
    taskRoom,
    { from: 'chief', to: 'cto', type: 'request', payload: null },
    { id: 'message', createdAt: 'sent' },
  );
  assert.equal(readA2AMessage(message).taskId, 'task');
  assert.throws(
    () =>
      createA2AMessage(taskRoom, { ...input, taskId: 'other' }, { id: 'bad', createdAt: 'sent' }),
    /Task Room/,
  );
});
