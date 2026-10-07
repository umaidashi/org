import type { MemoryEvidenceReaders } from '../src/memory/service.js';
import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { createRoom, createMessage } from '../src/rooms/domain.js';
import { createAgent } from '../src/agents/domain.js';
import type { Memory } from '../src/memory/domain.js';
import { jsonMemoryExtractor } from '../src/memory/extractor.js';
import { extractRoomMemories } from '../src/memory/extraction.js';

test('Memory extraction anchors typed candidates to prior Room history, validates before writes, deduplicates and never revives invalidation', async () => {
  const agent = createAgent(
    { name: 'a', role: 'memory', runtime: 'claude', capabilities: ['can_read', 'can_write'] },
    { id: 'a', createdAt: '0' },
  );
  let owner = agent;
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
  let active = room;
  const source = createMessage(
    room,
    { sender: { kind: 'human', id: 'h' }, content: 'テストを小さくする' },
    { id: 'source', createdAt: '1' },
  );
  const candidate = {
    type: 'procedural',
    content: 'テストを小さくする',
    confidence: 1,
    tags: ['testing'],
    entities: ['org'],
    importance: 0.9,
    sourceMessageIds: ['source'],
  };
  let proposal = createMessage(
    room,
    {
      sender: { kind: 'agent', id: 'a' },
      content: JSON.stringify({ version: 1, tool: 'memory', candidates: [candidate] }),
    },
    { id: 'proposal', createdAt: '2' },
  );
  const later = createMessage(
    room,
    { sender: { kind: 'human', id: 'h' }, content: 'future' },
    { id: 'future', createdAt: '3' },
  );
  const stored = new Map<string, Memory>();
  let writes = 0,
    extractions = 0;
  const run = (evidence?: MemoryEvidenceReaders) =>
    extractRoomMemories(
      { get: () => active, messages: () => [source, proposal, later] },
      { list: () => [owner] },
      {
        list: () => [...stored.values()],
        createOnce: (memory) => {
          writes++;
          const old = stored.get(memory.id);
          if (old) return old;
          stored.set(memory.id, memory);
          return memory;
        },
      },
      {
        extract: (content) => {
          extractions++;
          return jsonMemoryExtractor.extract(content);
        },
      },
      { roomId: 'r', messageId: proposal.id },
      evidence,
    );
  const valid = proposal;
  proposal = {
    ...valid,
    content: JSON.stringify({
      version: 1,
      tool: 'memory',
      candidates: [candidate, { ...candidate, sourceMessageIds: ['future'] }],
    }),
  };
  await assert.rejects(run);
  assert.equal(writes, 0);
  proposal = valid;
  owner = { ...agent, capabilities: ['can_read'] };
  await assert.rejects(run);
  assert.equal(writes, 0);
  owner = { ...agent, permissions: { rooms: [] } };
  const priorExtractions = extractions;
  await assert.rejects(run, /Room permission/);
  assert.equal(extractions, priorExtractions);
  assert.equal(writes, 0);
  owner = { ...agent, permissions: { rooms: ['r'] } };
  active = { ...room, archivedAt: 'closed' };
  await assert.rejects(run);
  active = room;
  const first = (await run())[0];
  assert.ok(first);
  assert.equal(first.scope, 'room:r');
  assert.deepEqual(first.tags, ['testing']);
  assert.deepEqual(first.entities, ['org']);
  assert.equal(first.importance, 0.9);
  assert.deepEqual(first.sourceRefs, [
    { roomId: 'r', messageId: 'source' },
    { roomId: 'r', messageId: 'proposal' },
  ]);
  assert.equal((await run())[0]?.id, first.id);
  assert.equal(stored.size, 1);
  stored.set(first.id, { ...first, status: 'invalidated' });
  assert.equal((await run())[0]?.status, 'invalidated');
  assert.equal(stored.size, 1);
  assert.equal(source.content, 'テストを小さくする');
  const beforeConflict = writes;
  proposal = {
    ...valid,
    content: JSON.stringify({
      version: 1,
      tool: 'memory',
      candidates: [
        { ...candidate, content: 'another fact' },
        { ...candidate, importance: 0.1 },
      ],
    }),
  };
  await assert.rejects(run, /metadata conflict/);
  assert.equal(writes, beforeConflict);
  assert.equal(stored.size, 1);
  proposal = {
    ...valid,
    content: JSON.stringify({
      version: 1,
      tool: 'memory',
      candidates: [
        { ...candidate, content: 'new duplicate' },
        { ...candidate, content: 'new duplicate', tags: ['changed'] },
      ],
    }),
  };
  await assert.rejects(run, /metadata conflict/);
  assert.equal(writes, beforeConflict);
  proposal = valid;
  for (const metadata of [
    { tags: 'testing' },
    { tags: [7] },
    { tags: [''] },
    { tags: ['x', 'x'] },
    { entities: null },
    { entities: [false] },
    { entities: ['x'.repeat(129)] },
    { tags: Array.from({ length: 33 }, (_, i) => String(i)) },
    { importance: 'high' },
    { importance: -0.1 },
    { importance: 1.1 },
  ]) {
    proposal = {
      ...valid,
      content: JSON.stringify({
        version: 1,
        tool: 'memory',
        candidates: [
          { ...candidate, content: 'another valid fact' },
          { ...candidate, ...metadata },
        ],
      }),
    };
    await assert.rejects(run);
    assert.equal(writes, beforeConflict);
  }
  const artifactUri = 'org://artifacts/' + 'a'.repeat(64);
  proposal = {
    ...valid,
    id: 'evidence',
    content: JSON.stringify({
      version: 1,
      tool: 'memory',
      candidates: [
        { ...candidate, content: 'external fact', sourceUris: [artifactUri] },
        { ...candidate, content: 'missing fact', sourceUris: ['org://events/missing'] },
      ],
    }),
  };
  let reads = 0;
  await assert.rejects(
    () =>
      run({
        readArtifact: async () => {
          reads++;
          return 'bytes';
        },
        events: {
          get: () => {
            throw new Error('missing evidence');
          },
        },
      }),
    /missing evidence/,
  );
  assert.equal(reads, 1);
  assert.equal(writes, beforeConflict);
  proposal = {
    ...proposal,
    content: JSON.stringify({
      version: 1,
      tool: 'memory',
      candidates: [{ ...candidate, content: 'external fact', sourceUris: [artifactUri] }],
    }),
  };
  await assert.rejects(() => run(), /Artifact reader required/);
  for (const change of ['archive', 'capability', 'snapshot', 'permissions']) {
    const { promise, resolve } = Promise.withResolvers<string>();
    const { promise: entered, resolve: mark } = Promise.withResolvers<void>();
    const pending = run({
      readArtifact: () => {
        mark();
        return promise;
      },
    });
    await entered;
    if (change === 'archive') active = { ...room, archivedAt: 'closed' };
    else if (change === 'capability') owner = { ...agent, capabilities: [] };
    else if (change === 'permissions') owner = { ...agent, permissions: { rooms: [] } };
    else stored.set(first.id, { ...first, status: 'active' });
    resolve('verified bytes');
    await assert.rejects(() => pending, change === 'permissions' ? /Room permission/ : /.+/);
    assert.equal(writes, beforeConflict);
    active = room;
    owner = agent;
    stored.set(first.id, { ...first, status: 'invalidated' });
  }
  proposal = valid;
  for (const value of [
    { version: 1, tool: 'memory', candidates: [{ ...candidate, scope: 'global' }] },
    { version: 2, tool: 'memory', candidates: [candidate] },
    { version: 1, tool: 'memory', candidates: [] },
  ])
    assert.throws(() => jsonMemoryExtractor.extract(JSON.stringify(value)));
});

