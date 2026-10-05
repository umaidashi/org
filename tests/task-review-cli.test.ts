import { cli } from './cli-path.js';
import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { SqliteTaskProvider } from '../src/tasks/sqlite.js';
import { createTask } from '../src/tasks/domain.js';
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
  const registration = spawnSync(
    process.execPath,
    [
      '--no-env-file',
      cli,
      '--direct',
      '--db',
      db,
      'agent',
      'create',
      'rememberer',
      '--role',
      'Remember reviewed facts',
      '--runtime',
      'codex',
      '--memory-policy',
      'reviewed-tasks',
    ],
    { encoding: 'utf8', timeout: 5000 },
  );
  assert.equal(registration.status, 0, registration.stderr);
  const agentRows = JSON.parse(
    spawnSync(
      process.execPath,
      ['--no-env-file', cli, '--direct', '--db', db, 'agent', 'list', '--json'],
      { encoding: 'utf8', timeout: 5000 },
    ).stdout,
  ) as { id: string; memoryPolicy: string }[];
  const rememberer = agentRows[0];
  assert.ok(rememberer);
  assert.equal(rememberer.memoryPolicy, 'reviewed-tasks');
  const ownerUpdate = new SqliteTaskProvider(db);
  ownerUpdate.update('task', { owner: rememberer.id }, 'before review');
  ownerUpdate.close();
  const config = home + '/runtime.json';
  writeFileSync(
    config,
    JSON.stringify({
      codex: {
        executable: '/usr/bin/false',
        cwd: home,
        env: [],
        timeoutMs: 1000,
        maxOutputBytes: 4096,
      },
    }),
  );
  const daemon = spawn(process.execPath, [
    '--no-env-file',
    cli,
    '--db',
    db,
    'daemon',
    '--socket',
    socket,
    '--wake-up',
    '--runtime-config',
    config,
    '--poll-interval',
    '25',
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
      '5',
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
        'id' in first &&
        typeof first.id === 'string' &&
        'reason' in first &&
        'taskVersion' in first &&
        'outputArtifacts' in first,
    );
    assert.equal(rows.length, 1);
    assert.equal(first.actor, 'founder');
    assert.equal(first.reason, 'Checked output');
    assert.equal(first.taskVersion, 5);
    assert.deepEqual(first.outputArtifacts, ['output']);
    const sourceUri = 'org://tasks/task/reviews/' + encodeURIComponent(first.id);
    const capture = spawnSync(
      process.execPath,
      [
        '--no-env-file',
        cli,
        '--db',
        db,
        '--socket',
        socket,
        'memory',
        'capture',
        '--type',
        'episodic',
        '--scope',
        'task:task',
        '--content',
        'The result was reviewed',
        '--confidence',
        '1',
        '--source-review',
        sourceUri,
        '--json',
      ],
      { encoding: 'utf8', timeout: 5000 },
    );
    assert.equal(capture.status, 0, capture.stderr);
    const memory = JSON.parse(capture.stdout) as { id: string; sourceRefs: unknown[] };
    assert.deepEqual(memory.sourceRefs, [{ uri: sourceUri }]);
    const getMemory = spawnSync(
      process.execPath,
      ['--no-env-file', cli, '--direct', '--db', db, 'memory', 'get', memory.id, '--json'],
      { encoding: 'utf8', timeout: 5000 },
    );
    assert.equal(getMemory.status, 0, getMemory.stderr);
    assert.deepEqual(JSON.parse(getMemory.stdout), memory);
    const missing = spawnSync(
      process.execPath,
      [
        '--no-env-file',
        cli,
        '--db',
        db,
        '--socket',
        socket,
        'memory',
        'capture',
        '--type',
        'episodic',
        '--scope',
        'task:task',
        '--content',
        'Invalid',
        '--confidence',
        '1',
        '--source-review',
        'org://tasks/task/reviews/absent',
      ],
      { encoding: 'utf8', timeout: 5000 },
    );
    assert.equal(missing.status, 1, missing.stderr);
    const listMemories = () => {
      const result = spawnSync(
        process.execPath,
        [
          '--no-env-file',
          cli,
          '--db',
          db,
          '--socket',
          socket,
          'memory',
          'list',
          '--scope',
          'task:task',
          '--json',
        ],
        { encoding: 'utf8', timeout: 5000 },
      );
      assert.equal(result.status, 0, result.stderr);
      return JSON.parse(result.stdout) as {
        id: string;
        status: string;
        content: string;
        sourceRefs: unknown[];
      }[];
    };
    const deadline = Date.now() + 5000;
    let projected;
    while (!(projected = listMemories().find((row) => row.id.startsWith('memory:task-review:')))) {
      if (Date.now() > deadline) throw new Error('Reviewed Memory projection not found');
      await Bun.sleep(25);
    }
    assert.deepEqual(projected.sourceRefs, [{ uri: sourceUri }]);
    const fact = JSON.parse(projected.content) as {
      title: string;
      review: { actor: string; decision: string };
    };
    assert.equal(fact.title, 'Research');
    assert.equal(fact.review.actor, 'founder');
    assert.equal(fact.review.decision, 'approve');
    assert.equal(listMemories().length, 2);
    const invalidate = spawnSync(
      process.execPath,
      [
        '--no-env-file',
        cli,
        '--db',
        db,
        '--socket',
        socket,
        'memory',
        'invalidate',
        projected.id,
        '--reason',
        'Checked no revival',
        '--json',
      ],
      { encoding: 'utf8', timeout: 5000 },
    );
    assert.equal(invalidate.status, 0, invalidate.stderr);
    await Bun.sleep(200);
    assert.equal(listMemories().find((row) => row.id === projected.id)?.status, 'invalidated');
    assert.equal(listMemories().length, 2);
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
}, 20000);
