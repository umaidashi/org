import { cli } from './cli-path.js';
import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { SqliteAgentRepository } from '../src/agents/sqlite.js';
import { SqliteTaskProvider } from '../src/tasks/sqlite.js';
import { createAgent } from '../src/agents/domain.js';
import { createTask } from '../src/tasks/domain.js';
test.skipIf(process.env.ORG_DOCKER_TEST !== '1')(
  'daemon Sandbox waits beyond five seconds, cancels and drains before DB close',
  async () => {
    const dockerIds = () => {
      const r = spawnSync('docker', ['ps', '-aq', '--filter', 'name=org-sandbox-'], {
        encoding: 'utf8',
        timeout: 5000,
      });
      assert.equal(r.status, 0, r.stderr);
      return r.stdout.trim().split('\n').filter(Boolean).sort();
    };
    const containersBefore = dockerIds();
    const home = mkdtempSync('/tmp/org-daemon-sandbox-'),
      db = home + '/org.db',
      socket = home + '/org.sock';
    const tasks = new SqliteTaskProvider(db),
      agents = new SqliteAgentRepository(db);
    agents.insert(
      createAgent(
        { name: 'worker', role: 'Code', runtime: 'codex', capabilities: ['can_run_shell'] },
        { id: 'worker', createdAt: 'before' },
      ),
    );
    for (const id of ['long', 'cancel', 'busy', 'stop']) {
      tasks.create(
        createTask(
          { title: id, objective: 'Marker', kind: 'execution_task' },
          { id, createdAt: 'before' },
        ),
      );
      tasks.update(id, { owner: 'worker' }, 'assigned');
    }
    agents.close();
    const daemon = spawn(process.execPath, [
      '--no-env-file',
      cli,
      '--db',
      db,
      'daemon',
      '--socket',
      socket,
    ]);
    let stderr = '';
    daemon.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });
    const exited = new Promise<number | null>((resolve) => daemon.once('exit', resolve));
    const run = (args: string[]) =>
      spawnSync(process.execPath, ['--no-env-file', cli, '--db', db, '--socket', socket, ...args], {
        encoding: 'utf8',
        timeout: 10000,
      });
    const launch = (id: string, code: string) => {
      const child = spawn(process.execPath, [
        '--no-env-file',
        cli,
        '--db',
        db,
        '--socket',
        socket,
        'sandbox',
        'run',
        id,
        '--code',
        code,
        '--timeout-ms',
        '20000',
        '--json',
      ]);
      let output = '',
        error = '';
      child.stdout.on('data', (data: Buffer) => {
        output += data.toString();
      });
      child.stderr.on('data', (data: Buffer) => {
        error += data.toString();
      });
      return {
        child,
        done: new Promise<{ code: number | null; output: string; error: string }>((resolve) =>
          child.once('exit', (code) => resolve({ code, output, error })),
        ),
      };
    };
    const clients: ReturnType<typeof launch>[] = [];
    const waitRunning = async (id: string) => {
      const deadline = Date.now() + 5000;
      while (tasks.get(id).status !== 'running') {
        if (Date.now() > deadline) throw new Error('Task not running: ' + id);
        await Bun.sleep(20);
      }
    };
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Daemon not ready: ' + stderr)), 5000);
        daemon.stdout.on('data', (data: Buffer) => {
          if (data.toString().includes('"ready"')) {
            clearTimeout(timer);
            resolve();
          }
        });
      });
      const long = launch('long', "await new Promise(r=>setTimeout(r,6000));console.log('done');");
      clients.push(long);
      const result = await long.done;
      assert.equal(result.code, 0, result.error);
      assert.equal(tasks.get('long').status, 'waiting_approval');
      const cancel = launch('cancel', 'await new Promise(()=>{});');
      clients.push(cancel);
      await waitRunning('cancel');
      await Bun.sleep(300);
      const busy = run(['sandbox', 'run', 'busy', '--code', 'console.log(7)']);
      assert.equal(busy.status, 1);
      assert.match(busy.stderr, /busy/);
      assert.equal(tasks.get('busy').status, 'assigned');
      assert.equal(run(['sandbox', 'cancel', 'other']).status, 1);
      assert.equal(run(['sandbox', 'cancel', 'cancel']).status, 0);
      const cancelled = await cancel.done;
      assert.equal(cancelled.code, 1);
      assert.equal(tasks.get('cancel').status, 'failed');
      const stop = launch('stop', 'await new Promise(()=>{});');
      clients.push(stop);
      await waitRunning('stop');
      await Bun.sleep(300);
      const stopped = run(['daemon', 'stop']);
      assert.equal(stopped.status, 0, stopped.stderr);
      assert.equal(await exited, 0, stderr);
      assert.equal((await stop.done).code, 1);
      assert.equal(tasks.get('stop').status, 'failed');
      assert.equal(tasks.get('busy').status, 'assigned');
      assert.deepEqual(dockerIds(), containersBefore);
    } finally {
      daemon.kill('SIGTERM');
      await exited;
      for (const client of clients) {
        client.child.kill('SIGKILL');
        await client.done;
      }
      tasks.close();
      rmSync(home, { recursive: true, force: true });
    }
  },
  25000,
);

test.skipIf(process.env.ORG_DOCKER_TEST !== '1')(
  'direct Sandbox SIGINT records failed and waits for cleanup',
  async () => {
    const home = mkdtempSync('/tmp/org-direct-sandbox-stop-'),
      db = home + '/org.db';
    const tasks = new SqliteTaskProvider(db),
      agents = new SqliteAgentRepository(db);
    agents.insert(
      createAgent(
        { name: 'worker', role: 'Code', runtime: 'codex', capabilities: ['can_run_shell'] },
        { id: 'worker', createdAt: 'before' },
      ),
    );
    tasks.create(
      createTask(
        { title: 'Code', objective: 'Marker', kind: 'execution_task' },
        { id: 'task', createdAt: 'before' },
      ),
    );
    tasks.update('task', { owner: 'worker' }, 'assigned');
    agents.close();
    const child = spawn(process.execPath, [
      '--no-env-file',
      cli,
      '--direct',
      '--db',
      db,
      'sandbox',
      'run',
      'task',
      '--code',
      'await new Promise(()=>{});',
    ]);
    let stderr = '';
    child.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });
    const exited = new Promise<number | null>((resolve) => child.once('exit', resolve));
    try {
      const deadline = Date.now() + 5000;
      while (tasks.get('task').status !== 'running') {
        if (Date.now() > deadline) throw new Error('Task not running');
        await Bun.sleep(20);
      }
      await Bun.sleep(300);
      child.kill('SIGINT');
      assert.equal(await exited, 1, stderr);
      assert.equal(tasks.get('task').status, 'failed');
      assert.match(stderr, /cancelled/);
    } finally {
      child.kill('SIGKILL');
      await exited;
      tasks.close();
      rmSync(home, { recursive: true, force: true });
    }
  },
  10000,
);
