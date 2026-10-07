import type { Memory } from '../src/memory/domain.js';
import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { captureMemory } from '../src/memory/service.js';
import { createRoom, createMessage } from '../src/rooms/domain.js';
import { parseMemoryCommand } from '../src/memory/cli.js';
test('Memory Artifact capture awaits its injected verified reader and refuses missing or failed evidence', async () => {
  const uri = 'org://artifacts/' + 'a'.repeat(64);
  const input = {
    type: 'episodic' as const,
    scope: 'company',
    content: 'Artifact observed',
    confidence: 1,
    sourceRefs: [{ uri }],
  };
  let saved = 0;
  const provider = {
    create: (memory: Memory) => {
      saved++;
      return memory;
    },
  };
  const capture = (read?: (uri: string) => Promise<string>) =>
    captureMemory(
      provider,
      undefined,
      input,
      { id: 'memory', at: 'now' },
      undefined,
      undefined,
      read,
    );
  await assert.rejects(() => capture(), /Artifact reader required/);
  await assert.rejects(
    () =>
      capture(async () => {
        throw new Error('read failed');
      }),
    /read failed/,
  );
  assert.equal(saved, 0);
  const { promise, resolve } = Promise.withResolvers<string>();
  const pending = capture((requested) => {
    assert.equal(requested, uri);
    return promise;
  });
  assert.equal(saved, 0);
  resolve('verified bytes');
  assert.deepEqual((await pending).sourceRefs, input.sourceRefs);
  assert.equal(saved, 1);
  await assert.rejects(
    () =>
      captureMemory(
        {
          create: () => {
            throw new Error('write failed');
          },
        },
        undefined,
        input,
        { id: 'memory', at: 'now' },
        undefined,
        undefined,
        async () => 'verified bytes',
      ),
    /write failed/,
  );
  const args = [
    'memory',
    'capture',
    '--type',
    'episodic',
    '--scope',
    'company',
    '--content',
    'Artifact observed',
    '--confidence',
    '1',
    '--source-artifact',
    uri,
  ];
  for (const bad of [
    uri + '\n',
    uri + '?query',
    uri.replace('a'.repeat(64), 'A'.repeat(64)),
    'org://events/event',
  ])
    assert.throws(() => parseMemoryCommand([...args.slice(0, -1), bad]));
});
test('Memory capture verifies original Message references through injected ports before saving', async () => {
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
  await captureMemory(provider, rooms, input, { id: 'one', at: 'now' });
  assert.equal(saved, 1);
  await assert.rejects(() =>
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

test('Memory Event evidence requires a canonical existing original before writing', async () => {
  const uri = 'org://events/event%3A%E6%97%A5%E6%9C%AC';
  const input = {
    type: 'episodic' as const,
    scope: 'company',
    content: 'Event observed',
    confidence: 1,
    sourceRefs: [{ uri }],
  };
  const event = {
    id: 'event:日本',
    type: 'task.completed',
    source: 'test',
    payload: {},
    createdAt: 'now',
  };
  let saved = 0;
  const provider = {
    create: (memory: Memory) => {
      saved++;
      return memory;
    },
  };
  const capture = (uri: string, events?: { get(id: string): typeof event }) =>
    captureMemory(
      provider,
      undefined,
      { ...input, sourceRefs: [{ uri }] },
      { id: 'memory', at: 'now' },
      undefined,
      events,
    );
  for (const uri of [
    'org://events/',
    'org://events/%20',
    'org://events/event%3a%E6%97%A5%E6%9C%AC',
    'org://events/%',
    'org://events/one/two',
    'https://example.invalid/event',
  ])
    await assert.rejects(() => capture(uri, { get: () => event }));
  await assert.rejects(() => capture(uri));
  await assert.rejects(() => capture(uri, { get: () => ({ ...event, id: 'foreign' }) }));
  await assert.rejects(
    () =>
      capture(uri, {
        get: () => {
          throw new Error('read failed');
        },
      }),
    /read failed/,
  );
  assert.equal(saved, 0);
  const memory = await capture(uri, {
    get: (id) => {
      assert.equal(id, event.id);
      return event;
    },
  });
  assert.deepEqual(memory.sourceRefs, input.sourceRefs);
  assert.equal(saved, 1);
  await assert.rejects(
    () =>
      captureMemory(
        {
          create: () => {
            throw new Error('write failed');
          },
        },
        undefined,
        input,
        { id: 'memory', at: 'now' },
        undefined,
        { get: () => event },
      ),
    /write failed/,
  );
  const args = [
    'memory',
    'capture',
    '--type',
    'episodic',
    '--scope',
    'company',
    '--content',
    'Event observed',
    '--confidence',
    '1',
    '--source-event',
    event.id,
  ];
  const command = parseMemoryCommand(args);
  assert.equal(command.action, 'capture');
  assert.ok(command.action === 'capture');
  assert.deepEqual(command.input.sourceRefs, input.sourceRefs);
  assert.throws(() => parseMemoryCommand([...args.slice(0, -2), '--source-review', uri]));
  for (const extra of [
    ['--source-review', 'org://tasks/t/reviews/r'],
    ['--room', 'r'],
    ['--message', 'm'],
  ])
    assert.throws(() => parseMemoryCommand([...args, ...extra]));
});

test('Memory capture validates immutable Task review evidence through injected readers before saving', async () => {
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
  const memory = await captureMemory(
    provider,
    undefined,
    input,
    { id: 'memory', at: 'now' },
    tasks,
  );
  assert.deepEqual(memory.sourceRefs, input.sourceRefs);
  assert.equal(saved, 1);
  for (const refs of [
    [{ uri: 'org://tasks/a2a%3Asource/reviews/absent' }],
    [{ uri: 'https://example.invalid/review' }],
    [{ uri: 'org://tasks/a2a%3asource/reviews/review' }],
    [{ uri: 'org://tasks/a2a%3Asource/reviews/review', roomId: 'r', messageId: 'm' }],
  ])
    await assert.rejects(() =>
      captureMemory(
        provider,
        undefined,
        { ...input, sourceRefs: refs },
        { id: 'bad', at: 'now' },
        tasks,
      ),
    );
  await assert.rejects(() => captureMemory(provider, undefined, input, { id: 'bad', at: 'now' }));
  await assert.rejects(() =>
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
