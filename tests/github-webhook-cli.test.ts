import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { cli } from './cli-path.js';
function record(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}
test('native signed webhook import reaches one Subscription Task and preserves originals through daemon replay and reopen', async () => {
  const home = mkdtempSync('/tmp/org-github-webhook-'),
    db = home + '/org.db',
    socket = home + '/org.sock';
  const secret = 'fixture-webhook-key-for-native-cli-long-enough';
  const body = JSON.stringify({
    action: 'edited',
    repository: { id: 42, full_name: 'fixture/repo', private: false },
    issue: {
      id: 7,
      number: 1,
      title: 'Existing issue',
      body: 'Run local checks',
      html_url: 'https://github.com/fixture/repo/issues/1',
      updated_at: '2026-10-06T00:00:00Z',
    },
  });
  const signature = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
  const delivery = '11111111-1111-4111-8111-111111111111';
  const args = [
    'event',
    'import-github-webhook',
    'fixture/repo',
    '--payload',
    body,
    '--signature',
    signature,
    '--delivery',
    delivery,
    '--json',
  ];
  const env = { ...process.env, GITHUB_WEBHOOK_SECRET: secret };
  const run = (argv: string[], remote = false, expected = 0) => {
    const p = spawnSync(
      process.execPath,
      [
        '--no-env-file',
        cli,
        '--db',
        db,
        ...(remote ? ['--socket', socket] : argv[0] === 'daemon' ? [] : ['--direct']),
        ...argv,
      ],
      { encoding: 'utf8', env, timeout: 10000 },
    );
    assert.equal(p.status, expected, p.stderr);
    assert.ok(!p.stderr.includes(secret));
    return p;
  };
  const json = (argv: string[], remote = false): unknown => JSON.parse(run(argv, remote).stdout);
  let daemon: ReturnType<typeof spawn> | undefined, exited: Promise<unknown> | undefined;
  try {
    const invalidDb = home + '/uncreated/db';
    const invalid = spawnSync(
      process.execPath,
      [
        '--no-env-file',
        cli,
        '--direct',
        '--db',
        invalidDb,
        ...args.map((x) => (x === signature ? 'sha1=bad' : x)),
      ],
      { encoding: 'utf8', env },
    );
    assert.equal(invalid.status, 2);
    assert.equal(existsSync(home + '/uncreated'), false);
    const noSecret = spawnSync(
      process.execPath,
      ['--no-env-file', cli, '--direct', '--db', db, ...args],
      { encoding: 'utf8', env: { ...env, GITHUB_WEBHOOK_SECRET: '' } },
    );
    assert.equal(noSecret.status, 1);
    assert.match(noSecret.stderr, /secret unavailable/);
    assert.deepEqual(json(['event', 'list', '--json']), []);
    run(['agent', 'create', 'reader', '--role', 'Webhook reader', '--runtime', 'codex']);
    const agents = json(['agent', 'list', '--json']);
    assert.ok(Array.isArray(agents));
    const agent: unknown = agents[0];
    assert.ok(record(agent) && typeof agent.id === 'string');
    run([
      'event',
      'subscribe',
      'github.issues.edited',
      '--subscriber-type',
      'agent',
      '--subscriber',
      agent.id,
    ]);
    const original = json(args);
    assert.ok(record(original) && typeof original.id === 'string');
    run(
      args.map((x) => (x === signature ? 'sha256=' + '0'.repeat(64) : x)),
      false,
      1,
    );
    assert.deepEqual(json(['event', 'list', '--json']), [original]);
    run(['daemon', '--once', '--json']);
    const tasks = json(['task', 'list', '--json']);
    assert.ok(Array.isArray(tasks) && tasks.length === 1);
    const task: unknown = tasks[0];
    assert.ok(record(task));
    assert.equal(task.owner, agent.id);
    assert.equal(task.status, 'assigned');
    assert.equal(task.externalRef, 'org:event:' + original.id);
    daemon = spawn(
      process.execPath,
      ['--no-env-file', cli, '--db', db, 'daemon', '--socket', socket, '--poll-interval', '20'],
      { env },
    );
    exited = new Promise((resolve) => daemon?.once('exit', resolve));
    daemon.stderr?.resume();
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('Daemon not ready')), 5000);
      daemon?.stdout?.on('data', (b: Buffer) => {
        if (b.toString().includes('"ready"')) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    assert.deepEqual(
      json(
        args.map((x) => (x === delivery ? '22222222-2222-4222-8222-222222222222' : x)),
        true,
      ),
      original,
    );
    assert.deepEqual(json(['event', 'list', '--json'], true), [original]);
    assert.deepEqual(json(['task', 'list', '--json'], true), tasks);
    run(['daemon', 'stop'], true);
    await exited;
    daemon = undefined;
    assert.deepEqual(json(args), original);
    run(['daemon', '--once', '--json']);
    assert.deepEqual(json(['task', 'list', '--json']), tasks);
  } finally {
    if (daemon) {
      daemon.kill('SIGTERM');
      await exited;
    }
    rmSync(home, { recursive: true, force: true });
  }
}, 20000);
