import assert from 'node:assert/strict';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'bun:test';
import { createEvent, createSubscription } from '../src/events/domain.js';
import { SqliteEventBus } from '../src/events/sqlite.js';
test('Event log remains immutable when subscription changes or insertion fails', () => {
  const dir = mkdtempSync(join(tmpdir(), 'org-event-db-'));
  const path = join(dir, 'org.db');
  let bus: SqliteEventBus | undefined;
  let connection: Database | undefined;
  try {
    bus = new SqliteEventBus(path);
    const identity = { id: 'e', createdAt: 'now' };
    const event = bus.publish(
      createEvent({ type: 'manual.requested', source: 'manual' }, identity),
    );
    const subscription = bus.subscribe(
      createSubscription(
        { subscriberType: 'workflow', subscriberId: 'flow', eventPattern: '**' },
        { ...identity, id: 's' },
      ),
    );
    assert.equal(bus.setEnabled(subscription.id, false).enabled, false);
    assert.deepEqual(bus.get(event.id), event);
    connection = new Database(path);
    assert.throws(() => connection?.exec("UPDATE events SET data='{}' WHERE id='e'"), /immutable/);
    assert.throws(() => connection?.exec("DELETE FROM events WHERE id='e'"), /immutable/);
    connection.exec(
      "CREATE TRIGGER fail_event BEFORE INSERT ON events BEGIN SELECT RAISE(ABORT, 'publish failure'); END",
    );
    assert.throws(
      () =>
        bus?.publish(
          createEvent({ type: 'manual.requested', source: 'manual' }, { ...identity, id: 'e2' }),
        ),
      /publish failure/,
    );
    assert.deepEqual(bus.list(), [event]);
    connection.exec('DROP TRIGGER fail_event');
    bus.publish(
      createEvent({ type: 'manual.requested', source: 'manual' }, { ...identity, id: 'e2' }),
    );
    assert.equal(bus.list().length, 2);
    assert.throws(() => bus?.get('missing'), /not found/);
    assert.throws(() => bus?.setEnabled('missing', true), /not found/);
  } finally {
    connection?.close();
    bus?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('idempotent Event publication reuses canonical evidence across adapters and rejects conflicts without replacing history', () => {
  const dir = mkdtempSync(join(tmpdir(), 'org-event-once-'));
  const path = join(dir, 'org.db');
  const first = new SqliteEventBus(path),
    second = new SqliteEventBus(path);
  const connection = new Database(path);
  try {
    const event = createEvent(
      { type: 'schedule.tick', source: 'scheduler', payload: { a: 1, b: 2 } },
      { id: 'slot', createdAt: 'due' },
    );
    assert.deepEqual(first.publishOnce(event), event);
    assert.deepEqual(second.publishOnce({ ...event, payload: { b: 2, a: 1 } }), event);
    assert.throws(() => second.publishOnce({ ...event, payload: { a: 9 } }), /conflict/i);
    assert.deepEqual(first.list(), [event]);
    connection.exec(
      "CREATE TRIGGER fail_once BEFORE INSERT ON events WHEN NEW.id='next' BEGIN SELECT RAISE(ABORT, 'write failed'); END",
    );
    assert.throws(() => first.publishOnce({ ...event, id: 'next' }), /write failed/);
    assert.deepEqual(second.list(), [event]);
    connection.exec('DROP TRIGGER fail_once');
    second.publishOnce({ ...event, id: 'next' });
    assert.equal(first.list().length, 2);
    assert.throws(
      () => first.publishOnce({ ...event, id: 'sparse', payload: { items: new Array<string>(1) } }),
      /JSON/,
    );
  } finally {
    connection.close();
    first.close();
    second.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
