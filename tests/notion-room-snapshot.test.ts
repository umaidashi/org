import { boundedContextBuilder } from '../src/context/builder.js';
import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { importNotionSnapshot } from '../src/knowledge/snapshot.js';
import type { Room, MessageInput, Identity } from '../src/rooms/domain.js';
const room: Room = {
  id: 'r',
  title: 'Room',
  type: 'direct',
  activationPolicy: 'mention_only',
  participants: [
    { kind: 'human', id: 'h' },
    { kind: 'agent', id: 'a' },
  ],
  taskId: null,
  createdAt: '2026-10-06T00:00:00Z',
  archivedAt: null,
};
test('Notion snapshot checks active participant before read and never appends failed reads', async () => {
  let reads = 0,
    appends = 0;
  const read = async () => {
    reads++;
    throw Error('read failed');
  };
  const repository = {
    get: () => room,
    append: () => {
      appends++;
      throw Error('unexpected append');
    },
  };
  await assert.rejects(() =>
    importNotionSnapshot(repository, read, 'r', 'outsider', { id: 'm', createdAt: room.createdAt }),
  );
  await assert.rejects(() =>
    importNotionSnapshot(
      { ...repository, get: () => ({ ...room, archivedAt: room.createdAt }) },
      read,
      'r',
      'h',
      { id: 'm', createdAt: room.createdAt },
    ),
  );
  assert.equal(reads, 0);
  await assert.rejects(
    () => importNotionSnapshot(repository, read, 'r', 'h', { id: 'm', createdAt: room.createdAt }),
    /read failed/,
  );
  assert.equal(reads, 1);
  assert.equal(appends, 0);
});
test('Notion snapshot retains content and provenance in immutable Room message', async () => {
  const doc = {
    provider: 'notion' as const,
    id: 'page',
    url: 'https://www.notion.so/page',
    content: '# 日本語',
    contentHash: 'hash',
  };
  const identity = { id: 'm', createdAt: room.createdAt };
  const result = await importNotionSnapshot(
    {
      get: () => room,
      append: (roomId: string, input: MessageInput, given: Identity) => {
        assert.equal(roomId, 'r');
        assert.deepEqual(given, identity);
        return { ...given, roomId, ...input, replyTo: null, metadata: input.metadata ?? {} };
      },
    },
    async () => doc,
    'r',
    'h',
    identity,
  );
  const context = boundedContextBuilder.build({
    room,
    messages: [result],
    memories: [],
    sourceMessageId: result.id,
    instruction: 'Read knowledge',
  });
  assert.ok(context.includes(doc.url));
  assert.ok(context.includes(doc.contentHash));
  assert.equal(result.sender.kind, 'human');
  assert.equal(result.sender.id, 'h');
  assert.ok(result.content.endsWith(doc.content));
  assert.ok(result.content.includes(doc.url));
  assert.ok(result.content.includes(doc.contentHash));
  assert.deepEqual(result.metadata, {
    knowledge: { provider: 'notion', id: 'page', url: doc.url, contentHash: 'hash' },
  });
});
