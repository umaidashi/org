import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { extractRoomReplyMemories } from '../src/memory/extraction.js';
import { jsonMemoryExtractor } from '../src/memory/extractor.js';
import { createRoom, createMessage } from '../src/rooms/domain.js';
import { createAgent } from '../src/agents/domain.js';
import type { Message } from '../src/rooms/domain.js';
import type { Memory } from '../src/memory/domain.js';
const room = createRoom(
  {
    title: 'Memory',
    type: 'direct',
    participants: [
      { kind: 'human', id: 'h' },
      { kind: 'agent', id: 'a' },
    ],
  },
  { id: 'r', createdAt: '0' },
);
const source = createMessage(
  room,
  { sender: { kind: 'human', id: 'h' }, content: '先にテスト' },
  { id: 'source', createdAt: '1' },
);
const agent = createAgent(
  { name: 'a', role: 'memory', runtime: 'codex', capabilities: ['can_read', 'can_write'] },
  { id: 'a', createdAt: '0' },
);
const reply = createMessage(
  room,
  {
    sender: { kind: 'agent', id: 'a' },
    replyTo: source.id,
    content: JSON.stringify({
      version: 1,
      tool: 'memory',
      candidates: [
        { type: 'procedural', content: '先にテスト', confidence: 1, sourceMessageIds: [source.id] },
      ],
    }),
  },
  { id: 'reply', createdAt: '2' },
  source,
);
test('automatic Memory adoption selects human-linked original only and reuses strict scoped evidence and replay', async () => {
  const stored = new Map<string, Memory>();
  let messages: readonly Message[] = [source, reply];
  let owner = agent;
  const run = (sourceId = source.id, replies = [reply.id]) =>
    extractRoomReplyMemories(
      { get: () => room, messages: () => messages },
      { list: () => [owner] },
      {
        list: () => [...stored.values()],
        createOnce: (m) => {
          stored.set(m.id, m);
          return m;
        },
      },
      jsonMemoryExtractor,
      'r',
      sourceId,
      replies,
    );
  messages = [source, { ...reply, content: 'ordinary text' }];
  assert.deepEqual(await run(), []);
  assert.equal(stored.size, 0);
  messages = [source, { ...reply, roomId: 'foreign' }];
  assert.deepEqual(await run(), []);
  messages = [source, { ...reply, metadata: { a2a: {} } }];
  assert.deepEqual(await run(), []);
  messages = [source, { ...reply, replyTo: null }];
  assert.deepEqual(await run(), []);
  messages = [source, reply];
  assert.deepEqual(await run(reply.id), []);
  owner = { ...agent, capabilities: ['can_read'] };
  await assert.rejects(() => run());
  assert.equal(stored.size, 0);
  owner = agent;
  const result = await run();
  assert.equal(result.length, 1);
  assert.equal(result[0]?.scope, 'room:r');
  assert.deepEqual(await run(), result);
  assert.equal(stored.size, 1);
});
test('automatic Memory adoption refuses ambiguous proposals before any writes', async () => {
  let writes = 0;
  await assert.rejects(
    () =>
      extractRoomReplyMemories(
        { get: () => room, messages: () => [source, reply, { ...reply, id: 'other' }] },
        { list: () => [agent] },
        {
          list: () => [],
          createOnce: (m) => {
            writes++;
            return m;
          },
        },
        jsonMemoryExtractor,
        'r',
        source.id,
        [reply.id, 'other'],
      ),
    /Ambiguous/,
  );
  assert.equal(writes, 0);
});
