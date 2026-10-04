import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { archiveRoom, createMessage, createRoom } from '../src/rooms/domain.js';
const identity = { id: 'room', createdAt: '2026-10-04T00:00:00Z' };
const human = { kind: 'human', id: 'founder' } as const;
const agent = { kind: 'agent', id: 'chief' } as const;
test('Room types require their participant composition and default to coordinator', () => {
  const input = [human, agent];
  const room = createRoom({ title: '設計', type: 'direct', participants: input }, identity);
  assert.equal(room.activationPolicy, 'coordinator');
  input.push({ kind: 'agent', id: 'chief' });
  assert.equal(room.participants.length, 2);
  for (const participants of [[human], [agent], [human, human, agent]])
    assert.throws(() => createRoom({ title: 'x', type: 'direct', participants }, identity));
  assert.throws(() =>
    createRoom({ title: ' ', type: 'direct', participants: [human, agent] }, identity),
  );
  assert.throws(() =>
    createRoom({ title: 'x', type: 'group', participants: [human, agent] }, identity),
  );
  assert.throws(() =>
    createRoom({ title: 'x', type: 'agent', participants: [human, agent] }, identity),
  );
  assert.throws(() => createRoom({ title: 'x', type: 'task', participants: [agent] }, identity));
  assert.equal(
    createRoom({ title: 'x', type: 'task', taskId: 'task', participants: [agent] }, identity)
      .taskId,
    'task',
  );
  assert.equal(
    createRoom(
      { title: 'x', type: 'agent', participants: [agent, { kind: 'agent', id: 'dev' }] },
      identity,
    ).type,
    'agent',
  );
});
test('Messages require membership and same-room replies; archive preserves the original Room', () => {
  const room = createRoom({ title: 'x', type: 'direct', participants: [human, agent] }, identity);
  const input = { sender: human, content: 'hello', metadata: { topic: { name: 'design' } } };
  const first = createMessage(room, input, { ...identity, id: 'message' });
  input.metadata.topic.name = 'changed';
  assert.deepEqual(first.metadata, { topic: { name: 'design' } });
  const reply = createMessage(
    room,
    { sender: agent, content: 'reply', replyTo: first.id },
    { ...identity, id: 'reply' },
    first,
  );
  assert.equal(reply.replyTo, first.id);
  assert.throws(() =>
    createMessage(room, { sender: agent, content: 'x', replyTo: 'missing' }, identity),
  );
  assert.throws(() =>
    createMessage(room, { sender: agent, content: 'x', replyTo: first.id }, identity, {
      ...first,
      roomId: 'other',
    }),
  );
  assert.throws(() =>
    createMessage(room, { sender: { kind: 'human', id: 'outsider' }, content: 'x' }, identity),
  );
  assert.throws(() => createMessage(room, { sender: human, content: ' ' }, identity));
  const archived = archiveRoom(room, '2026-10-04T01:00:00Z');
  assert.equal(room.archivedAt, null);
  assert.equal(archived.archivedAt, '2026-10-04T01:00:00Z');
  assert.throws(() => createMessage(archived, input, identity));
  assert.deepEqual(archiveRoom(archived, 'later'), archived);
});
