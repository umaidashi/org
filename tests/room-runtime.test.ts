import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { replyToRoomMessage } from '../src/rooms/runtime.js';
import { createRoom, createMessage } from '../src/rooms/domain.js';
import { createSession } from '../src/sessions/domain.js';
test('Room runtime uses history through the source and persists an Agent reply only after success', async () => {
  const room = createRoom(
    {
      title: 'work',
      type: 'direct',
      participants: [
        { kind: 'human', id: 'h' },
        { kind: 'agent', id: 'a' },
      ],
    },
    { id: 'r', createdAt: 'now' },
  );
  const session = createSession(
    { agentId: 'a', roomId: 'r', runtime: 'codex' },
    { id: 's', at: 'now' },
  );
  const messages = [
    createMessage(
      room,
      { sender: { kind: 'human', id: 'h' }, content: 'prior' },
      { id: 'before', createdAt: 'now' },
    ),
    createMessage(
      room,
      { sender: { kind: 'human', id: 'h' }, content: 'question' },
      { id: 'source', createdAt: 'now' },
    ),
    createMessage(
      room,
      { sender: { kind: 'human', id: 'h' }, content: 'future' },
      { id: 'future', createdAt: 'now' },
    ),
  ];
  let calls = 0;
  const rooms = {
    get: () => room,
    messages: () => messages,
    append: (
      _id: string,
      input: Parameters<typeof createMessage>[1],
      identity: Parameters<typeof createMessage>[2],
    ) => {
      const reply = createMessage(
        room,
        input,
        identity,
        messages.find((m) => m.id === input.replyTo),
      );
      messages.push(reply);
      return reply;
    },
  };
  const send = async (_id: string, message: string, instruction: string) => {
    calls++;
    assert.equal(message, 'question');
    if (instruction === undefined) throw new Error('Context missing');
    const context: unknown = JSON.parse(instruction);
    assert.ok(
      context !== null &&
        typeof context === 'object' &&
        'messages' in context &&
        Array.isArray(context.messages),
    );
    assert.deepEqual(
      context.messages.map((m: unknown) => {
        assert.ok(m !== null && typeof m === 'object' && 'content' in m);
        return m.content;
      }),
      ['prior', 'question'],
    );
    return { session, text: 'answer' };
  };
  const reply = await replyToRoomMessage(
    rooms,
    { get: () => session },
    { send },
    { sessionId: 's', messageId: 'source', instruction: '' },
    { id: 'reply', at: 'later' },
  );
  assert.equal(reply.replyTo, 'source');
  assert.equal(reply.sender.id, 'a');
  assert.equal(reply.content, 'answer');
  assert.equal(
    (
      await replyToRoomMessage(
        rooms,
        { get: () => session },
        { send },
        { sessionId: 's', messageId: 'source', instruction: '' },
        { id: 'unused', at: 'later' },
      )
    ).id,
    'reply',
  );
  assert.equal(calls, 1);
  await assert.rejects(
    replyToRoomMessage(
      rooms,
      { get: () => ({ ...session, roomId: 'other' }) },
      { send },
      { sessionId: 's', messageId: 'source', instruction: '' },
      { id: 'bad', at: 'later' },
    ),
  );
  const count = messages.length;
  await assert.rejects(
    replyToRoomMessage(
      rooms,
      { get: () => session },
      {
        send: async () => {
          throw new Error('provider failure');
        },
      },
      { sessionId: 's', messageId: 'before', instruction: '' },
      { id: 'failure', at: 'later' },
    ),
  );
  assert.equal(messages.length, count);
});

