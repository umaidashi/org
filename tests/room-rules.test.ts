import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { createRoom, createMessage, validateActivationRules } from '../src/rooms/domain.js';
import { selectActivationAgents } from '../src/activation/domain.js';
test('Room rules select only matching participant Agents for human metadata and retain explicit target precedence', () => {
  const input = {
    title: 'Rules',
    type: 'group' as const,
    activationPolicy: 'rule_based' as const,
    participants: [
      { kind: 'human' as const, id: 'founder' },
      { kind: 'agent' as const, id: 'code' },
      { kind: 'agent' as const, id: 'review' },
    ],
    activationRules: [
      { agentId: 'code', metadata: { topic: 'code' } },
      { agentId: 'review', metadata: { topic: 'code', urgent: true } },
      { agentId: 'code', metadata: { topic: 'code', urgent: true } },
    ],
  };
  const room = createRoom(input, { id: 'room', createdAt: 'now' });
  const message = (
    metadata: Record<string, string | boolean | number | null>,
    sender: { kind: 'human' | 'agent'; id: string } = { kind: 'human', id: 'founder' },
  ) =>
    createMessage(
      room,
      { sender, content: 'check', metadata },
      { id: 'message', createdAt: 'now' },
    );
  assert.deepEqual(selectActivationAgents(room, message({ topic: 'code' })), ['code']);
  assert.deepEqual(selectActivationAgents(room, message({ topic: 'code', urgent: true })), [
    'code',
    'review',
  ]);
  assert.deepEqual(selectActivationAgents(room, message({ topic: 'other' })), []);
  assert.deepEqual(
    selectActivationAgents(room, message({ topic: 'code' }, { kind: 'agent', id: 'review' })),
    [],
  );
  const explicit = createMessage(
    room,
    {
      sender: { kind: 'human', id: 'founder' },
      content: 'check',
      metadata: { topic: 'code', mentions: ['review'] },
    },
    { id: 'explicit', createdAt: 'now' },
  );
  assert.deepEqual(selectActivationAgents(room, explicit), ['review']);
  const first = input.activationRules[0];
  assert.ok(first);
  first.metadata.topic = 'changed';
  assert.deepEqual(selectActivationAgents(room, message({ topic: 'code' })), ['code']);
  assert.throws(
    () =>
      createRoom(
        { ...input, activationRules: [{ agentId: 'foreign', metadata: { topic: 'code' } }] },
        { id: 'bad', createdAt: 'now' },
      ),
    /Rule/,
  );
  assert.throws(
    () => createRoom({ ...input, activationPolicy: 'all' }, { id: 'bad', createdAt: 'now' }),
    /Rule/,
  );
});

test('Room rule validation rejects malformed or excessive conditions and preserves scalar type matching', () => {
  const participants = [
    { kind: 'human' as const, id: 'founder' },
    { kind: 'agent' as const, id: 'worker' },
  ];
  for (const rules of [
    [],
    Array.from({ length: 33 }, () => ({ agentId: 'worker', metadata: { topic: 'code' } })),
    [{ agentId: 'worker', metadata: {} }],
    [{ agentId: 'worker', metadata: { mentions: 'worker' } }],
    [{ agentId: 'worker', metadata: { a2a: 'worker' } }],
    [{ agentId: 'worker', metadata: { nested: { topic: 'code' } } }],
    [{ agentId: 'worker', metadata: { topic: Number.NaN } }],
    [{ agentId: 'worker', metadata: { topic: 'x'.repeat(1025) } }],
    [{ agentId: 'worker', metadata: { topic: 'code' }, code: 'exec' }],
    null,
  ])
    assert.throws(() => validateActivationRules(rules, participants), /Rule/);
  const room = createRoom(
    {
      title: 'Scalar',
      type: 'direct',
      activationPolicy: 'rule_based',
      participants,
      activationRules: [{ agentId: 'worker', metadata: { count: 1, empty: null } }],
    },
    { id: 'scalar', createdAt: 'now' },
  );
  const message = (metadata: Record<string, number | string | null>) =>
    createMessage(
      room,
      { sender: { kind: 'human', id: 'founder' }, content: 'check', metadata },
      { id: 'message', createdAt: 'now' },
    );
  assert.deepEqual(selectActivationAgents(room, message({ count: 1, empty: null })), ['worker']);
  assert.deepEqual(selectActivationAgents(room, message({ count: '1', empty: null })), []);
  assert.deepEqual(selectActivationAgents(room, message({ count: 1 })), []);
});
