import { cli } from './cli-path.js';
import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
test('Agent CLI creates, changes and clears reporting lines through the daemon without cyclic history', async () => {
  const home = mkdtempSync('/tmp/org-reporting-cli-'),
    db = home + '/org.db',
    socket = home + '/org.sock';
  const run = (args: string[]) =>
    spawnSync(process.execPath, ['--no-env-file', cli, '--db', db, '--socket', socket, ...args], {
      encoding: 'utf8',
      timeout: 5000,
    });
  const daemon = spawn(process.execPath, [
    '--no-env-file',
    cli,
    '--db',
    db,
    'daemon',
    '--socket',
    socket,
  ]);
  const exited = new Promise((resolve) => daemon.once('exit', resolve));
  let error = '';
  daemon.stderr.on('data', (value: Buffer) => {
    error += value.toString();
  });
  const json = (args: string[]) => {
    const result = run([...args, '--json']);
    assert.equal(result.status, 0, result.stderr);
    const value: unknown = JSON.parse(result.stdout);
    return value;
  };
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Not ready: ' + error)), 5000);
      daemon.stdout.on('data', (value: Buffer) => {
        if (value.toString().includes('"ready"')) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    assert.equal(
      run(['agent', 'create', 'chief', '--role', 'Chief', '--runtime', 'claude']).status,
      0,
    );
    const roots = json(['agent', 'list']);
    assert.ok(Array.isArray(roots));
    const root: unknown = roots[0];
    assert.ok(record(root) && typeof root.id === 'string');
    assert.equal(
      run([
        'agent',
        'create',
        'cto',
        '--role',
        'CTO',
        '--runtime',
        'codex',
        '--reports-to',
        root.id,
      ]).status,
      0,
    );
    const agents = json(['agent', 'list']);
    assert.ok(Array.isArray(agents));
    const worker: unknown = agents.find((a: unknown) => record(a) && a.name === 'cto');
    assert.ok(record(worker) && typeof worker.id === 'string');
    assert.equal(worker.reportsTo, root.id);
    assert.equal(run(['agent', 'report', root.id, '--to', worker.id]).status, 1);
    const unchanged = json(['agent', 'reporting-history', root.id]);
    assert.deepEqual(unchanged, []);
    const clear = json(['agent', 'report', worker.id, '--clear']);
    assert.ok(record(clear));
    assert.equal(clear.reportsTo, undefined);
    const restored = json(['agent', 'report', worker.id, '--to', root.id]);
    assert.ok(record(restored));
    assert.equal(restored.reportsTo, root.id);
    const history = json(['agent', 'reporting-history', worker.id]);
    assert.ok(Array.isArray(history));
    assert.equal(history.length, 3);
    assert.equal(run(['agent', 'report', worker.id, '--to', root.id, '--clear']).status, 2);
  } finally {
    spawnSync(process.execPath, ['--no-env-file', cli, 'daemon', 'stop', '--socket', socket], {
      timeout: 5000,
    });
    daemon.kill('SIGTERM');
    await exited;
    rmSync(home, { recursive: true, force: true });
  }
}, 15000);