test('Room context bounds UTF-8 bytes and reports omitted history, rejecting oversized sources before runtime', async () => {
  const room = createRoom(
    {
      title: 'work',
      type: 'direct',
      participants: [
        { kind: 'human', id: 'h' },
        { kind: 'agent', id: 'a' },
      ],
    },
    { id: 'r', createdAt: 'now' },
  );
  const session = createSession(
    { agentId: 'a', roomId: 'r', runtime: 'codex' },
    { id: 's', at: 'now' },
  );
  const messages = Array.from({ length: 40 }, (_, i) =>
    createMessage(
      room,
      { sender: { kind: 'human', id: 'h' }, content: '会'.repeat(10000) },
      { id: String(i), createdAt: 'now' },
    ),
  );
  let calls = 0;
  const rooms = {
    get: () => room,
    messages: () => messages,
    append: (
      _id: string,
      input: Parameters<typeof createMessage>[1],
      identity: Parameters<typeof createMessage>[2],
    ) =>
      createMessage(
        room,
        input,
        identity,
        messages.find((m) => m.id === input.replyTo),
      ),
  };
  const send = async (_id: string, _message: string, instruction: string) => {
    calls++;
    assert.ok(new TextEncoder().encode(instruction).byteLength <= 65536);
    if (instruction === undefined) throw new Error('Context missing');
    const context: unknown = JSON.parse(instruction);
    assert.ok(
      context !== null &&
        typeof context === 'object' &&
        'omittedMessages' in context &&
        'messages' in context &&
        Array.isArray(context.messages),
    );
    assert.equal(context.omittedMessages, 38);
    assert.equal(context.messages.length, 2);
    return { session, text: 'bounded' };
  };
  await replyToRoomMessage(
    rooms,
    { get: () => session },
    { send },
    { sessionId: 's', messageId: '39', instruction: '' },
    { id: 'reply', at: 'later' },
  );
  messages.push(
    createMessage(
      room,
      { sender: { kind: 'human', id: 'h' }, content: '会'.repeat(22000) },
      { id: 'oversized', createdAt: 'now' },
    ),
  );
  await assert.rejects(
    replyToRoomMessage(
      rooms,
      { get: () => session },
      { send },
      { sessionId: 's', messageId: 'oversized', instruction: '' },
      { id: 'bad', at: 'later' },
    ),
  );
  assert.equal(calls, 1);
});

test('Room context includes only active current scopes and excludes another Agent or Room Memory', async () => {
  const room = createRoom(
    {
      title: 'work',
      type: 'direct',
      participants: [
        { kind: 'human', id: 'h' },
        { kind: 'agent', id: 'a' },
      ],
    },
    { id: 'r', createdAt: 'now' },
  );
  const session = createSession(
    { agentId: 'a', roomId: 'r', runtime: 'codex' },
    { id: 's', at: 'now' },
  );
  const source = createMessage(
    room,
    { sender: { kind: 'human', id: 'h' }, content: 'question' },
    { id: 'm', createdAt: 'now' },
  );
  const rooms = {
    get: () => room,
    messages: () => [source],
    append: (
      _id: string,
      input: Parameters<typeof createMessage>[1],
      identity: Parameters<typeof createMessage>[2],
    ) => createMessage(room, input, identity, source),
  };
  const entry = (id: string, scope: string, status: 'active' | 'invalidated') => ({
    id,
    scope,
    status,
    type: 'semantic' as const,
    content: id,
    confidence: 1,
    sourceRefs: [{ roomId: 'r', messageId: 'm' }],
    supersedes: null,
    createdAt: 'now',
  });
  const memory = {
    list: () => [
      entry('global', 'global', 'active'),
      entry('agent', 'agent:a', 'active'),
      entry('foreignAgent', 'agent:other', 'active'),
      {
        ...entry('room', 'room:r', 'active'),
        tags: ['question'],
        entities: ['org'],
        importance: 0.8,
      },
      entry('invalid', 'room:r', 'invalidated'),
      entry('foreignRoom', 'room:other', 'active'),
      { ...entry('expired', 'room:r', 'active'), validUntil: 100 },
      { ...entry('future', 'room:r', 'active'), validFrom: 200 },
    ],
  };
  await replyToRoomMessage(
    rooms,
    { get: () => session },
    {
      send: async (_id, _message, instruction) => {
        if (instruction === undefined) throw new Error('Context missing');
        const context: unknown = JSON.parse(instruction);
        assert.ok(
          context !== null &&
            typeof context === 'object' &&
            'memories' in context &&
            Array.isArray(context.memories),
        );
        const ids = context.memories.map((m: unknown) => {
          assert.ok(m !== null && typeof m === 'object' && 'id' in m);
          return m.id;
        });
        assert.deepEqual(ids, ['room', 'agent', 'global']);
        const first: unknown = context.memories[0];
        assert.ok(
          first !== null &&
            typeof first === 'object' &&
            'tags' in first &&
            'entities' in first &&
            'importance' in first,
        );
        assert.deepEqual(first.tags, ['question']);
        assert.deepEqual(first.entities, ['org']);
        assert.equal(first.importance, 0.8);
        return { session, text: 'answer' };
      },
    },
    { sessionId: 's', messageId: 'm', instruction: '' },
    { id: 'reply', at: '1970-01-01T00:00:00.150Z' },
    memory,
  );
});
