import type { AuditActor, AuditEntry } from '../audit/domain.js';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Database } from 'bun:sqlite';
import { decodeSession, transitionSession } from './domain.js';
import type { Session } from './domain.js';
import type { SessionStore, SessionRebuilder, SessionOperationContext } from './port.js';
function decodeRow(row: unknown): Session {
  if (typeof row !== 'object' || row === null || !('data' in row) || typeof row.data !== 'string')
    throw new Error('Invalid stored Session');
  const value: unknown = JSON.parse(row.data);
  return decodeSession(value);
}
export class SqliteSessionStore implements SessionStore, SessionRebuilder {
  private readonly db: Database;
  constructor(
    path: string,
    private readonly auditActor: AuditActor = { kind: 'system', id: 'unspecified' },
  ) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path, { create: true });
    try {
      this.db.exec(`PRAGMA busy_timeout=5000;
        CREATE TABLE IF NOT EXISTS session_operation_history(sequence INTEGER PRIMARY KEY AUTOINCREMENT,data TEXT NOT NULL CHECK(json_valid(data)));
        CREATE TRIGGER IF NOT EXISTS session_operations_no_replace BEFORE INSERT ON session_operation_history WHEN EXISTS(SELECT 1 FROM session_operation_history WHERE sequence=NEW.sequence) BEGIN SELECT RAISE(ABORT,'Session operation immutable'); END;
        CREATE TRIGGER IF NOT EXISTS session_operations_no_update BEFORE UPDATE ON session_operation_history BEGIN SELECT RAISE(ABORT,'Session operation immutable'); END;
        CREATE TRIGGER IF NOT EXISTS session_operations_no_delete BEFORE DELETE ON session_operation_history BEGIN SELECT RAISE(ABORT,'Session operation immutable'); END;
        CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, version INTEGER NOT NULL, data TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS session_history(id TEXT NOT NULL, version INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY(id, version));
        CREATE TRIGGER IF NOT EXISTS session_history_no_replace BEFORE INSERT ON session_history WHEN EXISTS(SELECT 1 FROM session_history WHERE id=NEW.id AND version=NEW.version) BEGIN SELECT RAISE(ABORT, 'Session history immutable'); END;
        CREATE TRIGGER IF NOT EXISTS session_history_no_rowid_replace BEFORE INSERT ON session_history WHEN EXISTS(SELECT 1 FROM session_history WHERE rowid=NEW.rowid) BEGIN SELECT RAISE(ABORT, 'Session history immutable'); END;
        CREATE TRIGGER IF NOT EXISTS session_history_no_update BEFORE UPDATE ON session_history BEGIN SELECT RAISE(ABORT, 'Session history immutable'); END;
        CREATE TRIGGER IF NOT EXISTS session_history_no_delete BEFORE DELETE ON session_history BEGIN SELECT RAISE(ABORT, 'Session history immutable'); END;`);
    } catch (error) {
      this.db.close();
      throw error;
    }
  }
  close(): void {
    this.db.close();
  }
  private ref(session: Session): string {
    return 'org://sessions/' + encodeURIComponent(session.id) + '/versions/' + session.version;
  }
  private appendOperation(
    session: Session,
    tool: string,
    result: AuditEntry['result'],
    inputRef: string,
    context: SessionOperationContext = { actor: this.auditActor },
  ): void {
    const { actor } = context;
    const taskId =
      context.taskId ??
      this.db
        .query<{ taskId: string | null }, [string]>(
          "SELECT json_extract(data,'$.taskId') AS taskId FROM session_operation_history WHERE json_extract(data,'$.outputRef')=? ORDER BY sequence DESC LIMIT 1",
        )
        .get(inputRef)?.taskId ??
      null;
    if (
      !['human', 'agent', 'system'].includes(actor.kind) ||
      !actor.id.trim() ||
      actor.id.includes('\0') ||
      actor.id.length > 128 ||
      (taskId !== null && (!taskId.trim() || taskId.includes('\0'))) ||
      (context.inputRef !== undefined &&
        (!context.inputRef.startsWith('org://') ||
          context.inputRef.includes('\0') ||
          context.inputRef.length > 2048))
    )
      throw new Error('Invalid Session Audit context');
    const entry: Omit<AuditEntry, 'id'> = {
      actor,
      taskId: taskId ?? null,
      eventId: null,
      tool,
      inputRef: context.inputRef ?? inputRef,
      outputRef: this.ref(session),
      at: session.updatedAt,
      result,
      approvalId: null,
    };
    this.db
      .query('INSERT INTO session_operation_history(data) VALUES(?)')
      .run(JSON.stringify(entry));
  }
  operationHistory(): readonly AuditEntry[] {
    return this.db
      .query<{ sequence: number; data: string }, []>(
        'SELECT sequence,data FROM session_operation_history ORDER BY sequence',
      )
      .all()
      .map((row) => {
        const id = 'session:operation:' + String(row.sequence).padStart(16, '0');
        return { ...(JSON.parse(row.data) as Omit<AuditEntry, 'id'>), id, causalId: id };
      });
  }
  private atomic(operation: () => void): void {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      operation();
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  private append(session: Session): void {
    this.db
      .query('INSERT INTO session_history(id,version,data) VALUES(?,?,?)')
      .run(session.id, session.version, JSON.stringify(session));
  }
  create(input: Session, context?: SessionOperationContext): void {
    const session = decodeSession(input);
    if (
      session.version !== 0 ||
      session.status !== 'idle' ||
      session.providerSessionId !== null ||
      session.rebuiltFrom !== undefined
    )
      throw new Error('Session creation requires initial state');
    this.atomic(() => {
      this.db
        .query('INSERT INTO sessions(id,version,data) VALUES(?,?,?)')
        .run(session.id, 0, JSON.stringify(session));
      this.append(session);
      this.appendOperation(
        session,
        'session.create',
        'succeeded',
        'org://rooms/' + encodeURIComponent(session.roomId),
        context,
      );
    });
  }
  rebuildSession(
    originalId: string,
    expectedVersion: number,
    input: Session,
    context?: SessionOperationContext,
  ): Session {
    const next = decodeSession(input);
    if (
      !Number.isSafeInteger(expectedVersion) ||
      expectedVersion < 0 ||
      next.version !== 0 ||
      next.status !== 'idle' ||
      next.providerSessionId !== null ||
      next.createdAt !== next.updatedAt ||
      next.rebuiltFrom?.sessionId !== originalId ||
      next.rebuiltFrom.version !== expectedVersion
    )
      throw new Error('Invalid Session reconstruction');
    this.atomic(() => {
      const original = this.get(originalId);
      if (original.version !== expectedVersion) throw new Error('Stale Session version');
      if (original.status !== 'failed')
        throw new Error('Session reconstruction requires failed state');
      if (original.agentId !== next.agentId || original.roomId !== next.roomId)
        throw new Error('Session reconstruction identity mismatch');
      const stopped = transitionSession(original, { type: 'stop', at: next.createdAt });
      this.db
        .query('UPDATE sessions SET version=?,data=? WHERE id=? AND version=?')
        .run(stopped.version, JSON.stringify(stopped), original.id, expectedVersion);
      this.append(stopped);
      this.db
        .query('INSERT INTO sessions(id,version,data) VALUES(?,?,?)')
        .run(next.id, 0, JSON.stringify(next));
      this.append(next);
      this.appendOperation(next, 'session.rebuild', 'succeeded', this.ref(original), context);
    });
    return next;
  }
  get(id: string): Session {
    const row = this.db.query('SELECT data FROM sessions WHERE id=?').get(id);
    if (row === null) throw new Error('Session not found');
    return decodeRow(row);
  }
  list(): readonly Session[] {
    return this.db.query('SELECT data FROM sessions ORDER BY id').all().map(decodeRow);
  }
  save(input: Session, expectedVersion: number, context?: SessionOperationContext): void {
    const session = decodeSession(input);
    if (
      !Number.isSafeInteger(expectedVersion) ||
      expectedVersion < 0 ||
      session.version !== expectedVersion + 1
    )
      throw new Error('Invalid Session version');
    this.atomic(() => {
      const current = this.get(session.id);
      if (current.version !== expectedVersion) throw new Error('Stale Session version');
      for (const key of ['agentId', 'roomId', 'runtime', 'createdAt'] as const)
        if (current[key] !== session[key]) throw new Error('Session identity cannot change');
      if (
        current.providerSessionId !== null &&
        current.providerSessionId !== session.providerSessionId
      )
        throw new Error('Session provider ID cannot change');
      const action =
        session.status === 'running'
          ? { type: 'begin' as const, at: session.updatedAt }
          : session.status === 'idle'
            ? {
                type: 'complete' as const,
                at: session.updatedAt,
                providerSessionId: session.providerSessionId ?? '',
              }
            : session.status === 'failed'
              ? { type: 'fail' as const, at: session.updatedAt, error: session.error ?? '' }
              : { type: 'stop' as const, at: session.updatedAt };
      const expected = transitionSession(current, action);
      if (JSON.stringify(expected) !== JSON.stringify(session))
        throw new Error('Invalid Session transition');
      this.db
        .query('UPDATE sessions SET version=?,data=? WHERE id=? AND version=?')
        .run(session.version, JSON.stringify(session), session.id, expectedVersion);
      this.append(session);
      this.appendOperation(
        session,
        session.status === 'stopped' ? 'session.stop' : 'session.runtime',
        session.status === 'running'
          ? 'started'
          : session.status === 'failed'
            ? 'failed'
            : session.status === 'stopped'
              ? 'canceled'
              : 'succeeded',
        this.ref(current),
        context,
      );
    });
  }
  history(id: string): readonly Session[] {
    this.get(id);
    return this.db
      .query('SELECT data FROM session_history WHERE id=? ORDER BY version')
      .all(id)
      .map(decodeRow);
  }
}
