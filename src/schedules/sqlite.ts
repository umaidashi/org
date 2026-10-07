import type { AuditActor, AuditEntry } from '../audit/domain.js';
import type { ScheduleOperationReader } from './port.js';
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
export class SqliteScheduleRepository implements ScheduleRepository, ScheduleOperationReader {
  private readonly db: Database;
  constructor(
    path: string,
    private readonly auditActor: AuditActor = { kind: 'system', id: 'unspecified' },
    private readonly auditNow: () => string = () => new Date().toISOString(),
  ) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path, { create: true });
    try {
      this.db.exec(`PRAGMA busy_timeout=5000;
        CREATE TABLE IF NOT EXISTS schedule_operation_history(sequence INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT NOT NULL CHECK(json_valid(data)));
        CREATE TABLE IF NOT EXISTS schedules(id TEXT PRIMARY KEY, data TEXT NOT NULL, enabled INTEGER NOT NULL CHECK(enabled IN (0,1))) WITHOUT ROWID;
        CREATE TRIGGER IF NOT EXISTS schedules_no_replace BEFORE INSERT ON schedules WHEN EXISTS(SELECT 1 FROM schedules WHERE id=NEW.id) BEGIN SELECT RAISE(ABORT,'Schedule definition is immutable'); END;
        CREATE TRIGGER IF NOT EXISTS schedules_no_update BEFORE UPDATE OF id,data ON schedules BEGIN SELECT RAISE(ABORT,'Schedule definition is immutable'); END;
        CREATE TRIGGER IF NOT EXISTS schedules_no_delete BEFORE DELETE ON schedules BEGIN SELECT RAISE(ABORT,'Schedule definition is immutable'); END;`);
      this.db.exec(
        `CREATE TRIGGER IF NOT EXISTS schedule_operation_history_no_replace BEFORE INSERT ON schedule_operation_history WHEN EXISTS(SELECT 1 FROM schedule_operation_history WHERE sequence=NEW.sequence OR rowid=NEW.rowid) BEGIN SELECT RAISE(ABORT, 'Schedule operation is immutable'); END;`,
      );
      for (const operation of ['UPDATE', 'DELETE'])
        this.db.exec(
          `CREATE TRIGGER IF NOT EXISTS schedule_operation_history_no_${operation.toLowerCase()} BEFORE ${operation} ON schedule_operation_history BEGIN SELECT RAISE(ABORT, 'Schedule operation is immutable'); END;`,
        );
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
    return this.db
      .transaction(() => {
        this.db
          .query('INSERT INTO schedules(id,data,enabled) VALUES(?,?,?)')
          .run(planned.id, JSON.stringify(planned), schedule.enabled ? 1 : 0);
        const created = { ...planned, enabled: schedule.enabled };
        this.appendOperation('schedule.create', created.enabled, created);
        return created;
      })
      .immediate();
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
        const before = this.get(id);
        if (before.enabled === enabled) return before;
        this.db.query('UPDATE schedules SET enabled=? WHERE id=?').run(enabled ? 1 : 0, id);
        const changed = this.get(id);
        this.appendOperation(
          enabled ? 'schedule.enable' : 'schedule.disable',
          before.enabled,
          changed,
        );
        return changed;
      })
      .immediate();
  }
  private appendOperation(tool: string, beforeEnabled: boolean, schedule: Schedule): void {
    const actor = this.auditActor,
      at = this.auditNow();
    if (
      !['human', 'agent', 'system'].includes(actor.kind) ||
      !actor.id.trim() ||
      actor.id.includes('\0') ||
      actor.id.length > 128 ||
      !Number.isFinite(new Date(at).getTime()) ||
      new Date(at).toISOString() !== at
    )
      throw new Error('Invalid Schedule Audit actor/timestamp');
    const row = this.db
      .query<{ sequence: number }, []>(
        'SELECT COALESCE(MAX(sequence),0)+1 AS sequence FROM schedule_operation_history',
      )
      .get();
    if (!row) throw new Error('Missing Schedule Audit sequence');
    const ref = `org://schedule-operations/${row.sequence}`;
    const entry: Omit<AuditEntry, 'id'> = {
      actor,
      taskId: null,
      eventId: null,
      tool,
      inputRef: ref + '/input',
      outputRef: ref + '/output',
      at,
      result: 'succeeded',
      approvalId: null,
    };
    this.db.query('INSERT INTO schedule_operation_history(sequence,data) VALUES (?,?)').run(
      row.sequence,
      JSON.stringify({
        entry,
        scheduleRef: `org://schedules/${encodeURIComponent(schedule.id)}`,
        input: { enabled: beforeEnabled },
        output: { enabled: schedule.enabled },
      }),
    );
  }
  operationHistory(): readonly AuditEntry[] {
    return this.db
      .query<{ sequence: number; data: string }, []>(
        'SELECT sequence,data FROM schedule_operation_history ORDER BY sequence',
      )
      .all()
      .map((row) => {
        const id = `schedule:operation:${String(row.sequence).padStart(16, '0')}`;
        return {
          ...(JSON.parse(row.data) as { entry: Omit<AuditEntry, 'id'> }).entry,
          id,
          causalId: id,
        };
      });
  }
}