test('Memory JSON extractor bounds unknown input and accepts all four typed candidate kinds', () => {
  for (const content of [
    'not-json',
    JSON.stringify({
      version: 1,
      tool: 'memory',
      candidates: [{ type: 'semantic', content: 'fact', confidence: 2, sourceMessageIds: ['m'] }],
    }),
    JSON.stringify({
      version: 1,
      tool: 'memory',
      candidates: [
        { type: 'semantic', content: 'fact', confidence: 1, sourceMessageIds: ['m', 'm'] },
      ],
    }),
    ' '.repeat(65537),
  ])
    assert.throws(() => jsonMemoryExtractor.extract(content));
  assert.deepEqual(
    jsonMemoryExtractor
      .extract(
        JSON.stringify({
          version: 1,
          tool: 'memory',
          candidates: ['semantic', 'episodic', 'procedural', 'relational'].map((type) => ({
            type,
            content: 'fact',
            confidence: 0.8,
            sourceMessageIds: ['m'],
          })),
        }),
      )
      .map((c) => c.type),
    ['semantic', 'episodic', 'procedural', 'relational'],
  );
});

test('Memory URI candidates reject malformed or NUL-bearing canonical evidence before lookup', () => {
  const decode = (sourceUris: unknown) =>
    jsonMemoryExtractor.extract(
      JSON.stringify({
        version: 1,
        tool: 'memory',
        candidates: [
          { type: 'semantic', content: 'fact', confidence: 1, sourceMessageIds: ['m'], sourceUris },
        ],
      }),
    );
  for (const uris of [
    ['org://events/%00'],
    ['org://tasks/task/reviews/%00'],
    ['https://example.invalid/evidence'],
    ['org://approvals/pending'],
    ['org://artifacts/' + 'A'.repeat(64)],
    ['org://events/%'],
    ['org://events/a', 'org://events/a'],
    [7],
    'org://events/a',
    Array(21).fill('org://events/a'),
    ['x'.repeat(2049)],
  ])
    assert.throws(() => decode(uris));
});
