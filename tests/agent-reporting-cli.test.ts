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
    const audit = json(['audit', 'list']);
    assert.ok(Array.isArray(audit));
    const configuration = audit.filter(
      (entry) => entry.tool === 'agent.register' || entry.tool === 'agent.reporting.change',
    );
    assert.equal(configuration.length, 4);
    for (const entry of configuration) {
      assert.deepEqual(entry.actor, { kind: 'system', id: 'local-host' });
      assert.equal(entry.taskId, null);
      assert.equal(entry.eventId, null);
      assert.equal(entry.approvalId, null);
      assert.equal(entry.result, 'succeeded');
      assert.ok(entry.inputRef.startsWith('org://agents/'));
      assert.ok(entry.outputRef.startsWith('org://agents/'));
      assert.ok(entry.at);
      assert.ok(entry.id);
    }
    spawnSync(process.execPath, ['--no-env-file', cli, 'daemon', 'stop', '--socket', socket], {
      timeout: 5000,
    });
    await exited;
    const reopened = spawnSync(
      process.execPath,
      ['--no-env-file', cli, '--direct', '--db', db, 'audit', 'list', '--json'],
      { encoding: 'utf8', timeout: 5000 },
    );
    assert.equal(reopened.status, 0, reopened.stderr);
    assert.deepEqual(JSON.parse(reopened.stdout), audit);
    const direct = spawnSync(
      process.execPath,
      [
        '--no-env-file',
        cli,
        '--direct',
        '--db',
        db,
        'agent',
        'report',
        worker.id,
        '--clear',
        '--json',
      ],
      { encoding: 'utf8', timeout: 5000 },
    );
    assert.equal(direct.status, 0, direct.stderr);
    const updated = spawnSync(
      process.execPath,
      ['--no-env-file', cli, '--direct', '--db', db, 'audit', 'list', '--json'],
      { encoding: 'utf8', timeout: 5000 },
    );
    assert.equal(updated.status, 0, updated.stderr);
    const updatedAudit: unknown = JSON.parse(updated.stdout);
    assert.ok(Array.isArray(updatedAudit));
    assert.equal(updatedAudit.length, audit.length + 1);
  } finally {
    spawnSync(process.execPath, ['--no-env-file', cli, 'daemon', 'stop', '--socket', socket], {
      timeout: 5000,
    });
    daemon.kill('SIGTERM');
    await exited;
    rmSync(home, { recursive: true, force: true });
  }
}, 15000);
