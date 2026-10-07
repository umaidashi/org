import type { AuditActor, AuditEntry } from '../audit/domain.js';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Database } from 'bun:sqlite';
import { isDeepStrictEqual } from 'node:util';
import { decodeMemory, replaceMemory, memorySearchPhrase } from './domain.js';
import type { Memory } from './domain.js';
import type { MemoryProvider, MemoryOperationContext } from './port.js';
import type { MemoryConsolidationHistory } from './nightly.js';
import {
  planMemoryConsolidation,
  validateConsolidationRequest,
  validateConsolidationScope,
  type MemoryConsolidationPlan,
  type MemoryConsolidationReceipt,
  type MemoryConsolidationStore,
} from './consolidation.js';
function consolidationReceipt(row: unknown): MemoryConsolidationReceipt | null {
  if (row === null) return null;
  if (typeof row !== 'object' || !('data' in row) || typeof row.data !== 'string')
    throw new Error('Stored Memory consolidation missing');
  const value: unknown = JSON.parse(row.data);
  if (
    !value ||
    typeof value !== 'object' ||
    !('key' in value) ||
    !('scope' in value) ||
    !('at' in value) ||
    !('keepers' in value) ||
    !('invalidated' in value) ||
    typeof value.key !== 'string' ||
    typeof value.scope !== 'string' ||
    typeof value.at !== 'string' ||
    !Array.isArray(value.keepers) ||
    !Array.isArray(value.invalidated)
  )
    throw new Error('Invalid stored Memory consolidation');
  const ids = (values: readonly unknown[]): readonly string[] =>
    values.map((id) => {
      if (typeof id !== 'string' || !id.trim())
        throw new Error('Invalid consolidation Memory reference');
      return id;
    });
  const receipt = {
    key: value.key,
    scope: value.scope,
    at: value.at,
    keepers: ids(value.keepers),
    invalidated: ids(value.invalidated),
  };
  validateConsolidationRequest(receipt);
  if (
    new Set([...receipt.keepers, ...receipt.invalidated]).size !==
    receipt.keepers.length + receipt.invalidated.length
  )
    throw new Error('Conflicting consolidation Memory references');
  return receipt;
}
function rowMemory(row: unknown): Memory {
  if (row === null || typeof row !== 'object' || !('data' in row) || typeof row.data !== 'string')
    throw new Error('Stored Memory missing');
  const value: unknown = JSON.parse(row.data);
  return decodeMemory(value);
}
export class SqliteMemoryProvider
  implements MemoryProvider, MemoryConsolidationStore, MemoryConsolidationHistory
{
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
   CREATE TABLE IF NOT EXISTS memory_operation_history(sequence INTEGER PRIMARY KEY AUTOINCREMENT,data TEXT NOT NULL CHECK(json_valid(data)));
   CREATE TRIGGER IF NOT EXISTS memory_operations_no_replace BEFORE INSERT ON memory_operation_history WHEN EXISTS(SELECT 1 FROM memory_operation_history WHERE sequence=NEW.sequence) BEGIN SELECT RAISE(ABORT,'Memory operation immutable'); END;
   CREATE TRIGGER IF NOT EXISTS memory_operations_no_update BEFORE UPDATE ON memory_operation_history BEGIN SELECT RAISE(ABORT,'Memory operation immutable'); END;
   CREATE TRIGGER IF NOT EXISTS memory_operations_no_delete BEFORE DELETE ON memory_operation_history BEGIN SELECT RAISE(ABORT,'Memory operation immutable'); END;
   CREATE TABLE IF NOT EXISTS memory_records(sequence INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,data TEXT NOT NULL,supersedes TEXT UNIQUE);
   CREATE TABLE IF NOT EXISTS memory_invalidations(id TEXT PRIMARY KEY,reason TEXT NOT NULL,at TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS memory_consolidations(key TEXT PRIMARY KEY,data TEXT NOT NULL);
   CREATE TRIGGER IF NOT EXISTS memory_consolidations_no_replace BEFORE INSERT ON memory_consolidations WHEN EXISTS(SELECT 1 FROM memory_consolidations WHERE key=NEW.key OR rowid=NEW.rowid) BEGIN SELECT RAISE(ABORT,'Memory consolidation immutable'); END;
   CREATE TRIGGER IF NOT EXISTS memory_consolidations_no_update BEFORE UPDATE ON memory_consolidations BEGIN SELECT RAISE(ABORT,'Memory consolidation immutable'); END;
   CREATE TRIGGER IF NOT EXISTS memory_consolidations_no_delete BEFORE DELETE ON memory_consolidations BEGIN SELECT RAISE(ABORT,'Memory consolidation immutable'); END;
   CREATE TRIGGER IF NOT EXISTS memory_records_no_conflicting_replace BEFORE INSERT ON memory_records WHEN EXISTS(SELECT 1 FROM memory_records WHERE id=NEW.id OR sequence=NEW.sequence OR (NEW.supersedes IS NOT NULL AND supersedes=NEW.supersedes)) BEGIN SELECT RAISE(ABORT,'Memory immutable'); END;
   CREATE TRIGGER IF NOT EXISTS memory_records_no_update BEFORE UPDATE ON memory_records BEGIN SELECT RAISE(ABORT,'Memory immutable'); END;
   CREATE TRIGGER IF NOT EXISTS memory_records_no_delete BEFORE DELETE ON memory_records BEGIN SELECT RAISE(ABORT,'Memory immutable'); END;
   CREATE TRIGGER IF NOT EXISTS memory_invalidations_no_replace BEFORE INSERT ON memory_invalidations WHEN EXISTS(SELECT 1 FROM memory_invalidations WHERE id=NEW.id) BEGIN SELECT RAISE(ABORT,'Memory invalidation immutable'); END;
   CREATE TRIGGER IF NOT EXISTS memory_invalidations_no_rowid_replace BEFORE INSERT ON memory_invalidations WHEN EXISTS(SELECT 1 FROM memory_invalidations WHERE rowid=NEW.rowid) BEGIN SELECT RAISE(ABORT,'Memory invalidation immutable'); END;
   CREATE TRIGGER IF NOT EXISTS memory_invalidations_no_update BEFORE UPDATE ON memory_invalidations BEGIN SELECT RAISE(ABORT,'Memory invalidation immutable'); END;
   CREATE TRIGGER IF NOT EXISTS memory_invalidations_no_delete BEFORE DELETE ON memory_invalidations BEGIN SELECT RAISE(ABORT,'Memory invalidation immutable'); END;`);
      this.db
        .transaction(() => {
          if (
            this.db
              .query("SELECT name FROM sqlite_schema WHERE type='table' AND name='memory_search'")
              .get()
          )
            return;
          this.db.exec(`
          CREATE VIEW IF NOT EXISTS memory_search_content AS SELECT sequence AS rowid,json_extract(data,'$.content') AS content FROM memory_records;
          CREATE VIRTUAL TABLE memory_search USING fts5(content,content='memory_search_content',content_rowid='rowid',tokenize='trigram');
          CREATE TRIGGER IF NOT EXISTS memory_records_search_insert AFTER INSERT ON memory_records BEGIN
            INSERT INTO memory_search(rowid,content) VALUES(new.sequence,json_extract(new.data,'$.content'));
          END;
          INSERT INTO memory_search(memory_search) VALUES('rebuild');
        `);
        })
        .immediate();
    } catch (error) {
      this.db.close();
      throw error;
    }
  }
  close(): void {
    this.db.close();
  }
  getConsolidation(key: string): MemoryConsolidationReceipt | null {
    const receipt = consolidationReceipt(
      this.db.query('SELECT data FROM memory_consolidations WHERE key=?').get(key),
    );
    if (receipt !== null && receipt.key !== key)
      throw new Error('Stored Memory consolidation key mismatch');
    return receipt;
  }
  latestConsolidation(prefix: string): MemoryConsolidationReceipt | null {
    if (!/^(?:nightly-memory|nightly-scoped-memory):[a-f0-9]{64}:$/.test(prefix))
      throw new Error('Invalid nightly consolidation prefix');
    const row = this.db
      .query(
        'SELECT key FROM memory_consolidations WHERE key>=? AND key<? ORDER BY key DESC LIMIT 1',
      )
      .get(prefix, prefix + '\uffff');
    if (row === null) return null;
    if (
      typeof row !== 'object' ||
      !('key' in row) ||
      typeof row.key !== 'string' ||
      !row.key.startsWith(prefix)
    )
      throw new Error('Invalid consolidation history key');
    return this.getConsolidation(row.key);
  }
  listConsolidations(scope: string): readonly MemoryConsolidationReceipt[] {
    validateConsolidationScope(scope);
    const rows = this.db
      .query(
        "SELECT key FROM memory_consolidations WHERE json_extract(data,'$.scope')=? ORDER BY rowid",
      )
      .all(scope);
    return rows.map((row) => {
      if (row === null || typeof row !== 'object' || !('key' in row) || typeof row.key !== 'string')
        throw new Error('Invalid consolidation history key');
      const receipt = this.getConsolidation(row.key);
      if (!receipt || receipt.scope !== scope)
        throw new Error('Invalid consolidation history scope');
      return receipt;
    });
  }
  commitConsolidation(
    plan: MemoryConsolidationPlan,
    authorize: () => void,
  ): MemoryConsolidationReceipt {
    validateConsolidationRequest(plan);
    return this.atomic(() => {
      authorize();
      const previous = this.getConsolidation(plan.key);
      if (previous) {
        if (previous.scope !== plan.scope)
          throw new Error('Memory consolidation key scope conflict');
        return previous;
      }
      const request = { key: plan.key, scope: plan.scope, at: plan.at };
      const expected = planMemoryConsolidation(this.list([plan.scope]), request);
      if (!isDeepStrictEqual(expected, plan))
        throw new Error('Memory consolidation snapshot conflict');
      for (const { keeper, obsolete } of plan.duplicates) {
        this.db
          .query('INSERT INTO memory_invalidations(id,reason,at) VALUES (?,?,?)')
          .run(
            obsolete.id,
            'Exact duplicate of org://memories/' + encodeURIComponent(keeper.id),
            plan.at,
          );
      }
      const receipt: MemoryConsolidationReceipt = {
        ...request,
        keepers: [...new Set(plan.duplicates.map((pair) => pair.keeper.id))].sort(),
        invalidated: plan.duplicates.map((pair) => pair.obsolete.id),
      };
      this.db
        .query('INSERT INTO memory_consolidations(key,data) VALUES (?,?)')
        .run(plan.key, JSON.stringify(receipt));
      this.appendOperation(
        'memory.consolidate',
        'org://memory-scopes/' + encodeURIComponent(plan.scope),
        'org://memory-consolidations/' + encodeURIComponent(plan.key),
      );
      return receipt;
    });
  }
  private appendOperation(
    tool: string,
    inputRef: string,
    outputRef: string,
    context: MemoryOperationContext = { actor: this.auditActor },
  ): void {
    const { actor, taskId } = context;
    const at = this.auditNow();
    if (
      !['human', 'agent', 'system'].includes(actor.kind) ||
      (taskId !== undefined && (!taskId.trim() || taskId.includes('\0'))) ||
      !actor.id.trim() ||
      actor.id.includes('\0') ||
      actor.id.length > 128 ||
      !Number.isFinite(new Date(at).getTime()) ||
      new Date(at).toISOString() !== at
    )
      throw new Error('Invalid Memory Audit actor/timestamp');
    const entry: Omit<AuditEntry, 'id'> = {
      causalId: 'org://memory-operations',
      actor,
      taskId: taskId ?? null,
      eventId: null,
      tool,
      inputRef,
      outputRef,
      at,
      result: 'succeeded',
      approvalId: null,
    };
    this.db
      .query('INSERT INTO memory_operation_history(data) VALUES (?)')
      .run(JSON.stringify(entry));
  }
  operationHistory(): readonly AuditEntry[] {
    return this.db
      .query<{ sequence: number; data: string }, []>(
        'SELECT sequence,data FROM memory_operation_history ORDER BY sequence',
      )
      .all()
      .map((row) => ({
        ...(JSON.parse(row.data) as Omit<AuditEntry, 'id'>),
        id: 'memory:operation:' + row.sequence,
      }));
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
  create(memory: Memory, context?: MemoryOperationContext): Memory {
    const original = decodeMemory(memory);
    if (memory.status !== 'active') throw new Error('New Memory must be active');
    return this.atomic(() => this.insert(original, context));
  }
  private insert(original: Memory, context?: MemoryOperationContext): Memory {
    if (original.supersedes !== null) replaceMemory(this.get(original.supersedes), original);
    this.db
      .query('INSERT INTO memory_records(id,data,supersedes) VALUES (?,?,?)')
      .run(original.id, JSON.stringify(original), original.supersedes);
    const ref = 'org://memories/' + encodeURIComponent(original.id);
    this.appendOperation(
      original.supersedes === null ? 'memory.capture' : 'memory.supersede',
      original.supersedes === null
        ? ref
        : 'org://memories/' + encodeURIComponent(original.supersedes),
      ref,
      context,
    );
    return this.get(original.id);
  }
  createOnce(memory: Memory, context?: MemoryOperationContext): Memory {
    const original = decodeMemory(memory);
    if (memory.status !== 'active') throw new Error('New Memory must be active');
    return this.atomic(() => {
      const row = this.db.query('SELECT data FROM memory_records WHERE id=?').get(original.id);
      if (row === null) return this.insert(original, context);
      if (!isDeepStrictEqual(rowMemory(row), original))
        throw new Error('Memory idempotency conflict');
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
  search(query: string, scopes?: readonly string[]): readonly Memory[] {
    const phrase = memorySearchPhrase(query);
    if (scopes?.length === 0) return [];
    const scopeFilter =
      scopes === undefined
        ? ''
        : ` AND json_extract(r.data,'$.scope') IN (${scopes.map(() => '?').join(',')})`;
    return this.db
      .query(
        `SELECT r.data FROM memory_search JOIN memory_records r ON r.sequence=memory_search.rowid WHERE memory_search MATCH ?${scopeFilter} ORDER BY r.sequence`,
      )
      .all(phrase, ...(scopes ?? []))
      .map((row) => this.get(rowMemory(row).id));
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
      const ref = 'org://memories/' + encodeURIComponent(id);
      this.appendOperation('memory.invalidate', ref, ref + '/invalidation');
      return this.get(id);
    });
  }
}
