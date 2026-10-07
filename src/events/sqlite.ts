import type { AuditActor, AuditEntry } from '../audit/domain.js';
import type { EventOperationReader } from './port.js';
import { isDeepStrictEqual } from 'node:util';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Database } from 'bun:sqlite';
import { createEvent, createSubscription, jsonObject } from './domain.js';
import type { Event, Subscription } from './domain.js';
import type { EventBus } from './port.js';
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function text(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Invalid stored Event string');
  return value;
}
function parse(raw: unknown): Record<string, unknown> {
  const value: unknown = JSON.parse(text(raw));
  if (!record(value)) throw new Error('Invalid stored Event record');
  return value;
}
function decodeEvent(raw: unknown): Event {
  const v = parse(raw);
  return createEvent(
    { type: text(v.type), source: text(v.source), payload: jsonObject(v.payload) },
    { id: text(v.id), createdAt: text(v.createdAt) },
  );
}
function decodeSubscription(raw: unknown): Subscription {
  const v = parse(raw);
  if (
    (v.subscriberType !== 'agent' && v.subscriberType !== 'workflow') ||
    typeof v.enabled !== 'boolean'
  )
    throw new Error('Invalid stored Subscription');
  return {
    ...createSubscription(
      {
        subscriberType: v.subscriberType,
        subscriberId: text(v.subscriberId),
        eventPattern: text(v.eventPattern),
        filter: jsonObject(v.filter),
      },
      { id: text(v.id), createdAt: text(v.createdAt) },
    ),
    enabled: v.enabled,
  };
}
export class SqliteEventBus implements EventBus, EventOperationReader {
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
        CREATE TABLE IF NOT EXISTS event_operation_history(sequence INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT NOT NULL CHECK(json_valid(data)));
        CREATE TABLE IF NOT EXISTS events(sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, data TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS subscriptions(id TEXT PRIMARY KEY, data TEXT NOT NULL);
        CREATE TRIGGER IF NOT EXISTS events_no_replace BEFORE INSERT ON events WHEN EXISTS(SELECT 1 FROM events WHERE id=NEW.id OR sequence=NEW.sequence) BEGIN SELECT RAISE(ABORT, 'Events are immutable'); END;
        CREATE TRIGGER IF NOT EXISTS events_no_update BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT, 'Events are immutable'); END;
        CREATE TRIGGER IF NOT EXISTS events_no_delete BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT, 'Events are immutable'); END;`);
      this.db.exec(
        `CREATE TRIGGER IF NOT EXISTS event_operation_history_no_replace BEFORE INSERT ON event_operation_history WHEN EXISTS(SELECT 1 FROM event_operation_history WHERE sequence=NEW.sequence OR rowid=NEW.rowid) BEGIN SELECT RAISE(ABORT, 'Event operation is immutable'); END;`,
      );
      for (const operation of ['UPDATE', 'DELETE'])
        this.db.exec(
          `CREATE TRIGGER IF NOT EXISTS event_operation_history_no_${operation.toLowerCase()} BEFORE ${operation} ON event_operation_history BEGIN SELECT RAISE(ABORT, 'Event operation is immutable'); END;`,
        );
    } catch (error) {
      this.db.close();
      throw error;
    }
  }
  close(): void {
    this.db.close();
  }
  private insertEvent(event: Event): Event {
    this.db
      .query('INSERT INTO events(id, data) VALUES (?, ?)')
      .run(event.id, JSON.stringify(event));
    this.appendOperation('event.publish', event);
    return event;
  }
  publish(event: Event): Event {
    return this.db.transaction(() => this.insertEvent(event)).immediate();
  }
  publishOnce(event: Event): Event {
    const planned = createEvent(event, event);
    return this.db
      .transaction(() => {
        const row = this.db.query('SELECT data FROM events WHERE id=?').get(planned.id);
        if (record(row)) {
          const stored = decodeEvent(row.data);
          if (!isDeepStrictEqual(stored, planned)) throw new Error('Event idempotency conflict');
          return stored;
        }
        return this.insertEvent(planned);
      })
      .immediate();
  }
  get(id: string): Event {
    const row = this.db.query('SELECT data FROM events WHERE id=?').get(id);
    if (!record(row)) throw new Error('Event not found');
    return decodeEvent(row.data);
  }
  list(): readonly Event[] {
    return this.db
      .query('SELECT data FROM events ORDER BY sequence')
      .all()
      .map((row) => {
        if (!record(row)) throw new Error('Invalid stored Event');
        return decodeEvent(row.data);
      });
  }
  subscribe(subscription: Subscription): Subscription {
    return this.db
      .transaction(() => {
        this.db
          .query('INSERT INTO subscriptions(id, data) VALUES (?, ?)')
          .run(subscription.id, JSON.stringify(subscription));
        this.appendOperation('subscription.create', subscription);
        return subscription;
      })
      .immediate();
  }
  subscriptions(): readonly Subscription[] {
    return this.db
      .query('SELECT data FROM subscriptions ORDER BY id')
      .all()
      .map((row) => {
        if (!record(row)) throw new Error('Invalid stored Subscription');
        return decodeSubscription(row.data);
      });
  }
  setEnabled(id: string, enabled: boolean): Subscription {
    if (typeof enabled !== 'boolean') throw new Error('Invalid Subscription enabled flag');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const row = this.db.query('SELECT data FROM subscriptions WHERE id=?').get(id);
      if (!record(row)) throw new Error('Subscription not found');
      const before = decodeSubscription(row.data);
      if (before.enabled === enabled) {
        this.db.exec('COMMIT');
        return before;
      }
      const subscription = { ...before, enabled };
      this.db
        .query('UPDATE subscriptions SET data=? WHERE id=?')
        .run(JSON.stringify(subscription), id);
      this.appendOperation(
        enabled ? 'subscription.enable' : 'subscription.disable',
        subscription,
        before,
      );
      this.db.exec('COMMIT');
      return subscription;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  private appendOperation(
    tool: string,
    original: Event | Subscription,
    before?: Subscription,
  ): void {
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
      throw new Error('Invalid Event Audit actor/timestamp');
    const row = this.db
      .query<{ sequence: number }, []>(
        'SELECT COALESCE(MAX(sequence),0)+1 AS sequence FROM event_operation_history',
      )
      .get();
    if (!row) throw new Error('Missing Event Audit sequence');
    const sequence = row.sequence;
    const isEvent = tool === 'event.publish';
    const ref = isEvent
      ? `org://events/${encodeURIComponent(original.id)}`
      : `org://subscription-operations/${sequence}`;
    const entry: Omit<AuditEntry, 'id'> = {
      actor,
      taskId: null,
      eventId: isEvent ? original.id : null,
      tool,
      inputRef: isEvent ? ref : ref + '/input',
      outputRef: isEvent ? ref : ref + '/output',
      at,
      result: 'succeeded',
      approvalId: null,
    };
    this.db
      .query('INSERT INTO event_operation_history(sequence,data) VALUES (?,?)')
      .run(
        sequence,
        JSON.stringify(
          isEvent ? { entry } : { entry, input: before ?? original, output: original },
        ),
      );
  }
  operationHistory(): readonly AuditEntry[] {
    return this.db
      .query<{ sequence: number; data: string }, []>(
        'SELECT sequence,data FROM event_operation_history ORDER BY sequence',
      )
      .all()
      .map((row) => {
        const id = `event:operation:${String(row.sequence).padStart(16, '0')}`;
        return {
          ...(JSON.parse(row.data) as { entry: Omit<AuditEntry, 'id'> }).entry,
          id,
          causalId: id,
        };
      });
  }
}
