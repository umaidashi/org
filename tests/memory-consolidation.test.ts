import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { createMemory } from '../src/memory/domain.js';
import { planMemoryConsolidation, consolidateRoomMemories } from '../src/memory/consolidation.js';
import { createRoom } from '../src/rooms/domain.js';
test('conservative consolidation selects only same-scope valid exact metadata and validates Room before atomic Port commit', () => {
  const entry = (id: string, scope = 'room:r') =>
    createMemory(
      {
        type: 'semantic',
        scope,
        content: 'fact',
        confidence: 1,
        sourceRefs: [{ roomId: 'r', messageId: id }],
      },
      { id, at: '2026-10-01T00:00:00.000Z' },
    );
  const keeper = entry('a'),
    duplicate = entry('b');
  const records = [
    duplicate,
    entry('foreign', 'room:other'),
    { ...entry('expired'), validUntil: 1 },
    { ...entry('tagged'), tags: ['different'] },
    { ...entry('procedural'), type: 'procedural' as const },
    { ...entry('invalid'), status: 'invalidated' as const },
    keeper,
  ];
  const request = { scope: 'room:r', key: 'first', at: '2026-10-06T00:00:00.000Z' };
  const plan = planMemoryConsolidation(records, request);
  assert.equal(plan.duplicates.length, 1);
  assert.equal(plan.duplicates[0]?.keeper.id, 'a');
  assert.equal(plan.duplicates[0]?.obsolete.id, 'b');
  assert.equal(records[0], duplicate);
  const room = createRoom(
    {
      title: 'work',
      type: 'direct',
      participants: [
        { kind: 'human', id: 'h' },
        { kind: 'agent', id: 'a' },
      ],
    },
    { id: 'r', createdAt: '0' },
  );
  let active = room,
    commits = 0;
  const receipt = { ...request, keepers: ['a'], invalidated: ['b'] };
  const store = {
    getConsolidation: () => null,
    commitConsolidation: (input: typeof plan) => {
      commits++;
      assert.deepEqual(input, plan);
      return receipt;
    },
  };
  assert.deepEqual(
    consolidateRoomMemories({ get: () => active }, { list: () => records }, store, request),
    receipt,
  );
  assert.equal(commits, 1);
  active = { ...room, archivedAt: 'closed' };
  assert.throws(() =>
    consolidateRoomMemories({ get: () => active }, { list: () => records }, store, request),
  );
  assert.equal(commits, 1);
  active = room;
  assert.deepEqual(
    consolidateRoomMemories(
      { get: () => active },
      {
        list: () => {
          throw new Error('Do not rescan');
        },
      },
      { ...store, getConsolidation: () => receipt },
      { ...request, at: '2026-10-07T00:00:00.000Z' },
    ),
    receipt,
  );
  assert.throws(() => planMemoryConsolidation(records, { ...request, scope: 'company' }));
});
