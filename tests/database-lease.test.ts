import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync, symlinkSync, statSync, realpathSync } from 'node:fs';
import { acquireDatabaseLease } from '../src/daemon/lease.js';
test('Database lease rejects live owners across aliases and releases only its own token', () => {
  const home = mkdtempSync('/tmp/org-lease-');
  const path = home + '/org.db';
  let lease: ReturnType<typeof acquireDatabaseLease> | undefined;
  let db: Database | undefined;
  try {
    lease = acquireDatabaseLease(path);
    assert.equal(statSync(path).mode & 0o777, 0o600);
    assert.throws(() => acquireDatabaseLease(path), /already owned/);
    const alias = home + '/alias.db';
    symlinkSync(path, alias);
    assert.throws(() => acquireDatabaseLease(alias), /already owned/);
    db = new Database(path);
    db.query('UPDATE daemon_owner SET token=? WHERE id=1').run('replacement');
    lease.close();
    lease = undefined;
    assert.deepEqual(db.query('SELECT token FROM daemon_owner').get(), { token: 'replacement' });
    lease = acquireDatabaseLease(alias, () => false);
    assert.equal(lease.databasePath, realpathSync(path));
    lease.close();
    lease = undefined;
    assert.deepEqual(db.query('SELECT token FROM daemon_owner').all(), []);
    lease = acquireDatabaseLease(path);
    lease.close();
    lease = undefined;
    assert.throws(() => acquireDatabaseLease(':memory:'), /filesystem/);
  } finally {
    lease?.close();
    db?.close();
    rmSync(home, { recursive: true, force: true });
  }
});

test('A terminated process leaves a lease that the real liveness check can safely reacquire', () => {
  const home = mkdtempSync('/tmp/org-lease-dead-');
  const path = home + '/org.db';
  let lease: ReturnType<typeof acquireDatabaseLease> | undefined;
  let db: Database | undefined;
  try {
    const module = new URL('../src/daemon/lease.ts', import.meta.url).href;
    const child = Bun.spawnSync([
      process.execPath,
      '--no-env-file',
      '-e',
      `import {acquireDatabaseLease} from ${JSON.stringify(module)}; acquireDatabaseLease(process.argv[1]); process.exit(0);`,
      path,
    ]);
    assert.equal(child.exitCode, 0, child.stderr.toString());
    lease = acquireDatabaseLease(path);
    db = new Database(path);
    assert.deepEqual(db.query('SELECT pid FROM daemon_owner').get(), { pid: process.pid });
    lease.close();
    lease = undefined;
    assert.deepEqual(db.query('SELECT token FROM daemon_owner').all(), []);
  } finally {
    lease?.close();
    db?.close();
    rmSync(home, { recursive: true, force: true });
  }
});
