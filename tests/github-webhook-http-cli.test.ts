import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { createHmac } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { cli } from './cli-path.js';
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
test('native local HTTP signed webhook reaches one Task and preserves originals across replay and restart with listener cleanup', async () => {
  const home = mkdtempSync('/tmp/org-webhook-http-'),
    db = home + '/org.db',
    socket = home + '/org.sock';
  const reservation = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response() });
  const port = reservation.port;
  assert.ok(port);
  await reservation.stop(true);
  const url = `http://127.0.0.1:${port}/hooks/github`,
    secret = 'synthetic-http-webhook-secret',
    env = { ...process.env, GITHUB_WEBHOOK_SECRET: secret };
  const body = JSON.stringify({
    action: 'opened',
    repository: { id: 42, full_name: 'fixture/repo', private: false },
    issue: {
      id: 7,
      number: 1,
      title: 'Local delivery',
      body: null,
      html_url: 'https://github.com/fixture/repo/issues/1',
      updated_at: '2026-10-07T00:00:00Z',
    },
  });
  const headers = {
    'content-type': 'application/json',
    'x-github-event': 'issues',
    'x-github-delivery': '11111111-1111-4111-8111-111111111111',
    'x-hub-signature-256': 'sha256=' + createHmac('sha256', secret).update(body).digest('hex'),
  };
  const run = (args: string[]) =>
    spawnSync(process.execPath, ['--no-env-file', cli, '--db', db, ...args], {
      encoding: 'utf8',
      timeout: 10000,
      env,
    });
  const json = (args: string[]): unknown => {
    const result = run([...args, '--json']);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(!result.stderr.includes(secret));
    return JSON.parse(result.stdout);
  };
  const launch = (extra: string[] = []) => {
    const child = spawn(
      process.execPath,
      [
        '--no-env-file',
        cli,
        '--db',
        db,
        'daemon',
        '--socket',
        socket,
        '--poll-interval',
        '20',
        '--github-webhook-repo',
        'fixture/repo',
        '--github-webhook-port',
        String(port),
        ...extra,
      ],
      { env },
    );
    let error = '';
    child.stderr.on('data', (value: Buffer) => {
      error += value.toString();
    });
    const exited = new Promise((resolve) => child.once('exit', resolve));
    const ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(error || 'daemon not ready')), 5000);
      child.stdout.on('data', (value: Buffer) => {
        if (value.toString().includes('"ready"')) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    return { child, exited, ready };
  };
  let daemon: ReturnType<typeof launch> | undefined;
  try {
    assert.equal(
      run([
        '--direct',
        'agent',
        'create',
        'reader',
        '--role',
        'event',
        '--runtime',
        'codex',
        '--capability',
        'can_read',
      ]).status,
      0,
    );
    const agents = json(['--direct', 'agent', 'list']);
    assert.ok(Array.isArray(agents) && record(agents[0]) && typeof agents[0].id === 'string');
    json([
      '--direct',
      'event',
      'subscribe',
      'github.issues.opened',
      '--subscriber-type',
      'agent',
      '--subscriber',
      agents[0].id,
    ]);
    daemon = launch();
    await daemon.ready;
    const first = await fetch(url, { method: 'POST', headers, body });
    assert.equal(first.status, 202);
    const accepted: unknown = await first.json();
    assert.ok(record(accepted) && typeof accepted.id === 'string');
    const deadline = performance.now() + 5000;
    let tasks: unknown;
    do {
      tasks = json(['--socket', socket, 'task', 'list']);
      if (Array.isArray(tasks) && tasks.length === 1) break;
      await Bun.sleep(20);
    } while (performance.now() < deadline);
    assert.ok(Array.isArray(tasks) && tasks.length === 1 && record(tasks[0]));
    assert.equal(tasks[0].owner, agents[0].id);
    assert.equal(tasks[0].externalRef, 'org:event:' + accepted.id);
    const originals = json(['--socket', socket, 'event', 'list']);
    assert.ok(Array.isArray(originals) && originals.length === 1);
    for (const request of [
      {
        method: 'POST',
        headers: { ...headers, 'x-hub-signature-256': 'sha256=' + '0'.repeat(64) },
        body,
      },
      { method: 'POST', headers: { ...headers, 'x-github-event': 'push' }, body },
      { method: 'POST', headers, body: 'x'.repeat(65537) },
      { method: 'GET' },
      {
        method: 'POST',
        headers,
        body: new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(body)]),
      },
    ]) {
      const result = await fetch(url, request);
      assert.ok(result.status >= 400);
      assert.ok(!(await result.text()).includes(secret));
    }
    const wrongBody = body.replace('fixture/repo', 'other/repo');
    const wrong = await fetch(url, {
      method: 'POST',
      headers: {
        ...headers,
        'x-hub-signature-256':
          'sha256=' + createHmac('sha256', secret).update(wrongBody).digest('hex'),
      },
      body: wrongBody,
    });
    assert.equal(wrong.status, 400);
    const repeated = await fetch(url, {
      method: 'POST',
      headers: { ...headers, 'x-github-delivery': '22222222-2222-4222-8222-222222222222' },
      body,
    });
    assert.equal(repeated.status, 202);
    assert.deepEqual(await repeated.json(), accepted);
    assert.deepEqual(json(['--socket', socket, 'event', 'list']), originals);
    assert.deepEqual(json(['--socket', socket, 'task', 'list']), tasks);
    assert.equal(run(['--socket', socket, 'daemon', 'stop']).status, 0);
    await daemon.exited;
    daemon = undefined;
    await assert.rejects(fetch(url, { method: 'POST', headers, body }));
    daemon = launch();
    await daemon.ready;
    const replay = await fetch(url, { method: 'POST', headers, body });
    assert.equal(replay.status, 202);
    assert.deepEqual(await replay.json(), accepted);
    assert.deepEqual(json(['--socket', socket, 'event', 'list']), originals);
    assert.deepEqual(json(['--socket', socket, 'task', 'list']), tasks);
    assert.equal(run(['--socket', socket, 'daemon', 'stop']).status, 0);
    await daemon.exited;
    daemon = undefined;
    const occupied = Bun.serve({ hostname: '127.0.0.1', port, fetch: () => new Response() });
    try {
      const failed = run([
        'daemon',
        '--socket',
        socket,
        '--github-webhook-repo',
        'fixture/repo',
        '--github-webhook-port',
        String(port),
      ]);
      assert.equal(failed.status, 1);
      assert.ok(!failed.stderr.includes(secret));
      assert.equal(existsSync(socket), false);
      assert.equal(existsSync(socket + '.lock'), false);
    } finally {
      await occupied.stop(true);
    }
    daemon = launch();
    await daemon.ready;
    assert.deepEqual(json(['--socket', socket, 'event', 'list']), originals);
    assert.deepEqual(json(['--socket', socket, 'task', 'list']), tasks);
  } finally {
    if (daemon) {
      run(['--socket', socket, 'daemon', 'stop']);
      daemon.child.kill('SIGTERM');
      await daemon.exited;
    }
    rmSync(home, { recursive: true, force: true });
  }
}, 20000);
