import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { createRoom } from '../src/rooms/domain.js';
import type { MemoryConsolidationReceipt } from '../src/memory/consolidation.js';
import { pollMemoryConsolidations, pollScopedMemoryConsolidations } from '../src/memory/nightly.js';
import { parseDaemonCommand } from '../src/daemon/cli.js';
test('nightly consolidation is explicit, coalesces missed UTC days and preserves receipts across same-day polls and clock rollback', () => {
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
    time = '2026-10-06T03:00:00.000Z',
    fail = false;
  const receipts: MemoryConsolidationReceipt[] = [];
  const run = (ids = ['r']) =>
    pollMemoryConsolidations(
      { get: () => active },
      {
        latestConsolidation: (prefix) =>
          [...receipts]
            .filter((r) => r.key.startsWith(prefix))
            .sort((a, b) => b.key.localeCompare(a.key))[0] ?? null,
      },
      {
        consolidate: (request) => {
          if (fail) throw new Error('Storage failed');
          const receipt = { ...request, keepers: [], invalidated: [] };
          receipts.push(receipt);
          return receipt;
        },
      },
      ids,
      () => Date.parse(time),
    );
  run([]);
  assert.equal(receipts.length, 0);
  run();
  run();
  assert.equal(receipts.length, 1);
  assert.ok(receipts[0]?.key.endsWith(':2026-10-06'));
  assert.equal(receipts[0]?.at, '2026-10-06T03:00:00.000Z');
  time = '2026-10-10T00:00:00.000Z';
  run();
  assert.equal(receipts.length, 2);
  assert.ok(receipts[1]?.key.endsWith(':2026-10-10'));
  time = '2026-10-07T00:00:00.000Z';
  run();
  assert.equal(receipts.length, 2);
  time = '2026-10-11T00:00:00.000Z';
  active = { ...room, archivedAt: 'closed' };
  run();
  assert.equal(receipts.length, 2);
  active = room;
  fail = true;
  assert.throws(() => run(), /Storage failed/);
  assert.equal(parseDaemonCommand(['daemon']).consolidationRooms, undefined);
  assert.deepEqual(
    parseDaemonCommand(['daemon', '--memory-consolidation-room', 'r']).consolidationRooms,
    ['r'],
  );
  for (const args of [
    ['daemon', '--once', '--memory-consolidation-room', 'r'],
    ['daemon', 'status', '--memory-consolidation-room', 'r'],
    ['daemon', '--memory-consolidation-room', ''],
    ['daemon', '--memory-consolidation-room', 'r', '--memory-consolidation-room', 'r'],
  ])
    assert.throws(() => parseDaemonCommand(args));
});

test('scoped nightly validates combined allowlist, preserves legacy key namespace and rejects corrupt receipt', () => {
  assert.deepEqual(
    parseDaemonCommand(['daemon', '--memory-consolidation-scope', 'company']).consolidationScopes,
    ['company'],
  );
  for (const args of [
    ['daemon', '--once', '--memory-consolidation-scope', 'company'],
    ['daemon', 'status', '--memory-consolidation-scope', 'company'],
    ['daemon', '--memory-consolidation-scope', 'unknown'],
    [
      'daemon',
      '--memory-consolidation-scope',
      'company',
      '--memory-consolidation-scope',
      'company',
    ],
    ['daemon', '--memory-consolidation-room', 'r', '--memory-consolidation-scope', 'room:r'],
    ['daemon', '--memory-consolidation-scope', 'task:x\0'],
    [
      'daemon',
      ...Array.from({ length: 33 }, (_, i) => [
        '--memory-consolidation-scope',
        'project:' + i,
      ]).flat(),
    ],
  ])
    assert.throws(() => parseDaemonCommand(args));
  const receipts: MemoryConsolidationReceipt[] = [];
  let time = Date.parse('2026-10-06T00:00:00.000Z');
  const scopes = ['company', 'department:eng', 'project:p', 'agent:a', 'task:t', 'room:company'];
  const run = () =>
    pollScopedMemoryConsolidations(
      {
        latestConsolidation: (prefix) =>
          [...receipts].reverse().find((r) => r.key.startsWith(prefix)) ?? null,
      },
      {
        consolidate: (request) => {
          const receipt = { ...request, keepers: [], invalidated: [] };
          receipts.push(receipt);
          return receipt;
        },
      },
      scopes,
      () => true,
      () => time,
    );
  run();
  run();
  assert.equal(receipts.length, 6);
  assert.equal(new Set(receipts.map((r) => r.key)).size, 6);
  assert.ok(receipts.slice(0, 5).every((r) => r.key.startsWith('nightly-scoped-memory:')));
  assert.ok(receipts[5]?.key.startsWith('nightly-memory:'));
  time = Date.parse('2026-10-10T00:00:00.000Z');
  run();
  assert.equal(receipts.length, 12);
  time = Date.parse('2026-10-07T00:00:00.000Z');
  run();
  assert.equal(receipts.length, 12);
  const last = receipts.at(-1);
  assert.ok(last);
  receipts[receipts.length - 1] = { ...last, scope: 'company' };
  assert.throws(() => run(), /receipt/);
});
