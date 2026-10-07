import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { createMemory } from '../src/memory/domain.js';
import {
  planMemoryConsolidation,
  consolidateRoomMemories,
  consolidationScopeAvailable,
  consolidateMemories,
} from '../src/memory/consolidation.js';
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
    { ...entry('expired-copy'), validUntil: 1 },
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
  assert.throws(() => planMemoryConsolidation(records, { ...request, scope: 'unknown' }));
});

test('Memory domain rejects NUL scope for all callers', () => {
  assert.throws(
    () =>
      createMemory(
        {
          type: 'semantic',
          scope: 'department:eng\0',
          content: 'fact',
          confidence: 1,
          sourceRefs: [{ roomId: 'r', messageId: 'm' }],
        },
        { id: 'm', at: '0' },
      ),
    /scope/,
  );
});

test('all scopes retain non-equivalent, inactive and out-of-period Memory and recheck authority at commit', () => {
  for (const scope of [
    'global',
    'company',
    'department:eng',
    'project:p',
    'agent:a',
    'task:t',
    'room:r',
  ]) {
    const entry = (id: string) =>
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
    const records = [
      entry('a'),
      entry('b'),
      { ...entry('type'), type: 'episodic' as const },
      { ...entry('content'), content: 'different' },
      { ...entry('confidence'), confidence: 0.5 },
      { ...entry('from'), validFrom: 1 },
      { ...entry('until'), validUntil: Date.parse('2027-01-01') },
      { ...entry('tag'), tags: ['x'] },
      { ...entry('entity'), entities: ['x'] },
      { ...entry('importance'), importance: 0.5 },
      { ...entry('expired'), validUntil: 1 },
      { ...entry('expired-copy'), validUntil: 1 },
      { ...entry('future'), validFrom: Date.parse('2027-01-01') },
      { ...entry('future-copy'), validFrom: Date.parse('2027-01-01') },
      { ...entry('inactive'), status: 'invalidated' as const },
      { ...entry('superseded'), status: 'superseded' as const },
    ];
    const request = { scope, key: scope, at: '2026-10-06T00:00:00.000Z' };
    const plan = planMemoryConsolidation(records, request);
    assert.deepEqual(
      plan.duplicates.map((item) => [item.keeper.id, item.obsolete.id]),
      [['a', 'b']],
    );
    let checks = 0;
    assert.throws(
      () =>
        consolidateMemories(
          { list: () => records },
          {
            getConsolidation: () => null,
            commitConsolidation: (_plan, authorize) => {
              authorize();
              throw new Error('unreachable');
            },
          },
          request,
          () => {
            if (++checks === 2) throw new Error('authority revoked');
          },
        ),
      /authority revoked/,
    );
    assert.equal(checks, 2);
  }
  const unused = () => {
    throw new Error('Unexpected reader');
  };
  const readers = { rooms: { get: unused }, agents: { list: () => [] }, tasks: { get: unused } };
  assert.equal(consolidationScopeAvailable('company', readers), true);
  assert.throws(() => consolidationScopeAvailable('agent:missing', readers), /not found/);
  assert.throws(
    () =>
      consolidateRoomMemories(
        { get: unused },
        { list: () => [] },
        { getConsolidation: () => null, commitConsolidation: unused },
        { scope: 'company', key: 'x', at: '2026-10-06T00:00:00.000Z' },
      ),
    /Room scope/,
  );
});
