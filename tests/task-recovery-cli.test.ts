import { cli } from './cli-path.js';
import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { SqliteTaskProvider } from '../src/tasks/sqlite.js';
import { createTask } from '../src/tasks/domain.js';
test('daemon startup records interrupted executions without changing work items or review results', async () => {
  const home = mkdtempSync('/tmp/org-task-recovery-');
  const db = home + '/org.db';
  const socket = home + '/org.sock';
  const tasks = new SqliteTaskProvider(db);
  for (const [id, kind] of [
    ['execution', 'execution_task'],
    ['work', 'work_item'],
    ['review', 'execution_task'],
  ] as const) {
    tasks.create(
      createTask({ title: id, objective: 'Research', kind }, { id, createdAt: 'before' }),
    );
    tasks.update(id, { owner: 'agent' }, 'assigned');
    tasks.update(id, { status: 'running' }, 'started');
    if (id === 'review') tasks.update(id, { status: 'waiting_approval' }, 'reviewed');
  }
  const work = tasks.history('work');
  const review = tasks.history('review');
  const history = tasks.history('execution');
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
  daemon.stderr.on('data', (value: Buffer) => {
    stderr += value.toString();
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Not ready: ' + stderr)), 5000);
      daemon.stdout.on('data', (value: Buffer) => {
        if (value.toString().includes('"ready"')) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    assert.equal(tasks.get('execution').status, 'failed');
    assert.equal(tasks.get('execution').version, 3);
    assert.deepEqual(tasks.history('execution').slice(0, -1), history);
    assert.equal(tasks.history('execution').at(-1)?.status, 'failed');
    assert.deepEqual(tasks.history('work'), work);
    assert.deepEqual(tasks.history('review'), review);
    const response = spawnSync(
      process.execPath,
      ['--no-env-file', cli, '--db', db, '--socket', socket, 'task', 'get', 'execution', '--json'],
      { encoding: 'utf8', timeout: 5000 },
    );
    assert.equal(response.status, 0, response.stderr);
    assert.equal(JSON.parse(response.stdout).status, 'failed');
  } finally {
    spawnSync(process.execPath, ['--no-env-file', cli, 'daemon', 'stop', '--socket', socket], {
      timeout: 5000,
    });
    daemon.kill('SIGTERM');
    await exited;
    tasks.close();
    rmSync(home, { recursive: true, force: true });
  }
});
