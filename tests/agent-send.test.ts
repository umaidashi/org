import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { createAgent } from '../src/agents/domain.js';
import { sendAgentMessage } from '../src/agents/send.js';
import { createMessage, createRoom } from '../src/rooms/domain.js';
import { parseApplicationCommand } from '../src/application/cli.js';

test('Agent send uses one explicit human Message and refuses missing targets or Room authority before writing', () => {
  const agent = createAgent(
    { name: 'Worker', role: 'worker', runtime: 'codex' },
    { id: 'agent', createdAt: '0' },
  );
  const room = createRoom(
    {
      title: 'Direct',
      type: 'direct',
      participants: [
        { kind: 'human', id: 'human' },
        { kind: 'agent', id: agent.id },
      ],
    },
    { id: 'room', createdAt: '0' },
  );
  const input = { agentId: agent.id, roomId: room.id, humanId: 'human', content: 'Question' };
  const identity = { id: 'message', createdAt: '1' };
  let writes = 0;
  const rooms = {
    get: () => room,
    append: (
      id: string,
      value: Parameters<typeof createMessage>[1],
      at: Parameters<typeof createMessage>[2],
    ) => {
      writes++;
      assert.equal(id, room.id);
      return createMessage(room, value, at);
    },
  };
  for (const value of [
    { ...input, agentId: 'missing' },
    { ...input, humanId: 'outsider' },
    { ...input, content: ' ' },
  ])
    assert.throws(() => sendAgentMessage({ list: () => [agent] }, rooms, value, identity));
  for (const invalid of [
    { ...room, id: 'wrong' },
    { ...room, archivedAt: '1' },
    { ...room, participants: [{ kind: 'human' as const, id: 'human' }] },
  ])
    assert.throws(() =>
      sendAgentMessage({ list: () => [agent] }, { ...rooms, get: () => invalid }, input, identity),
    );
  assert.equal(writes, 0);
  assert.throws(
    () =>
      sendAgentMessage(
        { list: () => [agent] },
        {
          ...rooms,
          get: () => {
            throw new Error('read failure');
          },
        },
        input,
        identity,
      ),
    /read failure/,
  );
  const message = sendAgentMessage({ list: () => [agent] }, rooms, input, identity);
  assert.equal(writes, 1);
  assert.equal(message.id, identity.id);
  assert.equal(message.roomId, room.id);
  assert.deepEqual(message.sender, { kind: 'human', id: 'human' });
  assert.deepEqual(message.metadata, { mentions: [agent.id] });
  assert.equal(message.content, input.content);
  assert.throws(
    () =>
      sendAgentMessage(
        { list: () => [agent] },
        {
          ...rooms,
          append: () => {
            throw new Error('write failure');
          },
        },
        input,
        identity,
      ),
    /write failure/,
  );
});

test('Agent send parser requires explicit identity and Room and rejects unrelated or extra options', () => {
  const args = [
    'agent',
    'send',
    'agent',
    'Question',
    '--room',
    'room',
    '--human',
    'human',
    '--db',
    'fixture.db',
  ];
  assert.deepEqual(parseApplicationCommand(args), {
    kind: 'agent-send',
    db: 'fixture.db',
    input: { agentId: 'agent', roomId: 'room', humanId: 'human', content: 'Question' },
    json: false,
  });
  for (const invalid of [
    args.slice(0, 4),
    [...args, 'extra'],
    [...args, '--role', 'worker'],
    ['agent', 'send', 'agent', ' ', '--room', 'room', '--human', 'human'],
    ['agent', 'create', 'Agent', '--role', 'worker', '--runtime', 'codex', '--human', 'human'],
  ])
    assert.throws(() => parseApplicationCommand(invalid));
});
