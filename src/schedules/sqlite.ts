import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Database } from 'bun:sqlite';
import { createSchedule } from './domain.js';
import type { Schedule } from './domain.js';
import type { ScheduleRepository } from './port.js';
import { jsonObject } from '../events/domain.js';
function text(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Invalid stored Schedule text');
  return value;
}
function decode(row: unknown): Schedule {
  if (
    row === null ||
    typeof row !== 'object' ||
    !('data' in row) ||
    !('enabled' in row) ||
    (row.enabled !== 0 && row.enabled !== 1)
  )
    throw new Error('Invalid stored Schedule');
  const value: unknown = JSON.parse(text(row.data));
  const data = jsonObject(value);
  const event = jsonObject(data.event);
  if (typeof data.everyMs !== 'number' || typeof data.startAtMs !== 'number')
    throw new Error('Invalid stored Schedule timing');
  const planned = createSchedule(
    {
      name: text(data.name),
      everyMs: data.everyMs,
      startAtMs: data.startAtMs,
      event: {
        type: text(event.type),
        source: text(event.source),
        payload: jsonObject(event.payload ?? {}),
      },
    },
    { id: text(data.id), createdAt: text(data.createdAt) },
  );
  return { ...planned, enabled: row.enabled === 1 };
}
export class SqliteScheduleRepository implements ScheduleRepository {
  private readonly db: Database;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path, { create: true });
    try {
      this.db.exec(`PRAGMA busy_timeout=5000;
        CREATE TABLE IF NOT EXISTS schedules(id TEXT PRIMARY KEY, data TEXT NOT NULL, enabled INTEGER NOT NULL CHECK(enabled IN (0,1))) WITHOUT ROWID;
        CREATE TRIGGER IF NOT EXISTS schedules_no_replace BEFORE INSERT ON schedules WHEN EXISTS(SELECT 1 FROM schedules WHERE id=NEW.id) BEGIN SELECT RAISE(ABORT,'Schedule definition is immutable'); END;
        CREATE TRIGGER IF NOT EXISTS schedules_no_update BEFORE UPDATE OF id,data ON schedules BEGIN SELECT RAISE(ABORT,'Schedule definition is immutable'); END;
        CREATE TRIGGER IF NOT EXISTS schedules_no_delete BEFORE DELETE ON schedules BEGIN SELECT RAISE(ABORT,'Schedule definition is immutable'); END;`);
    } catch (error) {
      this.db.close();
      throw error;
    }
  }
  close(): void {
    this.db.close();
  }
  create(schedule: Schedule): Schedule {
    if (typeof schedule.enabled !== 'boolean') throw new Error('Invalid Schedule enabled flag');
    const planned = createSchedule(schedule, schedule);
    this.db
      .query('INSERT INTO schedules(id,data,enabled) VALUES(?,?,?)')
      .run(planned.id, JSON.stringify(planned), schedule.enabled ? 1 : 0);
    return { ...planned, enabled: schedule.enabled };
  }
  get(id: string): Schedule {
    const row = this.db.query('SELECT data,enabled FROM schedules WHERE id=?').get(id);
    if (!row) throw new Error('Schedule not found');
    return decode(row);
  }
  list(): readonly Schedule[] {
    return this.db.query('SELECT data,enabled FROM schedules ORDER BY id').all().map(decode);
  }
  setEnabled(id: string, enabled: boolean): Schedule {
    if (typeof enabled !== 'boolean') throw new Error('Invalid Schedule enabled flag');
    return this.db
      .transaction(() => {
        this.get(id);
        this.db.query('UPDATE schedules SET enabled=? WHERE id=?').run(enabled ? 1 : 0, id);
        return this.get(id);
      })
      .immediate();
  }
}
