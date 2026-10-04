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
export class SqliteEventBus implements EventBus {
  private readonly db: Database;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path, { create: true });
    try {
      this.db.exec(`PRAGMA busy_timeout=5000;
        CREATE TABLE IF NOT EXISTS events(sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, data TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS subscriptions(id TEXT PRIMARY KEY, data TEXT NOT NULL);
        CREATE TRIGGER IF NOT EXISTS events_no_update BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT, 'Events are immutable'); END;
        CREATE TRIGGER IF NOT EXISTS events_no_delete BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT, 'Events are immutable'); END;`);
    } catch (error) {
      this.db.close();
      throw error;
    }
  }
  close(): void {
    this.db.close();
  }
  publish(event: Event): Event {
    this.db
      .query('INSERT INTO events(id, data) VALUES (?, ?)')
      .run(event.id, JSON.stringify(event));
    return event;
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
    this.db
      .query('INSERT INTO subscriptions(id, data) VALUES (?, ?)')
      .run(subscription.id, JSON.stringify(subscription));
    return subscription;
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
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const row = this.db.query('SELECT data FROM subscriptions WHERE id=?').get(id);
      if (!record(row)) throw new Error('Subscription not found');
      const subscription = { ...decodeSubscription(row.data), enabled };
      this.db
        .query('UPDATE subscriptions SET data=? WHERE id=?')
        .run(JSON.stringify(subscription), id);
      this.db.exec('COMMIT');
      return subscription;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}
