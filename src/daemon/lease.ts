import { mkdirSync, realpathSync, lstatSync } from 'node:fs';
import { dirname, basename, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Database } from 'bun:sqlite';
function missing(error: unknown): boolean {
  return error !== null && typeof error === 'object' && 'code' in error && error.code === 'ENOENT';
}
function canonicalDatabase(path: string): string {
  if (path === ':memory:') throw new Error('Daemon requires a filesystem database');
  const absolute = resolve(path);
  mkdirSync(dirname(absolute), { recursive: true, mode: 0o700 });
  try {
    return realpathSync(absolute);
  } catch (error) {
    if (!missing(error)) throw error;
    try {
      if (lstatSync(absolute).isSymbolicLink())
        throw new Error('Database symlink target must exist');
    } catch (statError) {
      if (!missing(statError)) throw statError;
    }
    return join(realpathSync(dirname(absolute)), basename(absolute));
  }
}
function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error !== null && typeof error === 'object' && 'code' in error) {
      if (error.code === 'ESRCH') return false;
      if (error.code === 'EPERM') return true;
    }
    throw error;
  }
}
export interface DatabaseLease {
  readonly databasePath: string;
  close(): void;
}
export function acquireDatabaseLease(
  path: string,
  alive: (pid: number) => boolean = processAlive,
): DatabaseLease {
  const databasePath = canonicalDatabase(path);
  const mask = process.umask(0o077);
  let db: Database;
  try {
    db = new Database(databasePath, { create: true });
  } finally {
    process.umask(mask);
  }
  const token = randomUUID();
  try {
    db.exec(
      'PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS daemon_owner(id INTEGER PRIMARY KEY CHECK(id=1),token TEXT NOT NULL,pid INTEGER NOT NULL);',
    );
    db.exec('BEGIN IMMEDIATE');
    try {
      const owner: unknown = db.query('SELECT pid FROM daemon_owner WHERE id=1').get();
      if (owner !== null) {
        if (
          typeof owner !== 'object' ||
          !('pid' in owner) ||
          typeof owner.pid !== 'number' ||
          !Number.isInteger(owner.pid) ||
          owner.pid < 1 ||
          owner.pid > 2147483647
        )
          throw new Error('Invalid database ownership record');
        if (alive(owner.pid)) throw new Error('Database is already owned by a live daemon');
      }
      db.query(
        'INSERT INTO daemon_owner(id,token,pid) VALUES (1,?,?) ON CONFLICT(id) DO UPDATE SET token=excluded.token,pid=excluded.pid',
      ).run(token, process.pid);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  } catch (error) {
    db.close();
    throw error;
  }
  let closed = false;
  return {
    databasePath,
    close: () => {
      if (closed) return;
      try {
        db.query('DELETE FROM daemon_owner WHERE id=1 AND token=?').run(token);
      } finally {
        closed = true;
        db.close();
      }
    },
  };
}
