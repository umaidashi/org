import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SqliteTaskProvider } from '../src/tasks/sqlite.js';
import { createTask } from '../src/tasks/domain.js';
const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
test('daemon CLI reviews the observed result once and preserves the decision across reopen', async () => {
  const home = mkdtempSync('/tmp/org-review-cli-');
  const db = home + '/org.db',
    socket = home + '/org.sock';
  const provider = new SqliteTaskProvider(db);
  provider.create(
    createTask(
      { kind: 'execution_task', title: 'Research', objective: 'Compare' },
      { id: 'task', createdAt: 'before' },
    ),
  );
  provider.update('task', { owner: 'agent' }, 'assigned');
  provider.update('task', { status: 'running' }, 'started');
  provider.stageExecutionResult(
    'task',
    { id: 'output', uri: 'org://result', createdAt: 'produced' },
    2,
  );
  provider.close();
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
  let stderr = '';
  daemon.stderr.on('data', (data: Buffer) => {
    stderr += data.toString();
  });
  const run = (args: string[]) =>
    spawnSync(
      process.execPath,
      ['--no-env-file', cli, '--db', db, '--socket', socket, 'task', ...args, '--json'],
      { encoding: 'utf8', timeout: 5000 },
    );
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Not ready: ' + stderr)), 5000);
      daemon.stdout.on('data', (data: Buffer) => {
        if (data.toString().includes('"ready"')) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    const reviewArgs = [
      'review',
      'task',
      '--decision',
      'approve',
      '--actor',
      'founder',
      '--reason',
      'Checked output',
      '--expected-version',
      '4',
    ];
    const reviewed = run(reviewArgs);
    assert.equal(reviewed.status, 0, reviewed.stderr);
    assert.equal(JSON.parse(reviewed.stdout).status, 'completed');
    assert.equal(run(reviewArgs).status, 1);
    const decisions = run(['reviews', 'task']);
    assert.equal(decisions.status, 0, decisions.stderr);
    const rows: unknown = JSON.parse(decisions.stdout);
    assert.ok(Array.isArray(rows));
    const first: unknown = rows[0];
    assert.ok(
      first !== null &&
        typeof first === 'object' &&
        'actor' in first &&
        'reason' in first &&
        'taskVersion' in first &&
        'outputArtifacts' in first,
    );
    assert.equal(rows.length, 1);
    assert.equal(first.actor, 'founder');
    assert.equal(first.reason, 'Checked output');
    assert.equal(first.taskVersion, 4);
    assert.deepEqual(first.outputArtifacts, ['output']);
    const reopened = new SqliteTaskProvider(db);
    try {
      assert.deepEqual(reopened.reviews('task'), rows);
    } finally {
      reopened.close();
    }
  } finally {
    spawnSync(process.execPath, ['--no-env-file', cli, 'daemon', 'stop', '--socket', socket], {
      timeout: 5000,
    });
    daemon.kill('SIGTERM');
    await exited;
    rmSync(home, { recursive: true, force: true });
  }
});
