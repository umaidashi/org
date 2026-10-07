import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { createTask, changeTask } from '../src/tasks/domain.js';
import { assignTask, readTaskRoomArtifact } from '../src/tasks/service.js';

test('assignment rejects missing Agent before invoking the injected writer', () => {
  const at = '2026-10-04T00:00:00.000Z';
  const task = createTask({ title: 'x', objective: 'y' }, { id: 'task', createdAt: at });
  let writes = 0;
  const writer = {
    update: () => {
      writes += 1;
      return task;
    },
  };
  assert.throws(() => assignTask(writer, { list: () => [] }, 'task', 'missing', at), /Agent/);
  assert.equal(writes, 0);
});

test('assignment forwards identity and time through injected ports and propagates persistence failure', () => {
  const at = '2026-10-04T00:00:00.000Z';
  const task = createTask({ title: 'x', objective: 'y' }, { id: 'task', createdAt: at });
  const reader = {
    list: () => [{ id: 'agent', name: 'dev', role: 'dev', runtime: 'codex', createdAt: at }],
  };
  const writer = {
    update: (id: string, patch: { owner?: string }, timestamp: string) => {
      assert.equal(id, 'task');
      assert.deepEqual(patch, { owner: 'agent' });
      assert.equal(timestamp, at);
      return changeTask(task, patch, timestamp);
    },
  };
  assert.equal(assignTask(writer, reader, 'task', 'agent', at).status, 'assigned');
  assert.throws(
    () =>
      assignTask(
        {
          update: () => {
            throw new Error('storage unavailable');
          },
        },
        reader,
        'task',
        'agent',
        at,
      ),
    /storage unavailable/,
  );
});

test('Room artifact reading requires canonical URI and same Task original before returning content', () => {
  const room = {
    id: 'r /日本',
    title: 'task',
    type: 'task' as const,
    activationPolicy: 'mention_only' as const,
    participants: [],
    taskId: 't',
    createdAt: 'now',
    archivedAt: null,
  };
  const message = {
    id: 'm /日本',
    roomId: room.id,
    sender: { kind: 'agent' as const, id: 'a' },
    content: 'original result',
    replyTo: null,
    metadata: {},
    createdAt: 'now',
  };
  const uri = `org://rooms/${encodeURIComponent(room.id)}/messages/${encodeURIComponent(message.id)}`;
  let selectedRoom = room;
  let messages = [message];
  let reads = 0;
  const rooms = {
    get: () => {
      reads++;
      return selectedRoom;
    },
    messages: () => messages,
  };
  assert.equal(readTaskRoomArtifact(rooms, 't', uri), message.content);
  for (const invalid of [
    uri + '?x=1',
    uri + '#x',
    uri + '/',
    'https://example.com',
    'org://rooms/%ZZ/messages/m',
    uri.replace('%2F', '%2f'),
  ]) {
    const before = reads;
    assert.throws(() => readTaskRoomArtifact(rooms, 't', invalid));
    assert.equal(reads, before);
  }
  assert.throws(() => readTaskRoomArtifact(rooms, 'other', uri), /belong/);
  selectedRoom = { ...room, id: 'other' };
  assert.throws(() => readTaskRoomArtifact(rooms, 't', uri), /belong/);
  selectedRoom = room;
  messages = [{ ...message, roomId: 'other' }];
  assert.throws(() => readTaskRoomArtifact(rooms, 't', uri), /not found/);
  messages = [];
  assert.throws(() => readTaskRoomArtifact(rooms, 't', uri), /not found/);
  assert.throws(
    () =>
      readTaskRoomArtifact(
        {
          get: () => {
            throw new Error('storage');
          },
          messages: () => [],
        },
        't',
        uri,
      ),
    /storage/,
  );
});
