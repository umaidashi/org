import assert from 'node:assert/strict';
import { Database } from 'bun:sqlite';
import { test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRoom } from '../src/rooms/domain.js';
import { SqliteRoomRepository } from '../src/rooms/sqlite.js';
test('SQLite preserves immutable Messages and rejects insertion failure without affecting history', () => {
  const dir = mkdtempSync(join(tmpdir(), 'org-room-db-'));
  const path = join(dir, 'org.db');
  let repository: SqliteRoomRepository | undefined;
  let connection: Database | undefined;
  try {
    repository = new SqliteRoomRepository(path);
    const human = { kind: 'human', id: 'founder' } as const;
    repository.create(
      createRoom(
        { title: 'x', type: 'direct', participants: [human, { kind: 'agent', id: 'chief' }] },
        { id: 'r', createdAt: 'now' },
      ),
    );
    const first = repository.append(
      'r',
      { sender: human, content: 'hello' },
      { id: 'm', createdAt: 'now' },
    );
    connection = new Database(path);
    assert.throws(
      () => connection?.exec("UPDATE room_messages SET data='{}' WHERE id='m'"),
      /immutable/,
    );
    assert.throws(() => connection?.exec("DELETE FROM room_messages WHERE id='m'"), /immutable/);
    connection.exec(
      "CREATE TRIGGER fail_message BEFORE INSERT ON room_messages BEGIN SELECT RAISE(ABORT, 'insertion failure'); END",
    );
    assert.throws(
      () =>
        repository?.append(
          'r',
          { sender: human, content: 'later' },
          { id: 'm2', createdAt: 'later' },
        ),
      /insertion failure/,
    );
    assert.deepEqual(repository.messages('r'), [first]);
    connection.exec('DROP TRIGGER fail_message');
    repository.append(
      'r',
      { sender: human, content: 'recovered' },
      { id: 'm2', createdAt: 'later' },
    );
    assert.equal(repository.messages('r').length, 2);
    repository.archive('r', 'later');
    assert.throws(
      () =>
        repository?.append(
          'r',
          { sender: human, content: 'denied' },
          { id: 'm3', createdAt: 'later' },
        ),
      /archived/,
    );
  } finally {
    connection?.close();
    repository?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
