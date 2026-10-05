import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { boundedContextBuilder } from '../src/context/builder.js';
import { createRoom, createMessage } from '../src/rooms/domain.js';
import { createMemory } from '../src/memory/domain.js';
test('pure ContextBuilder preserves source, omits future history, caps 30/20 and rejects oversized UTF-8 without changing originals', () => {
  const room = createRoom(
    {
      title: 'work',
      type: 'direct',
      participants: [
        { kind: 'agent', id: 'a' },
        { kind: 'human', id: 'h' },
      ],
    },
    { id: 'r', createdAt: '0' },
  );
  const messages = Array.from({ length: 40 }, (_, i) =>
    createMessage(
      room,
      { sender: { kind: 'human', id: 'h' }, content: 'message-' + i },
      { id: String(i), createdAt: String(i) },
    ),
  );
  const memories = Array.from({ length: 25 }, (_, i) =>
    createMemory(
      {
        type: 'semantic',
        scope: 'room:r',
        content: 'fact-' + i,
        confidence: 1,
        sourceRefs: [{ roomId: 'r', messageId: '0' }],
      },
      { id: 'm' + i, at: '0' },
    ),
  );
  const input = { instruction: 'role', room, messages, sourceMessageId: '35', memories };
  const context: unknown = JSON.parse(boundedContextBuilder.build(input));
  assert.ok(
    context &&
      typeof context === 'object' &&
      'messages' in context &&
      Array.isArray(context.messages) &&
      'memories' in context &&
      Array.isArray(context.memories) &&
      'omittedMessages' in context &&
      'omittedMemories' in context,
  );
  assert.equal(context.messages.length, 30);
  assert.equal(context.memories.length, 20);
  assert.equal(context.omittedMessages, 6);
  assert.equal(context.omittedMemories, 5);
  const history: readonly unknown[] = context.messages;
  const last = history.at(-1);
  assert.ok(last && typeof last === 'object' && 'id' in last);
  assert.equal(last.id, '35');
  assert.equal(messages.length, 40);
  assert.equal(memories.length, 25);
  assert.throws(() => boundedContextBuilder.build({ ...input, sourceMessageId: 'missing' }));
  const first = messages[0];
  assert.ok(first);
  assert.throws(() =>
    boundedContextBuilder.build({
      ...input,
      messages: [{ ...first, roomId: 'other' }, ...messages.slice(1)],
    }),
  );
  const source = messages[35];
  assert.ok(source);
  assert.throws(
    () =>
      boundedContextBuilder.build({
        ...input,
        messages: [{ ...source, content: '日'.repeat(22000) }],
      }),
    /64KiB/,
  );
  const bounded = boundedContextBuilder.build({
    ...input,
    memories: memories.map((m) => ({ ...m, content: '日'.repeat(2000) })),
  });
  assert.ok(new TextEncoder().encode(bounded).byteLength <= 65536);
});
