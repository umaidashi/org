import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Database } from 'bun:sqlite';
import { decodeMemory, replaceMemory } from './domain.js';
import type { Memory } from './domain.js';
import type { MemoryProvider } from './port.js';
function rowMemory(row: unknown): Memory {
  if (row === null || typeof row !== 'object' || !('data' in row) || typeof row.data !== 'string')
    throw new Error('Stored Memory missing');
  const value: unknown = JSON.parse(row.data);
  return decodeMemory(value);
}
export class SqliteMemoryProvider implements MemoryProvider {
  private readonly db: Database;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path, { create: true });
    try {
      this.db.exec(`PRAGMA busy_timeout=5000;
   CREATE TABLE IF NOT EXISTS memory_records(sequence INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,data TEXT NOT NULL,supersedes TEXT UNIQUE);
   CREATE TABLE IF NOT EXISTS memory_invalidations(id TEXT PRIMARY KEY,reason TEXT NOT NULL,at TEXT NOT NULL);
   CREATE TRIGGER IF NOT EXISTS memory_records_no_conflicting_replace BEFORE INSERT ON memory_records WHEN EXISTS(SELECT 1 FROM memory_records WHERE id=NEW.id OR sequence=NEW.sequence OR (NEW.supersedes IS NOT NULL AND supersedes=NEW.supersedes)) BEGIN SELECT RAISE(ABORT,'Memory immutable'); END;
   CREATE TRIGGER IF NOT EXISTS memory_records_no_update BEFORE UPDATE ON memory_records BEGIN SELECT RAISE(ABORT,'Memory immutable'); END;
   CREATE TRIGGER IF NOT EXISTS memory_records_no_delete BEFORE DELETE ON memory_records BEGIN SELECT RAISE(ABORT,'Memory immutable'); END;
   CREATE TRIGGER IF NOT EXISTS memory_invalidations_no_replace BEFORE INSERT ON memory_invalidations WHEN EXISTS(SELECT 1 FROM memory_invalidations WHERE id=NEW.id) BEGIN SELECT RAISE(ABORT,'Memory invalidation immutable'); END;
   CREATE TRIGGER IF NOT EXISTS memory_invalidations_no_update BEFORE UPDATE ON memory_invalidations BEGIN SELECT RAISE(ABORT,'Memory invalidation immutable'); END;
   CREATE TRIGGER IF NOT EXISTS memory_invalidations_no_delete BEFORE DELETE ON memory_invalidations BEGIN SELECT RAISE(ABORT,'Memory invalidation immutable'); END;`);
    } catch (error) {
      this.db.close();
      throw error;
    }
  }
  close(): void {
    this.db.close();
  }
  private atomic<T>(operation: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const value = operation();
      this.db.exec('COMMIT');
      return value;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  create(memory: Memory): Memory {
    const original = decodeMemory(memory);
    if (memory.status !== 'active') throw new Error('New Memory must be active');
    return this.atomic(() => {
      if (original.supersedes !== null) replaceMemory(this.get(original.supersedes), original);
      this.db
        .query('INSERT INTO memory_records(id,data,supersedes) VALUES (?,?,?)')
        .run(original.id, JSON.stringify(original), original.supersedes);
      return this.get(original.id);
    });
  }
  get(id: string): Memory {
    const memory = rowMemory(this.db.query('SELECT data FROM memory_records WHERE id=?').get(id));
    if (this.db.query('SELECT id FROM memory_invalidations WHERE id=?').get(id))
      return { ...memory, status: 'invalidated' };
    if (this.db.query('SELECT id FROM memory_records WHERE supersedes=?').get(id))
      return { ...memory, status: 'superseded' };
    return memory;
  }
  list(scopes?: readonly string[]): readonly Memory[] {
    const rows = this.db.query('SELECT data FROM memory_records ORDER BY sequence').all();
    return rows
      .map((row) => this.get(rowMemory(row).id))
      .filter((memory) => scopes === undefined || scopes.includes(memory.scope));
  }
  invalidate(id: string, reason: string, at: string): Memory {
    if (!reason.trim() || !at.trim())
      throw new Error('Memory invalidation requires reason and timestamp');
    return this.atomic(() => {
      if (this.get(id).status !== 'active')
        throw new Error('Only active Memory may be invalidated');
      this.db
        .query('INSERT INTO memory_invalidations(id,reason,at) VALUES (?,?,?)')
        .run(id, reason, at);
      return this.get(id);
    });
  }
}
