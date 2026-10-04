import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
test('Another daemon on a different socket cannot recover or own the active database', async () => {
  const home = mkdtempSync('/tmp/org-db-owner-');
  const db = home + '/org.db';
  const firstSocket = home + '/first.sock';
  const secondSocket = home + '/second.sock';
  const first = spawn(process.execPath, [
    '--no-env-file',
    cli,
    '--db',
    db,
    'daemon',
    '--socket',
    firstSocket,
  ]);
  const exited = new Promise<number | null>((resolve) => first.once('exit', resolve));
  let error = '';
  first.stderr.on('data', (data: Buffer) => {
    error += data.toString();
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('First daemon not ready: ' + error)), 5000);
      first.stdout.on('data', (data: Buffer) => {
        if (data.toString().includes('"ready"')) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    const second = spawnSync(
      process.execPath,
      ['--no-env-file', cli, '--db', db, 'daemon', '--socket', secondSocket],
      { encoding: 'utf8', timeout: 1500 },
    );
    assert.equal(second.status, 1, second.stderr);
    assert.match(second.stderr, /Database is already owned/);
    assert.equal(existsSync(secondSocket), false);
    assert.equal(existsSync(secondSocket + '.lock'), false);
    const status = spawnSync(
      process.execPath,
      ['--no-env-file', cli, 'daemon', 'status', '--socket', firstSocket, '--json'],
      { encoding: 'utf8', timeout: 5000 },
    );
    assert.equal(status.status, 0, status.stderr);
  } finally {
    spawnSync(process.execPath, ['--no-env-file', cli, 'daemon', 'stop', '--socket', firstSocket], {
      encoding: 'utf8',
      timeout: 5000,
    });
    first.kill('SIGTERM');
    await exited;
    rmSync(home, { recursive: true, force: true });
  }
});
