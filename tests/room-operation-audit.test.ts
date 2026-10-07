import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { collectAudit } from '../src/audit/service.js';
import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { SqliteRoomRepository } from '../src/rooms/sqlite.js';
import { createRoom } from '../src/rooms/domain.js';

test('Room create, Message and archive originals appear in important operation Audit', () => {
  const store = new SqliteRoomRepository(':memory:');
  try {
    const room = createRoom(
      {
        title: 'synthetic',
        type: 'direct',
        participants: [
          { kind: 'human', id: 'h' },
          { kind: 'agent', id: 'a' },
        ],
      },
      { id: 'r', createdAt: 'same' },
    );
    store.create(room);
    store.append(
      'r',
      { sender: { kind: 'human', id: 'h' }, content: 'synthetic' },
      { id: 'm', createdAt: 'same' },
    );
    store.archive('r', 'same');
    const reader = store as unknown as { operationHistory?: () => readonly { tool: string }[] };
    assert.deepEqual(reader.operationHistory?.().map((entry) => entry.tool) ?? [], [
      'room.create',
      'room.message',
      'room.archive',
    ]);
  } finally {
    store.close();
  }
});

test('Room Audit preserves Task actor, immutable configuration snapshots and rollback without copying Message contents', () => {
  const home = mkdtempSync('/tmp/org-room-audit-'),
    path = home + '/org.db';
  let store = new SqliteRoomRepository(path, { kind: 'system', id: 'test-host' });
  const raw = new Database(path);
  const input = {
    title: 'synthetic',
    type: 'task' as const,
    taskId: 'task',
    participants: [
      { kind: 'human' as const, id: 'h' },
      { kind: 'agent' as const, id: 'a' },
    ],
  };
  const room = createRoom(input, { id: 'r', createdAt: 'same' });
  const audit = () =>
    collectAudit(
      { list: () => [] },
      { configurationHistory: () => [], capabilityHistory: () => [] },
      { list: () => [], history: () => [], operationHistory: () => [] },
      { list: () => [], operationHistory: () => [] },
      { operationHistory: () => [] },
      { operationHistory: () => [] },
      store,
      { operationHistory: () => [] },
    );
  try {
    store.create(room);
    for (let i = 0; i < 12; i++)
      store.append(
        'r',
        { sender: { kind: 'human', id: 'h' }, content: 'PRIVATE_SENTINEL' },
        { id: 'message:' + i, createdAt: 'same' },
      );
    const before = audit();
    assert.equal(before.length, 13);
    assert.equal(before[0]?.tool, 'room.create');
    assert.deepEqual(before[0]?.actor, { kind: 'system', id: 'test-host' });
    assert.deepEqual(
      before.slice(1).map((entry) => entry.id),
      Array.from({ length: 12 }, (_, i) => 'room:message:' + encodeURIComponent('message:' + i)),
    );
    for (const entry of before) assert.equal(entry.taskId, 'task');
    assert.ok(!JSON.stringify(before).includes('PRIVATE_SENTINEL'));
    raw.exec(
      "CREATE TRIGGER fail_room_audit BEFORE INSERT ON room_operation_history BEGIN SELECT RAISE(ABORT,'record failure');END;",
    );
    assert.throws(
      () => store.create(createRoom(input, { id: 'rollback', createdAt: 'same' })),
      /record failure/,
    );
    assert.throws(() => store.get('rollback'), /not found/);
    assert.throws(() => store.archive('r', 'same'), /record failure/);
    assert.equal(store.get('r').archivedAt, null);
    assert.deepEqual(audit(), before);
    raw.exec('DROP TRIGGER fail_room_audit');
    store.archive('r', 'same');
    const complete = audit();
    assert.equal(complete.at(-1)?.tool, 'room.archive');
    store.archive('r', 'different');
    assert.deepEqual(audit(), complete);
    const frames = raw
      .query<{ data: string }, []>('SELECT data FROM room_operation_history ORDER BY rowid')
      .all()
      .map(
        (row) =>
          JSON.parse(row.data) as {
            input: { archivedAt: string | null };
            output: { archivedAt: string | null };
          },
      );
    assert.equal(frames[0]?.input.archivedAt, null);
    assert.equal(frames[0]?.output.archivedAt, null);
    assert.equal(frames[1]?.input.archivedAt, null);
    assert.equal(frames[1]?.output.archivedAt, 'same');
    for (const sql of [
      'DELETE FROM room_operation_history',
      "UPDATE room_operation_history SET data='{}'",
      'INSERT OR REPLACE INTO room_operation_history SELECT * FROM room_operation_history LIMIT 1',
    ])
      assert.throws(() => raw.exec(sql), /immutable/);
    store.close();
    store = new SqliteRoomRepository(path);
    assert.deepEqual(audit(), complete);
    raw.exec('DROP TABLE room_operation_history');
    store.close();
    store = new SqliteRoomRepository(path);
    assert.equal(audit().length, 12);
    assert.ok(audit().every((entry) => entry.tool === 'room.message'));
    assert.equal(store.get('r').archivedAt, 'same');
  } finally {
    raw.close();
    store.close();
    rmSync(home, { recursive: true, force: true });
  }
});
