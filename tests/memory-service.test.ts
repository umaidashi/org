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

test('Memory capture validates immutable Task review evidence through injected readers before saving', () => {
  const input = {
    type: 'episodic' as const,
    scope: 'task:a2a:source',
    content: 'Reviewed result',
    confidence: 1,
    sourceRefs: [{ uri: 'org://tasks/a2a%3Asource/reviews/review' }],
  };
  let saved = 0;
  const provider = {
    create: (memory: Memory) => {
      saved++;
      return memory;
    },
  };
  const task = {
    id: 'a2a:source',
    title: 'Reviewed',
    objective: 'Done',
    kind: 'execution_task' as const,
    status: 'completed' as const,
    version: 5,
    owner: 'a',
    parentId: null,
    dependencies: [],
    priority: 0,
    labels: [],
    inputArtifacts: [],
    externalRef: null,
    outputArtifacts: ['out'],
    createdAt: 'now',
    updatedAt: 'now',
  };
  const review = {
    id: 'review',
    taskId: task.id,
    taskVersion: 4,
    outputArtifacts: ['out'],
    decision: 'approve' as const,
    actor: 'founder',
    reason: 'Checked',
    createdAt: 'now',
  };
  const tasks = { get: () => task, reviews: () => [review] };
  const memory = captureMemory(provider, undefined, input, { id: 'memory', at: 'now' }, tasks);
  assert.deepEqual(memory.sourceRefs, input.sourceRefs);
  assert.equal(saved, 1);
  for (const refs of [
    [{ uri: 'org://tasks/a2a%3Asource/reviews/absent' }],
    [{ uri: 'https://example.invalid/review' }],
    [{ uri: 'org://tasks/a2a%3asource/reviews/review' }],
    [{ uri: 'org://tasks/a2a%3Asource/reviews/review', roomId: 'r', messageId: 'm' }],
  ])
    assert.throws(() =>
      captureMemory(
        provider,
        undefined,
        { ...input, sourceRefs: refs },
        { id: 'bad', at: 'now' },
        tasks,
      ),
    );
  assert.throws(() => captureMemory(provider, undefined, input, { id: 'bad', at: 'now' }));
  assert.throws(() =>
    captureMemory(
      provider,
      undefined,
      input,
      { id: 'bad', at: 'now' },
      { ...tasks, reviews: () => [{ ...review, taskId: 'foreign' }] },
    ),
  );
  assert.equal(saved, 1);
});
