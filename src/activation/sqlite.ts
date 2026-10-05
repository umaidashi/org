import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { WakeupIntent, WakeupResult, WakeupReceipt, WakeupJournal } from './port.js';
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Invalid Wakeup string');
  return value;
}
function parse(value: unknown): Record<string, unknown> {
  const data: unknown = JSON.parse(text(value));
  if (!record(data)) throw new Error('Invalid Wakeup record');
  return data;
}
function intent(value: Record<string, unknown>): WakeupIntent {
  return {
    messageId: text(value.messageId),
    roomId: text(value.roomId),
    startedAt: text(value.startedAt),
  };
}
function result(value: Record<string, unknown>): WakeupResult {
  if (!Array.isArray(value.replyIds)) throw new Error('Invalid Wakeup reply IDs');
  const replyIds = value.replyIds.map((id: unknown) => text(id));
  if (new Set(replyIds).size !== replyIds.length) throw new Error('Duplicate Wakeup reply IDs');
  const finishedAt = text(value.finishedAt);
  if (value.status === 'completed' && value.error === null)
    return { status: 'completed', replyIds, error: null, finishedAt };
  if (value.status === 'failed')
    return { status: 'failed', replyIds, error: text(value.error), finishedAt };
  throw new Error('Invalid Wakeup result');
}
function project(raw: unknown): WakeupReceipt {
  if (!record(raw)) throw new Error('Invalid Wakeup row');
  const planned = intent(parse(raw.intent));
  if (planned.messageId !== raw.id) throw new Error('Wakeup intent mismatch');
  return raw.result === null
    ? { ...planned, status: 'running', replyIds: [], error: null, finishedAt: null }
    : { ...planned, ...result(parse(raw.result)) };
}
export class SqliteWakeupJournal implements WakeupJournal {
  private readonly db: Database;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path, { create: true });
    try {
      this.db.exec(`PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;
        CREATE TABLE IF NOT EXISTS wakeup_intents(sequence INTEGER PRIMARY KEY AUTOINCREMENT,message_id TEXT UNIQUE NOT NULL,data TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS wakeup_results(sequence INTEGER PRIMARY KEY AUTOINCREMENT,message_id TEXT UNIQUE NOT NULL REFERENCES wakeup_intents(message_id),data TEXT NOT NULL);
        CREATE TRIGGER IF NOT EXISTS wakeup_result_requires_intent BEFORE INSERT ON wakeup_results WHEN NOT EXISTS(SELECT 1 FROM wakeup_intents WHERE message_id=NEW.message_id) BEGIN SELECT RAISE(ABORT,'Wakeup intent not found'); END;`);
      for (const table of ['wakeup_intents', 'wakeup_results'])
        this.db.exec(`
        CREATE TRIGGER IF NOT EXISTS ${table}_no_replace BEFORE INSERT ON ${table} WHEN EXISTS(SELECT 1 FROM ${table} WHERE message_id=NEW.message_id OR sequence=NEW.sequence) BEGIN SELECT RAISE(ABORT,'Wakeup records are immutable'); END;
        CREATE TRIGGER IF NOT EXISTS ${table}_no_update BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT,'Wakeup records are immutable'); END;
        CREATE TRIGGER IF NOT EXISTS ${table}_no_delete BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT,'Wakeup records are immutable'); END;`);
    } catch (error) {
      this.db.close();
      throw error;
    }
  }
  close(): void {
    this.db.close();
  }
  claim(value: WakeupIntent): boolean {
    const planned = intent({ ...value });
    return this.db
      .transaction(() => {
        if (this.get(planned.messageId)) return false;
        this.db
          .query('INSERT INTO wakeup_intents(message_id,data) VALUES (?,?)')
          .run(planned.messageId, JSON.stringify(planned));
        return true;
      })
      .immediate();
  }
  finish(messageId: string, value: WakeupResult): void {
    const completed = result({ ...value });
    text(messageId);
    this.db
      .transaction(() => {
        const planned = this.get(messageId);
        if (!planned) throw new Error('Wakeup intent not found');
        if (planned.status !== 'running') throw new Error('Wakeup result already recorded');
        this.db
          .query('INSERT INTO wakeup_results(message_id,data) VALUES (?,?)')
          .run(messageId, JSON.stringify(completed));
      })
      .immediate();
  }
  get(messageId: string): WakeupReceipt | undefined {
    const row = this.db
      .query(
        'SELECT i.message_id AS id,i.data AS intent,r.data AS result FROM wakeup_intents i LEFT JOIN wakeup_results r ON r.message_id=i.message_id WHERE i.message_id=?',
      )
      .get(messageId);
    return row === null ? undefined : project(row);
  }
  list(): readonly WakeupReceipt[] {
    return this.db
      .query(
        'SELECT i.message_id AS id,i.data AS intent,r.data AS result FROM wakeup_intents i LEFT JOIN wakeup_results r ON r.message_id=i.message_id ORDER BY i.sequence',
      )
      .all()
      .map(project);
  }
}
