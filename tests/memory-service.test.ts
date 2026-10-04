import type { Memory } from '../src/memory/domain.js';
import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { captureMemory } from '../src/memory/service.js';
import { createRoom, createMessage } from '../src/rooms/domain.js';
test('Memory capture verifies original Message references through injected ports before saving', () => {
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
  const message = createMessage(
    room,
    { sender: { kind: 'human', id: 'h' }, content: 'source' },
    { id: 'm', createdAt: 'now' },
  );
  let saved = 0;
  const provider = {
    create: (memory: Memory) => {
      saved++;
      return memory;
    },
  };
  const rooms = { get: () => room, messages: () => [message] };
  const input = {
    type: 'procedural' as const,
    scope: 'agent:a',
    content: 'practice',
    confidence: 0.8,
    sourceRefs: [{ roomId: 'r', messageId: 'm' }],
  };
  captureMemory(provider, rooms, input, { id: 'one', at: 'now' });
  assert.equal(saved, 1);
  assert.throws(() =>
    captureMemory(
      provider,
      rooms,
      { ...input, sourceRefs: [{ roomId: 'r', messageId: 'absent' }] },
      { id: 'two', at: 'now' },
    ),
  );
  assert.equal(saved, 1);
  assert.equal(message.content, 'source');
});
