import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { createSchedule } from '../src/schedules/domain.js';
import { SqliteScheduleRepository } from '../src/schedules/sqlite.js';
test('Schedule definitions remain immutable while enable changes survive reopen', () => {
  const home = mkdtempSync('/tmp/org-schedule-db-'),
    path = home + '/org.db';
  let store = new SqliteScheduleRepository(path);
  const connection = new Database(path);
  try {
    const schedule = createSchedule(
      {
        name: 'Pulse',
        everyMs: 1000,
        startAtMs: 0,
        event: { type: 'schedule.tick', source: 'scheduler' },
      },
      { id: 's', createdAt: 'before' },
    );
    assert.deepEqual(store.create(schedule), schedule);
    assert.deepEqual(store.list(), [schedule]);
    assert.equal(store.setEnabled('s', false).enabled, false);
    assert.throws(
      () => connection.exec("UPDATE schedules SET data='{}' WHERE id='s'"),
      /immutable/,
    );
    assert.throws(() => connection.exec("DELETE FROM schedules WHERE id='s'"), /immutable/);
    assert.throws(
      () => connection.exec("INSERT OR REPLACE INTO schedules(id,data,enabled) VALUES('s','{}',1)"),
      /immutable/,
    );
    assert.throws(() => connection.exec("UPDATE schedules SET enabled=2 WHERE id='s'"));
    assert.throws(() => store.create({ ...schedule, id: 'bad', everyMs: 0 }), /interval/);
    store.close();
    store = new SqliteScheduleRepository(path);
    assert.equal(store.get('s').enabled, false);
    assert.equal(store.setEnabled('s', true).enabled, true);
    assert.throws(() => store.setEnabled('missing', false), /not found/);
    assert.deepEqual(store.list(), [schedule]);
  } finally {
    connection.close();
    store.close();
    rmSync(home, { recursive: true, force: true });
  }
});
