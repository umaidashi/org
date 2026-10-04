import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Database } from 'bun:sqlite';
import type { Delivery, DeliveryPlan } from './domain.js';
import type { DeliveryJournal } from './port.js';
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function text(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Invalid delivery string');
  return value;
}
function decode(value: unknown): Delivery {
  if (
    !record(value) ||
    (value.status !== 'pending' && value.status !== 'delivered' && value.status !== 'deferred') ||
    typeof value.attempts !== 'number'
  )
    throw new Error('Invalid stored delivery');
  return {
    key: text(value.key),
    eventId: text(value.event_id),
    subscriptionId: text(value.subscription_id),
    taskId: value.task_id === null ? null : text(value.task_id),
    status: value.status,
    attempts: value.attempts,
    reason: value.reason === null ? null : text(value.reason),
  };
}
export class SqliteDeliveryJournal implements DeliveryJournal {
  private readonly db: Database;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path, { create: true });
    try {
      this.db.exec(`PRAGMA busy_timeout=5000;
        CREATE TABLE IF NOT EXISTS deliveries(key TEXT PRIMARY KEY, event_id TEXT NOT NULL, subscription_id TEXT NOT NULL, task_id TEXT, status TEXT NOT NULL, attempts INTEGER NOT NULL, reason TEXT, UNIQUE(event_id, subscription_id));`);
    } catch (error) {
      this.db.close();
      throw error;
    }
  }
  close(): void {
    this.db.close();
  }
  private transaction<T>(work: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  private get(key: string): Delivery {
    const row = this.db.query('SELECT * FROM deliveries WHERE key=?').get(key);
    if (!row) throw new Error('Delivery not found');
    return decode(row);
  }
  begin(plan: DeliveryPlan): Delivery {
    return this.transaction(() => {
      const row = this.db.query('SELECT * FROM deliveries WHERE key=?').get(plan.key);
      if (row) {
        const receipt = decode(row);
        if (receipt.eventId !== plan.event.id || receipt.subscriptionId !== plan.subscription.id)
          throw new Error('Delivery identity conflict');
        if (receipt.status !== 'pending') return receipt;
        this.db.query('UPDATE deliveries SET attempts=attempts+1 WHERE key=?').run(plan.key);
      } else
        this.db
          .query(
            "INSERT INTO deliveries(key, event_id, subscription_id, task_id, status, attempts, reason) VALUES (?, ?, ?, NULL, 'pending', 1, NULL)",
          )
          .run(plan.key, plan.event.id, plan.subscription.id);
      return this.get(plan.key);
    });
  }
  complete(key: string, taskId: string): Delivery {
    return this.transaction(() => {
      const receipt = this.get(key);
      if (receipt.status === 'delivered' && receipt.taskId === taskId) return receipt;
      if (receipt.status !== 'pending') throw new Error('Delivery state conflict');
      this.db
        .query("UPDATE deliveries SET task_id=?, status='delivered' WHERE key=?")
        .run(taskId, key);
      return this.get(key);
    });
  }
  defer(key: string, reason: string): Delivery {
    return this.transaction(() => {
      const receipt = this.get(key);
      if (receipt.status === 'deferred' && receipt.reason === reason) return receipt;
      if (receipt.status !== 'pending') throw new Error('Delivery state conflict');
      this.db
        .query("UPDATE deliveries SET reason=?, status='deferred' WHERE key=?")
        .run(reason, key);
      return this.get(key);
    });
  }
  list(): readonly Delivery[] {
    return this.db
      .query('SELECT * FROM deliveries ORDER BY key')
      .all()
      .map((row) => decode(row));
  }
}
