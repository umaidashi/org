import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Database } from 'bun:sqlite';
import { decodeSession, transitionSession } from './domain.js';
import type { Session } from './domain.js';
import type { SessionStore } from './port.js';
function decodeRow(row: unknown): Session {
  if (typeof row !== 'object' || row === null || !('data' in row) || typeof row.data !== 'string')
    throw new Error('Invalid stored Session');
  const value: unknown = JSON.parse(row.data);
  return decodeSession(value);
}
export class SqliteSessionStore implements SessionStore {
  private readonly db: Database;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path, { create: true });
    try {
      this.db.exec(`PRAGMA busy_timeout=5000;
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
  create(input: Session): void {
    const session = decodeSession(input);
    if (session.version !== 0 || session.status !== 'idle' || session.providerSessionId !== null)
      throw new Error('Session creation requires initial state');
    this.atomic(() => {
      this.db
        .query('INSERT INTO sessions(id,version,data) VALUES(?,?,?)')
        .run(session.id, 0, JSON.stringify(session));
      this.append(session);
    });
  }
  get(id: string): Session {
    const row = this.db.query('SELECT data FROM sessions WHERE id=?').get(id);
    if (row === null) throw new Error('Session not found');
    return decodeRow(row);
  }
  list(): readonly Session[] {
    return this.db.query('SELECT data FROM sessions ORDER BY id').all().map(decodeRow);
  }
  save(input: Session, expectedVersion: number): void {
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
