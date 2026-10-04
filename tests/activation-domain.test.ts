import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { createRoom, createMessage } from '../src/rooms/domain.js';
import { createA2AMessage } from '../src/a2a/domain.js';
import { selectActivationAgents } from '../src/activation/domain.js';
const participants = [
  { kind: 'human', id: 'founder' },
  { kind: 'agent', id: 'chief' },
  { kind: 'agent', id: 'cto' },
] as const;
const input = { title: 'Company', type: 'group' as const, participants };
const room = createRoom({ ...input, coordinatorId: 'chief' }, { id: 'room', createdAt: 'before' });
const identity = { id: 'message', createdAt: 'sent' };
const message = createMessage(room, { sender: participants[0], content: 'Research' }, identity);
test('Activation selects only coordinator or explicit mentions and never relays ordinary Agent replies', () => {
  assert.equal(room.coordinatorId, 'chief');
  assert.deepEqual(selectActivationAgents(room, message), ['chief']);
  const mention = createMessage(
    room,
    { sender: participants[0], content: 'Question', metadata: { mentions: ['cto', 'cto'] } },
    identity,
  );
  assert.deepEqual(selectActivationAgents(room, mention), ['cto']);
  assert.deepEqual(
    selectActivationAgents({ ...room, activationPolicy: 'mention_only' }, message),
    [],
  );
  assert.deepEqual(selectActivationAgents({ ...room, activationPolicy: 'all' }, message), [
    'chief',
    'cto',
  ]);
  const reply = createMessage(room, { sender: participants[1], content: 'Reply' }, identity);
  assert.deepEqual(selectActivationAgents(room, reply), []);
  assert.deepEqual(selectActivationAgents({ ...room, activationPolicy: 'all' }, reply), []);
  const explicit = createMessage(
    room,
    { sender: participants[1], content: 'Ask CTO', metadata: { mentions: ['chief', 'cto'] } },
    identity,
  );
  assert.deepEqual(selectActivationAgents(room, explicit), ['cto']);
  const a2a = createA2AMessage(
    room,
    { from: 'chief', to: 'cto', type: 'request', payload: null },
    identity,
  );
  assert.deepEqual(selectActivationAgents(room, a2a), ['cto']);
});
test('Activation requires valid Room references, fails closed without coordinator or rules and retains old single-Agent behavior', () => {
  assert.throws(
    () => createRoom({ ...input, coordinatorId: 'founder' }, { id: 'x', createdAt: 'now' }),
    /coordinator/i,
  );
  for (const mentions of [['outsider'], ['founder'], [' '], 'cto', [1]])
    assert.throws(
      () =>
        createMessage(
          room,
          { sender: participants[0], content: 'x', metadata: { mentions } },
          identity,
        ),
      /mention/i,
    );
  assert.throws(
    () => selectActivationAgents({ ...room, archivedAt: 'after' }, message),
    /archived/i,
  );
  assert.throws(() => selectActivationAgents(room, { ...message, roomId: 'other' }), /Room/i);
  assert.throws(
    () => selectActivationAgents(room, { ...message, sender: { kind: 'human', id: 'outsider' } }),
    /sender/i,
  );
  const old = createRoom(input, { id: 'room', createdAt: 'before' });
  assert.equal(old.coordinatorId, undefined);
  assert.throws(() => selectActivationAgents(old, message), /coordinator/i);
  assert.throws(
    () => selectActivationAgents({ ...room, activationPolicy: 'rule_based' }, message),
    /rules/i,
  );
  const direct = createRoom(
    { title: 'Direct', type: 'direct', participants: participants.slice(0, 2) },
    { id: 'room', createdAt: 'before' },
  );
  assert.deepEqual(selectActivationAgents(direct, message), ['chief']);
});
