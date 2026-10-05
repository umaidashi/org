import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { createMessage, createRoom, type Message } from '../src/rooms/domain.js';
import { createAgent } from '../src/agents/domain.js';
import { adoptDelegationProposal, parseDelegationProposal } from '../src/a2a/proposal.js';
const room = createRoom(
  {
    title: 'Company',
    type: 'group',
    coordinatorId: 'chief',
    participants: [
      { kind: 'human', id: 'founder' },
      { kind: 'agent', id: 'chief' },
      { kind: 'agent', id: 'cto' },
    ],
  },
  { id: 'r', createdAt: 'before' },
);
const chief = createAgent(
  {
    name: 'Chief',
    role: 'Chief',
    runtime: 'claude',
    capabilities: ['can_read', 'can_write', 'can_delegate'],
  },
  { id: 'chief', createdAt: 'before' },
);
const cto = createAgent(
  { name: 'CTO', role: 'CTO', runtime: 'claude', reportsTo: 'chief' },
  { id: 'cto', createdAt: 'before' },
);
const content = JSON.stringify({
  version: 1,
  tool: 'a2a',
  type: 'delegate',
  to: 'cto',
  payload: { objective: 'Research options' },
});
function fixture() {
  const source = createMessage(
    room,
    { sender: { kind: 'agent', id: 'chief' }, content },
    { id: 'proposal', createdAt: 'at' },
  );
  const messages: Message[] = [source];
  const store = {
    get: () => room,
    messages: () => messages,
    append: (
      id: string,
      input: Parameters<typeof createMessage>[1],
      identity: Parameters<typeof createMessage>[2],
    ) => {
      assert.equal(id, room.id);
      const message = createMessage(room, input, identity);
      messages.push(message);
      return message;
    },
  };
  return { source, messages, store };
}
test('delegation proposal parser accepts one bounded strict delegate and rejects forged host fields', () => {
  assert.deepEqual(parseDelegationProposal(content), {
    to: 'cto',
    payload: { objective: 'Research options' },
  });
  for (const value of [
    'no-json',
    '[]',
    JSON.stringify({ version: 1, tool: 'a2a', type: 'request', to: 'cto', payload: {} }),
    JSON.stringify({
      version: 1,
      tool: 'a2a',
      type: 'delegate',
      to: 'cto',
      payload: {},
      from: 'other',
    }),
    JSON.stringify({ version: 1, tool: 'a2a', type: 'delegate', to: ' ', payload: {} }),
    ' '.repeat(65537),
  ])
    assert.throws(() => parseDelegationProposal(value));
});
test('adoption binds sender scope correlation time and original evidence with stable replay', () => {
  const f = fixture(),
    agents = { list: () => [chief, cto] };
  const first = adoptDelegationProposal(
    f.store,
    agents,
    {
      get: () => {
        throw Error('no Task');
      },
    },
    { roomId: 'r', messageId: 'proposal' },
  );
  assert.equal(first.from, 'chief');
  assert.equal(first.to, 'cto');
  assert.equal(first.type, 'delegate');
  assert.equal(first.taskId, null);
  assert.equal(first.createdAt, 'at');
  assert.equal(first.correlationId, first.id);
  assert.deepEqual(f.messages[1]?.metadata.proposalRef, 'org://rooms/r/messages/proposal');
  assert.deepEqual(
    adoptDelegationProposal(
      f.store,
      agents,
      { get: () => null },
      { roomId: 'r', messageId: 'proposal' },
    ),
    first,
  );
  assert.equal(f.messages.length, 2);
  assert.equal(f.messages[0]?.content, content);
});
test('adoption rejects non-Coordinator missing capability non-reporting target and conflicting replay before writes', () => {
  const f = fixture();
  for (const agents of [
    { list: () => [{ ...chief, capabilities: [] }, cto] },
    { list: () => [chief, { ...cto, reportsTo: 'other' }] },
  ])
    assert.throws(() =>
      adoptDelegationProposal(
        f.store,
        agents,
        { get: () => null },
        { roomId: 'r', messageId: 'proposal' },
      ),
    );
  assert.throws(() =>
    adoptDelegationProposal(
      { ...f.store, get: () => ({ ...room, coordinatorId: 'cto' }) },
      { list: () => [chief, cto] },
      { get: () => null },
      { roomId: 'r', messageId: 'proposal' },
    ),
  );
  assert.equal(f.messages.length, 1);
  adoptDelegationProposal(
    f.store,
    { list: () => [chief, cto] },
    { get: () => null },
    { roomId: 'r', messageId: 'proposal' },
  );
  const previous = f.messages[1];
  assert.ok(previous);
  f.messages[1] = { ...previous, metadata: { ...previous.metadata, proposalRef: 'forged' } };
  assert.throws(() =>
    adoptDelegationProposal(
      f.store,
      { list: () => [chief, cto] },
      { get: () => null },
      { roomId: 'r', messageId: 'proposal' },
    ),
  );
  assert.equal(f.messages.length, 2);
});
test('adoption propagates storage failure and only recovers an exactly matching concurrent insert', () => {
  const f = fixture(),
    agents = { list: () => [chief, cto] };
  assert.throws(
    () =>
      adoptDelegationProposal(
        {
          ...f.store,
          append: () => {
            throw Error('storage failed');
          },
        },
        agents,
        { get: () => null },
        { roomId: 'r', messageId: 'proposal' },
      ),
    /storage failed/,
  );
  const result = adoptDelegationProposal(
    {
      ...f.store,
      append: (id, input, identity) => {
        f.store.append(id, input, identity);
        throw Error('concurrent duplicate');
      },
    },
    agents,
    { get: () => null },
    { roomId: 'r', messageId: 'proposal' },
  );
  assert.equal(result.to, 'cto');
  assert.equal(f.messages.length, 2);
});
