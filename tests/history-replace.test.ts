import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { SqliteRoomRepository } from '../src/rooms/sqlite.js';
import { createRoom } from '../src/rooms/domain.js';
import { SqliteEventBus } from '../src/events/sqlite.js';
import { createEvent } from '../src/events/domain.js';
import { SqliteSessionStore } from '../src/sessions/sqlite.js';
import { createSession } from '../src/sessions/domain.js';
import { SqliteMemoryProvider } from '../src/memory/sqlite.js';
import { createMemory } from '../src/memory/domain.js';
function fixture() {
  const home = mkdtempSync('/tmp/org-history-');
  return { path: home + '/org.db', cleanup: () => rmSync(home, { recursive: true, force: true }) };
}
test('Room immutable Message rejects replacement through id and sequence aliases with recursive triggers disabled', () => {
  const f = fixture();
  const rooms = new SqliteRoomRepository(f.path);
  const db = new Database(f.path);
  try {
    db.exec('PRAGMA recursive_triggers=OFF');
    rooms.create(
      createRoom(
        {
          title: 'work',
          type: 'direct',
          participants: [
            { kind: 'human', id: 'h' },
            { kind: 'agent', id: 'a' },
          ],
        },
        { id: 'r', createdAt: 'now' },
      ),
    );
    const first = rooms.append(
      'r',
      { sender: { kind: 'human', id: 'h' }, content: 'original' },
      { id: 'm', createdAt: 'now' },
    );
    assert.throws(() =>
      db
        .query('INSERT OR REPLACE INTO room_messages(id,room_id,data) VALUES (?,?,?)')
        .run('m', 'r', JSON.stringify({ ...first, content: 'changed' })),
    );
    assert.throws(() =>
      db
        .query('INSERT OR REPLACE INTO room_messages(rowid,id,room_id,data) VALUES (?,?,?,?)')
        .run(1, 'other', 'r', JSON.stringify({ ...first, id: 'other' })),
    );
    assert.deepEqual(rooms.messages('r'), [first]);
    rooms.append(
      'r',
      { sender: { kind: 'human', id: 'h' }, content: 'next' },
      { id: 'next', createdAt: 'later' },
    );
    assert.equal(rooms.messages('r').length, 2);
  } finally {
    db.close();
    rooms.close();
    f.cleanup();
  }
});
test('Event immutable payload rejects replacement through id and sequence aliases', () => {
  const f = fixture();
  const events = new SqliteEventBus(f.path);
  const db = new Database(f.path);
  try {
    db.exec('PRAGMA recursive_triggers=OFF');
    const first = events.publish(
      createEvent({ type: 'test.created', source: 'manual' }, { id: 'e', createdAt: 'now' }),
    );
    assert.throws(() =>
      db
        .query('INSERT OR REPLACE INTO events(id,data) VALUES (?,?)')
        .run('e', JSON.stringify({ ...first, type: 'test.changed' })),
    );
    assert.throws(() =>
      db
        .query('INSERT OR REPLACE INTO events(sequence,id,data) VALUES (?,?,?)')
        .run(1, 'other', JSON.stringify({ ...first, id: 'other' })),
    );
    assert.deepEqual(events.list(), [first]);
    events.publish(
      createEvent({ type: 'test.created', source: 'manual' }, { id: 'next', createdAt: 'later' }),
    );
    assert.equal(events.list().length, 2);
  } finally {
    db.close();
    events.close();
    f.cleanup();
  }
});
test('Session immutable snapshots reject explicit rowid replacement under a new composite key', () => {
  const f = fixture();
  const sessions = new SqliteSessionStore(f.path);
  const db = new Database(f.path);
  try {
    db.exec('PRAGMA recursive_triggers=OFF');
    const first = createSession(
      { agentId: 'a', roomId: 'r', runtime: 'codex' },
      { id: 's', at: 'now' },
    );
    sessions.create(first);
    assert.throws(() =>
      db
        .query('INSERT OR REPLACE INTO session_history(rowid,id,version,data) VALUES (?,?,?,?)')
        .run(1, 'other', 0, JSON.stringify({ ...first, id: 'other' })),
    );
    assert.deepEqual(sessions.history('s'), [first]);
    sessions.create(
      createSession({ agentId: 'a', roomId: 'r', runtime: 'codex' }, { id: 'next', at: 'later' }),
    );
    assert.equal(sessions.list().length, 2);
  } finally {
    db.close();
    sessions.close();
    f.cleanup();
  }
});
test('Memory invalidation preserves its original reason against explicit rowid replacement', () => {
  const f = fixture();
  const memories = new SqliteMemoryProvider(f.path);
  const db = new Database(f.path);
  try {
    db.exec('PRAGMA recursive_triggers=OFF');
    const input = {
      type: 'semantic' as const,
      scope: 'global',
      content: 'fact',
      confidence: 0.8,
      sourceRefs: [{ roomId: 'r', messageId: 'm' }],
    };
    memories.create(createMemory(input, { id: 'm', at: 'now' }));
    memories.invalidate('m', 'original reason', 'later');
    assert.throws(() =>
      db
        .query('INSERT OR REPLACE INTO memory_invalidations(rowid,id,reason,at) VALUES (?,?,?,?)')
        .run(1, 'other', 'changed', 'later'),
    );
    assert.equal(memories.get('m').status, 'invalidated');
    assert.deepEqual(db.query('SELECT reason FROM memory_invalidations WHERE id=?').get('m'), {
      reason: 'original reason',
    });
    memories.create(createMemory(input, { id: 'next', at: 'later' }));
    memories.invalidate('next', 'next reason', 'last');
    assert.equal(memories.get('next').status, 'invalidated');
  } finally {
    db.close();
    memories.close();
    f.cleanup();
  }
});

test('Reopening a legacy Room database installs replacement guards without changing existing Message history', () => {
  const f = fixture();
  let rooms = new SqliteRoomRepository(f.path);
  const db = new Database(f.path);
  try {
    rooms.create(
      createRoom(
        {
          title: 'work',
          type: 'direct',
          participants: [
            { kind: 'human', id: 'h' },
            { kind: 'agent', id: 'a' },
          ],
        },
        { id: 'r', createdAt: 'now' },
      ),
    );
    const first = rooms.append(
      'r',
      { sender: { kind: 'human', id: 'h' }, content: 'legacy original' },
      { id: 'm', createdAt: 'now' },
    );
    db.exec('DROP TRIGGER room_messages_no_replace');
    rooms.close();
    rooms = new SqliteRoomRepository(f.path);
    assert.deepEqual(rooms.messages('r'), [first]);
    assert.throws(() =>
      db
        .query('INSERT OR REPLACE INTO room_messages(id,room_id,data) VALUES (?,?,?)')
        .run('m', 'r', JSON.stringify({ ...first, content: 'changed' })),
    );
    rooms.append(
      'r',
      { sender: { kind: 'human', id: 'h' }, content: 'new' },
      { id: 'next', createdAt: 'later' },
    );
    assert.equal(rooms.messages('r').length, 2);
  } finally {
    db.close();
    rooms.close();
    f.cleanup();
  }
});
