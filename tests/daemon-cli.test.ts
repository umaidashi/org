import { cli } from './cli-path.js';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'bun:test';
test('daemon once creates assigned ExecutionTask and restart does not duplicate or reassign it', () => {
  const home = mkdtempSync(join(tmpdir(), 'org-daemon-e2e-'));
  const run = (args: string[]) =>
    spawnSync(
      process.execPath,
      [
        '--no-env-file',
        cli,
        '--db',
        join(home, 'org.db'),
        ...(args[0] === 'daemon' ? args : ['--direct', ...args]),
      ],
      {
        encoding: 'utf8',
        timeout: 10_000,
      },
    );
  try {
    assert.equal(
      run(['agent', 'create', 'dev', '--role', 'Developer', '--runtime', 'codex']).status,
      0,
    );
    const agents = JSON.parse(run(['agent', 'list', '--json']).stdout) as { id: string }[];
    const agent = agents[0]?.id;
    assert.ok(agent);
    assert.equal(
      run([
        'event',
        'publish',
        'manual.requested',
        '--source',
        'manual',
        '--payload',
        '{"objective":"investigate"}',
      ]).status,
      0,
    );
    assert.equal(
      run(['event', 'subscribe', 'manual.*', '--subscriber-type', 'agent', '--subscriber', agent])
        .status,
      0,
    );
    let result = run(['daemon', '--once', '--json']);
    assert.equal(result.status, 0, result.stderr);
    const receipts = JSON.parse(result.stdout) as { status: string; taskId: string }[];
    assert.equal(receipts.length, 1);
    assert.equal(receipts[0]?.status, 'delivered');
    const tasks = JSON.parse(run(['task', 'list', '--json']).stdout) as {
      id: string;
      kind: string;
      owner: string;
      status: string;
    }[];
    assert.equal(tasks.length, 1);
    const task = tasks[0];
    assert.ok(task);
    assert.equal(task.kind, 'execution_task');
    assert.equal(task.status, 'assigned');
    assert.equal(task.owner, agent);
    assert.equal(receipts[0]?.taskId, task.id);
    const audit = run(['logs', '--task', task.id, '--json']);
    assert.equal(audit.status, 0, audit.stderr);
    const operations = JSON.parse(audit.stdout) as {
      tool: string;
      actor: unknown;
      eventId: string | null;
    }[];
    const adoption = operations.filter((entry) => entry.tool === 'task.adopt');
    assert.equal(adoption.length, 1);
    assert.deepEqual(adoption[0]?.actor, { kind: 'system', id: 'core' });
    assert.ok(adoption[0]?.eventId);
    assert.equal(run(['daemon', '--once', '--json']).status, 0);
    assert.equal(run(['logs', '--task', task.id, '--json']).stdout, audit.stdout);
    assert.equal(run(['task', 'update', task.id, '--status', 'running']).status, 0);
    const history = run(['task', 'history', task.id, '--json']).stdout;
    result = run(['daemon', '--once', '--json']);
    assert.equal(result.status, 0, result.stderr);
    assert.equal((JSON.parse(run(['task', 'list', '--json']).stdout) as unknown[]).length, 1);
    assert.equal(run(['task', 'history', task.id, '--json']).stdout, history);
    assert.deepEqual(JSON.parse(run(['daemon', 'deliveries', '--json']).stdout), receipts);
    assert.equal(
      run([
        'event',
        'subscribe',
        'manual.*',
        '--subscriber-type',
        'workflow',
        '--subscriber',
        'external',
      ]).status,
      0,
    );
    const deferredResult = run(['daemon', '--once', '--json']);
    assert.equal(deferredResult.status, 0, deferredResult.stderr);
    const withWorkflow = JSON.parse(deferredResult.stdout) as {
      status: string;
      taskId: string | null;
      reason: string | null;
    }[];
    const deferred = withWorkflow.find((entry) => entry.status === 'deferred');
    assert.ok(deferred);
    assert.equal(deferred.taskId, null);
    assert.match(deferred.reason ?? '', /not implemented/);
    assert.equal((JSON.parse(run(['task', 'list', '--json']).stdout) as unknown[]).length, 1);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}, 15000);
test('two concurrent CLI workers create only one Task and two original history snapshots', async () => {
  const home = mkdtempSync(join(tmpdir(), 'org-daemon-concurrent-'));
  const prefix = ['--no-env-file', cli, '--db', join(home, 'org.db')];
  const run = (args: string[]) =>
    spawnSync(
      process.execPath,
      [...prefix, ...(args[0] === 'daemon' ? args : ['--direct', ...args])],
      { encoding: 'utf8', timeout: 10_000 },
    );
  const worker = () =>
    new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, [...prefix, 'daemon', '--once', '--json'], {
        timeout: 10_000,
      });
      let stderr = '';
      child.stdout.resume();
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      child.on('error', reject);
      child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(stderr))));
    });
  try {
    assert.equal(
      run(['agent', 'create', 'dev', '--role', 'Developer', '--runtime', 'codex']).status,
      0,
    );
    const agents = JSON.parse(run(['agent', 'list', '--json']).stdout) as { id: string }[];
    const agent = agents[0]?.id;
    assert.ok(agent);
    assert.equal(run(['event', 'publish', 'manual.requested', '--source', 'manual']).status, 0);
    assert.equal(
      run(['event', 'subscribe', '**', '--subscriber-type', 'agent', '--subscriber', agent]).status,
      0,
    );
    await Promise.all([worker(), worker()]);
    const tasks = JSON.parse(run(['task', 'list', '--json']).stdout) as { id: string }[];
    assert.equal(tasks.length, 1);
    const task = tasks[0];
    assert.ok(task);
    const history = JSON.parse(run(['task', 'history', task.id, '--json']).stdout) as {
      status: string;
    }[];
    assert.deepEqual(
      history.map((entry) => entry.status),
      ['pending', 'assigned'],
    );
    const receipts = JSON.parse(run(['daemon', 'deliveries', '--json']).stdout) as {
      status: string;
    }[];
    assert.equal(receipts.length, 1);
    assert.equal(receipts[0]?.status, 'delivered');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}, 20_000);
