import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { createRoom, createMessage } from '../src/rooms/domain.js';
import { createSession } from '../src/sessions/domain.js';
import { pollRoomWakeups, recoverWakeups } from '../src/activation/poll.js';
import type { WakeupJournal, WakeupReceipt } from '../src/activation/port.js';
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
const source = (id: string) =>
  createMessage(
    room,
    { sender: { kind: 'human', id: 'h' }, content: id },
    { id, createdAt: 'sent' },
  );
function journal(): WakeupJournal {
  const rows = new Map<string, WakeupReceipt>();
  return {
    get: (id) => rows.get(id),
    list: () => [...rows.values()],
    claim: (input) => {
      if (rows.has(input.messageId)) return false;
      rows.set(input.messageId, {
        ...input,
        status: 'running',
        replyIds: [],
        error: null,
        finishedAt: null,
      });
      return true;
    },
    finish: (id, result) => {
      const old = rows.get(id);
      assert.ok(old);
      rows.set(id, {
        messageId: old.messageId,
        roomId: old.roomId,
        startedAt: old.startedAt,
        ...result,
      });
    },
  };
}
test('automatic wake-up claims before a turn, records failure once, continues later messages and does not replay', async () => {
  const messages = [
    source('bad'),
    source('good'),
    createMessage(
      room,
      { sender: { kind: 'agent', id: 'a' }, content: 'ordinary' },
      { id: 'reply', createdAt: 'later' },
    ),
  ];
  const store = journal();
  let calls = 0;
  const rooms = { list: () => [room], messages: () => messages };
  const activate = async (roomId: string, id: string) => {
    calls++;
    assert.equal(roomId, 'r');
    assert.equal(store.get(id)?.status, 'running');
    if (id === 'bad') throw new Error('Private provider error');
    return [
      createMessage(
        room,
        { sender: { kind: 'agent', id: 'a' }, content: 'done', replyTo: id },
        { id: 'result', createdAt: 'later' },
        messages.find((m) => m.id === id),
      ),
    ];
  };
  await pollRoomWakeups(rooms, { list: () => [] }, store, activate, () => 'now');
  assert.equal(calls, 2);
  assert.equal(store.get('bad')?.status, 'failed');
  assert.equal(store.get('bad')?.error, 'Automatic Room activation failed');
  assert.equal(store.get('good')?.status, 'completed');
  assert.deepEqual(store.get('good')?.replyIds, ['result']);
  assert.equal(store.get('reply'), undefined);
  await pollRoomWakeups(rooms, { list: () => [] }, store, activate, () => 'later');
  assert.equal(calls, 2);
});
test('automatic wake-up defers busy Sessions without claiming and restart marks unfinished intent failed without another turn', async () => {
  const store = journal(),
    session = createSession(
      { agentId: 'a', roomId: 'r', runtime: 'codex' },
      { id: 's', at: 'now' },
    );
  let calls = 0;
  const rooms = { list: () => [room], messages: () => [source('message')] };
  await pollRoomWakeups(
    rooms,
    { list: () => [{ ...session, status: 'running' }] },
    store,
    async () => {
      calls++;
      return [];
    },
    () => 'now',
  );
  assert.equal(calls, 0);
  assert.equal(store.get('message'), undefined);
  store.claim({ messageId: 'message', roomId: 'r', startedAt: 'start' });
  assert.equal(
    recoverWakeups(store, () => 'recovery'),
    1,
  );
  assert.equal(
    recoverWakeups(store, () => 'later'),
    0,
  );
  assert.equal(store.get('message')?.status, 'failed');
  assert.equal(store.get('message')?.error, 'Room activation interrupted by daemon restart');
  await pollRoomWakeups(
    rooms,
    { list: () => [session] },
    store,
    async () => {
      calls++;
      return [];
    },
    () => 'later',
  );
  assert.equal(calls, 0);
});
test('shutdown leaves later unexecuted Messages unclaimed for the next daemon', async () => {
  const store = journal(),
    controller = new AbortController();
  const rooms = { list: () => [room], messages: () => [source('first'), source('later')] };
  let calls = 0;
  await pollRoomWakeups(
    rooms,
    { list: () => [] },
    store,
    async () => {
      calls++;
      controller.abort();
      throw new Error('Runtime cancelled');
    },
    () => 'now',
    controller.signal,
  );
  assert.equal(calls, 1);
  assert.equal(store.get('first')?.status, 'failed');
  assert.equal(store.get('later'), undefined);
});
