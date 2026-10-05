import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { createRoom, createMessage } from '../src/rooms/domain.js';
import { createSession } from '../src/sessions/domain.js';
import { activateRoomMessage } from '../src/activation/service.js';
const room = createRoom(
  {
    title: 'Work',
    type: 'direct',
    participants: [
      { kind: 'human', id: 'h' },
      { kind: 'agent', id: 'a' },
    ],
  },
  { id: 'r', createdAt: 'before' },
);
const source = createMessage(
  room,
  { sender: { kind: 'human', id: 'h' }, content: 'Question' },
  { id: 'm', createdAt: 'sent' },
);
const session = createSession(
  { agentId: 'a', roomId: 'r', runtime: 'codex' },
  { id: 's', at: 'now' },
);
test('Room wake-up opens only the selected Session, reuses it and returns existing replies without another turn', async () => {
  const messages = [source];
  const sessions = [session];
  let opens = 0,
    turns = 0;
  const rooms = { get: () => room, messages: () => messages };
  const open = (agentId: string, roomId: string) => {
    opens++;
    assert.equal(agentId, 'a');
    assert.equal(roomId, 'r');
    sessions.push(session);
    return session;
  };
  const reply = async (sessionId: string, messageId: string) => {
    turns++;
    assert.equal(sessionId, 's');
    assert.equal(messageId, 'm');
    const result = createMessage(
      room,
      {
        sender: { kind: 'agent', id: 'a' },
        content: 'Answer',
        replyTo: source.id,
        metadata: { sessionId },
      },
      { id: 'reply', createdAt: 'later' },
      source,
    );
    messages.push(result);
    return result;
  };
  const result = await activateRoomMessage(
    rooms,
    { list: () => sessions },
    open,
    reply,
    room.id,
    source.id,
  );
  assert.equal(result[0]?.id, 'reply');
  assert.equal(opens, 0);
  assert.equal(turns, 1);
  assert.deepEqual(
    await activateRoomMessage(rooms, { list: () => [] }, open, reply, room.id, source.id),
    result,
  );
  assert.equal(opens, 0);
  assert.equal(turns, 1);
  messages.splice(1);
  sessions.splice(0);
  await activateRoomMessage(rooms, { list: () => sessions }, open, reply, room.id, source.id);
  assert.equal(opens, 1);
  assert.equal(turns, 2);
});
test('Room wake-up rejects busy or mismatched Sessions and propagates runtime failure without a reply', async () => {
  const rooms = { get: () => room, messages: () => [source] };
  const reply = async () => {
    throw new Error('Driver failure');
  };
  const open = () => session;
  await assert.rejects(
    activateRoomMessage(
      rooms,
      { list: () => [{ ...session, status: 'running' }] },
      open,
      reply,
      room.id,
      source.id,
    ),
    /running/i,
  );
  await assert.rejects(
    activateRoomMessage(
      rooms,
      { list: () => [] },
      () => ({ ...session, roomId: 'other' }),
      reply,
      room.id,
      source.id,
    ),
    /Session/i,
  );
  await assert.rejects(
    activateRoomMessage(rooms, { list: () => [session] }, open, reply, room.id, source.id),
    /Driver failure/,
  );
  await assert.rejects(
    activateRoomMessage(
      rooms,
      { list: () => [session] },
      open,
      async () => ({ ...source, replyTo: source.id }),
      room.id,
      source.id,
    ),
    /reply/i,
  );
});
