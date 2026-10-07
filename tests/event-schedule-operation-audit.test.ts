import { mkdtempSync, rmSync } from 'node:fs';
import { Database } from 'bun:sqlite';
import { buildAudit } from '../src/audit/domain.js';
import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { createEvent, createSubscription } from '../src/events/domain.js';
import { SqliteEventBus } from '../src/events/sqlite.js';
import { createSchedule } from '../src/schedules/domain.js';
import { SqliteScheduleRepository } from '../src/schedules/sqlite.js';
const at = '2026-10-08T00:00:00.000Z';
const actor = { kind: 'system' as const, id: 'local-host' };
test('Event and Subscription mutations preserve writer Audit with no idempotent replay', () => {
  const bus = new SqliteEventBus(':memory:', actor, () => at);
  try {
    const event = createEvent(
      { type: 'synthetic.requested', source: 'fixture', payload: { private: 'private body' } },
      { id: 'e', createdAt: at },
    );
    bus.publishOnce(event);
    bus.publishOnce(event);
    bus.subscribe(
      createSubscription(
        { subscriberType: 'agent', subscriberId: 'a', eventPattern: 'synthetic.*' },
        { id: 'sub', createdAt: at },
      ),
    );
    bus.setEnabled('sub', false);
    bus.setEnabled('sub', false);
    const audit = bus.operationHistory();
    assert.deepEqual(
      audit.map((entry) => entry.tool),
      ['event.publish', 'subscription.create', 'subscription.disable'],
    );
    assert.ok(
      audit.every(
        (entry) => entry.at === at && entry.result === 'succeeded' && entry.actor.id === actor.id,
      ),
    );
    assert.equal(audit[0]?.outputRef, 'org://events/e');
    assert.equal(audit[0]?.eventId, 'e');
    assert.equal(JSON.stringify(audit).includes('private body'), false);
  } finally {
    bus.close();
  }
});
test('Schedule registration and enabled changes retain writer Audit without no-op records', () => {
  const store = new SqliteScheduleRepository(':memory:', actor, () => at);
  try {
    store.create(
      createSchedule(
        {
          name: 'Synthetic',
          everyMs: 1000,
          startAtMs: 0,
          event: { type: 'synthetic.tick', source: 'fixture' },
        },
        { id: 's', createdAt: at },
      ),
    );
    store.setEnabled('s', false);
    store.setEnabled('s', false);
    store.setEnabled('s', true);
    const audit = store.operationHistory();
    assert.deepEqual(
      audit.map((entry) => entry.tool),
      ['schedule.create', 'schedule.disable', 'schedule.enable'],
    );
    assert.ok(
      audit.every(
        (entry) => entry.at === at && entry.actor.id === actor.id && entry.result === 'succeeded',
      ),
    );
  } finally {
    store.close();
  }
});

test('Event and Schedule Audit storage is atomic, immutable and stable across reopen without legacy backfill', () => {
  const home = mkdtempSync('/tmp/org-event-schedule-audit-'),
    path = home + '/org.db';
  const bus = new SqliteEventBus(path, actor, () => at);
  const schedules = new SqliteScheduleRepository(path, actor, () => at);
  const db = new Database(path);
  let closed = false;
  const event = createEvent(
    { type: 'synthetic.requested', source: 'fixture' },
    { id: 'e', createdAt: at },
  );
  const sub = createSubscription(
    { subscriberType: 'agent', subscriberId: 'a', eventPattern: 'synthetic.*' },
    { id: 'sub', createdAt: at },
  );
  const schedule = createSchedule(
    {
      name: 'Synthetic',
      everyMs: 1000,
      startAtMs: 0,
      event: { type: 'synthetic.tick', source: 'fixture' },
    },
    { id: 's', createdAt: at },
  );
  try {
    db.query('INSERT INTO events(id,data) VALUES (?,?)').run(event.id, JSON.stringify(event));
    db.query('INSERT INTO subscriptions(id,data) VALUES (?,?)').run(sub.id, JSON.stringify(sub));
    db.query('INSERT INTO schedules(id,data,enabled) VALUES (?,?,?)').run(
      schedule.id,
      JSON.stringify(schedule),
      1,
    );
    assert.deepEqual(bus.operationHistory(), []);
    assert.deepEqual(schedules.operationHistory(), []);
    for (const table of ['event_operation_history', 'schedule_operation_history'])
      db.exec(
        `CREATE TRIGGER reject_${table} BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT, 'audit failure'); END`,
      );
    assert.throws(() => bus.publish({ ...event, id: 'rejected' }), /audit failure/);
    assert.throws(() => bus.publishOnce({ ...event, id: 'rejected-once' }), /audit failure/);
    assert.equal(bus.list().length, 1);
    assert.throws(() => bus.subscribe({ ...sub, id: 'rejected' }), /audit failure/);
    assert.equal(bus.subscriptions().length, 1);
    assert.throws(() => bus.setEnabled('sub', false), /audit failure/);
    assert.equal(bus.subscriptions()[0]?.enabled, true);
    assert.throws(() => schedules.create({ ...schedule, id: 'rejected' }), /audit failure/);
    assert.equal(schedules.list().length, 1);
    assert.throws(() => schedules.setEnabled('s', false), /audit failure/);
    assert.equal(schedules.get('s').enabled, true);
    for (const table of ['event_operation_history', 'schedule_operation_history'])
      db.exec(`DROP TRIGGER reject_${table}`);
    bus.setEnabled('sub', false);
    schedules.setEnabled('s', false);
    schedules.setEnabled('s', true);
    const eventAudit = bus.operationHistory(),
      scheduleAudit = schedules.operationHistory();
    assert.deepEqual(
      buildAudit([], [], scheduleAudit).map((entry) => entry.id),
      scheduleAudit.map((entry) => entry.id),
    );
    const stored = db.query<{ data: string }, []>('SELECT data FROM event_operation_history').get();
    assert.ok(stored);
    const frame = JSON.parse(stored.data) as {
      input: { enabled: boolean };
      output: { enabled: boolean };
    };
    assert.equal(frame.input.enabled, true);
    assert.equal(frame.output.enabled, false);
    for (const table of ['event_operation_history', 'schedule_operation_history'])
      for (const sql of [
        `UPDATE ${table} SET data=data`,
        `DELETE FROM ${table}`,
        `INSERT OR REPLACE INTO ${table} SELECT * FROM ${table}`,
      ])
        assert.throws(() => db.exec(sql), /immutable/);
    bus.close();
    schedules.close();
    closed = true;
    const reopenedBus = new SqliteEventBus(path),
      reopenedSchedules = new SqliteScheduleRepository(path);
    try {
      assert.deepEqual(reopenedBus.operationHistory(), eventAudit);
      assert.deepEqual(reopenedSchedules.operationHistory(), scheduleAudit);
      assert.equal(reopenedBus.subscriptions()[0]?.enabled, false);
      assert.equal(reopenedSchedules.get('s').enabled, true);
    } finally {
      reopenedBus.close();
      reopenedSchedules.close();
    }
  } finally {
    if (!closed) {
      bus.close();
      schedules.close();
    }
    db.close();
    rmSync(home, { recursive: true, force: true });
  }
});
