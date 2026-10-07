import { SqliteTaskProvider } from '../src/tasks/sqlite.js';
import { SqliteAgentRepository } from '../src/agents/sqlite.js';
import { createTask } from '../src/tasks/domain.js';
import { createAgent } from '../src/agents/domain.js';
import { cli } from './cli-path.js';
import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';

test('real CLI logs reads immutable approval Audit and rejects invalid filters before creating a database', async () => {
  const home = mkdtempSync('/tmp/org-logs-');
  let daemon: ReturnType<typeof spawn> | undefined, daemonExit: Promise<number | null> | undefined;
  const run = (args: string[], db = home + '/org.db') =>
    spawnSync(process.execPath, ['--no-env-file', cli, '--direct', '--db', db, ...args], {
      encoding: 'utf8',
      timeout: 5000,
    });
  try {
    const initial = run(['logs', '--json']);
    assert.equal(initial.status, 0, initial.stderr);
    assert.deepEqual(JSON.parse(initial.stdout), []);
    const request = run([
      'approval',
      'request-workflow',
      'workflow',
      '--key',
      'request',
      '--actor',
      'founder',
      '--host',
      'http://localhost:5678',
      '--input-digest',
      'a'.repeat(64),
      '--request-id',
      'invoke',
      '--effect',
      'write',
      '--json',
    ]);
    assert.equal(request.status, 0, request.stderr);
    const full = run(['audit', 'list', '--json']);
    const logs = run(['logs', '--limit', '1', '--json']);
    assert.equal(logs.status, 0, logs.stderr);
    assert.deepEqual(JSON.parse(logs.stdout), JSON.parse(full.stdout));
    const filtered = run(['logs', '--task', 'missing', '--json']);
    assert.equal(filtered.status, 0, filtered.stderr);
    assert.deepEqual(JSON.parse(filtered.stdout), []);
    const agents = new SqliteAgentRepository(home + '/org.db'),
      tasks = new SqliteTaskProvider(home + '/org.db');
    try {
      for (const id of ['cto', 'researcher'])
        agents.insert(
          createAgent({ name: id, role: 'worker', runtime: 'claude' }, { id, createdAt: 'before' }),
        );
      tasks.create(
        createTask(
          { title: 'Historical', objective: 'Historical', kind: 'execution_task' },
          { id: 'historical', createdAt: '2026-10-01T00:00:00Z' },
        ),
      );
      tasks.update('historical', { owner: 'cto' }, '2026-10-01T00:00:01Z');
      tasks.update('historical', { status: 'running' }, '2026-10-01T00:00:02Z');
      tasks.update('historical', { status: 'blocked' }, '2026-10-01T00:00:03Z');
      tasks.update('historical', { owner: 'researcher' }, '2026-10-01T00:00:04Z');
      tasks.update('historical', { status: 'running' }, '2026-10-01T00:00:05Z');
      tasks.update('historical', { status: 'failed' }, '2026-10-01T00:00:06Z');
    } finally {
      tasks.close();
      agents.close();
    }
    const tail = run(['logs', 'tail', 'cto', '--limit', '1', '--json']);
    assert.equal(tail.status, 0, tail.stderr);
    const selected: unknown = JSON.parse(tail.stdout);
    assert.ok(Array.isArray(selected));
    assert.equal(selected.length, 1);
    const entry: unknown = selected[0];
    assert.ok(
      entry &&
        typeof entry === 'object' &&
        'actor' in entry &&
        'result' in entry &&
        'inputRef' in entry,
    );
    assert.deepEqual(entry.actor, { kind: 'agent', id: 'cto' });
    assert.equal(entry.result, 'started');
    assert.ok(typeof entry.inputRef === 'string');
    assert.equal(run(['logs', 'tail', 'missing', '--json']).status, 1);
    const socket = home + '/org.sock';
    daemon = spawn(process.execPath, [
      '--no-env-file',
      cli,
      '--db',
      home + '/org.db',
      'daemon',
      '--socket',
      socket,
    ]);
    daemonExit = new Promise((resolve) => daemon?.once('exit', resolve));
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('daemon not ready')), 5000);
      daemon?.stdout?.on('data', (data: Buffer) => {
        if (data.toString().includes('"ready"')) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    const remote = spawnSync(
      process.execPath,
      [
        '--no-env-file',
        cli,
        '--db',
        home + '/org.db',
        '--socket',
        socket,
        'logs',
        'tail',
        'cto',
        '--limit',
        '1',
        '--json',
      ],
      { encoding: 'utf8', timeout: 5000 },
    );
    assert.equal(remote.status, 0, remote.stderr);
    assert.deepEqual(JSON.parse(remote.stdout), selected);
    const stop = spawnSync(
      process.execPath,
      ['--no-env-file', cli, '--db', home + '/org.db', '--socket', socket, 'daemon', 'stop'],
      { encoding: 'utf8', timeout: 5000 },
    );
    assert.equal(stop.status, 0, stop.stderr);
    assert.equal(await daemonExit, 0);
    daemon = undefined;
    assert.deepEqual(
      JSON.parse(run(['logs', 'tail', 'cto', '--limit', '1', '--json']).stdout),
      selected,
    );

    for (const args of [
      ['--limit', '0'],
      ['--limit', '1.5'],
      ['--limit', '1001'],
      ['--task', ''],
      ['extra'],
      ['tail'],
      ['tail', ''],
      ['tail', 'cto', 'extra'],
      ['--reason', 'body'],
    ]) {
      assert.equal(run(['logs', ...args], home + '/absent/db').status, 2);
      assert.equal(existsSync(home + '/absent'), false);
    }
  } finally {
    if (daemon) {
      daemon.kill('SIGTERM');
      await daemonExit;
    }
    rmSync(home, { recursive: true, force: true });
  }
});
