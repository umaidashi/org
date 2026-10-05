import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { createSchedule, dueSlot } from '../src/schedules/domain.js';
import { pollSchedules } from '../src/schedules/service.js';

test('fixed schedules compute the latest due slot from supplied time and reject unsafe inputs', () => {
  const input = {
    name: 'Daily',
    everyMs: 1000,
    startAtMs: 10000,
    event: { type: 'schedule.tick', source: 'scheduler', payload: { marker: 'check' } },
  };
  const schedule = createSchedule(input, { id: 'schedule', createdAt: 'created' });
  assert.equal(dueSlot(schedule, 9999), null);
  assert.deepEqual(dueSlot(schedule, 10000), { index: 0, atMs: 10000 });
  assert.deepEqual(dueSlot(schedule, 21999), { index: 11, atMs: 21000 });
  assert.equal(dueSlot({ ...schedule, enabled: false }, 22000), null);
  assert.deepEqual(dueSlot(schedule, 10500), { index: 0, atMs: 10000 });
  input.event.payload.marker = 'changed';
  assert.equal(schedule.event.payload?.marker, 'check');
  for (const everyMs of [0, -1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1])
    assert.throws(
      () => createSchedule({ ...input, everyMs }, { id: 'bad', createdAt: 'created' }),
      /interval/i,
    );
  assert.throws(
    () =>
      createSchedule(
        { ...input, startAtMs: 8640000000000001 },
        { id: 'bad', createdAt: 'created' },
      ),
    /start/i,
  );
  assert.throws(() => dueSlot(schedule, NaN), /time/i);
});

test('schedule polling emits the same Event for the same slot and propagates a failed write', () => {
  const schedule = createSchedule(
    {
      name: 'Pulse',
      everyMs: 1000,
      startAtMs: 0,
      event: { type: 'schedule.tick', source: 'scheduler' },
    },
    { id: 'schedule', createdAt: 'created' },
  );
  const emitted: import('../src/events/domain.js').Event[] = [];
  let now = 1999;
  const writer = {
    list: () => emitted,
    publishOnce: (event: import('../src/events/domain.js').Event) => {
      emitted.push(event);
      return event;
    },
  };
  pollSchedules({ list: () => [schedule] }, writer, () => now);
  now = 1500;
  pollSchedules({ list: () => [schedule] }, writer, () => now);
  assert.deepEqual(emitted[0], emitted[1]);
  assert.equal(emitted[0]?.createdAt, '1970-01-01T00:00:01.000Z');
  now = 9000;
  pollSchedules({ list: () => [schedule] }, writer, () => now);
  assert.equal(emitted[2]?.createdAt, '1970-01-01T00:00:09.000Z');
  now = 4000;
  pollSchedules({ list: () => [schedule] }, writer, () => now);
  assert.equal(emitted.length, 3);
  now = 10000;
  assert.throws(
    () =>
      pollSchedules(
        { list: () => [schedule] },
        {
          list: () => emitted,
          publishOnce: () => {
            throw new Error('write failed');
          },
        },
        () => now,
      ),
    /write failed/,
  );
});
