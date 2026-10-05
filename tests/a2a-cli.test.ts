import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
test('malformed A2A payload and options fail before database creation', () => {
  const home = mkdtempSync('/tmp/org-a2a-invalid-');
  const db = home + '/absent/org.db';
  try {
    for (const grants of [['unknown'], ['can_delegate', 'can_delegate']]) {
      const result = spawnSync(
        process.execPath,
        [
          '--no-env-file',
          cli,
          '--direct',
          '--db',
          db,
          'agent',
          'create',
          'chief',
          '--role',
          'Chief',
          '--runtime',
          'codex',
          ...grants.flatMap((grant) => ['--capability', grant]),
        ],
        { encoding: 'utf8', timeout: 5000 },
      );
      assert.equal(result.status, 2, result.stderr);
      assert.equal(existsSync(home + '/absent'), false);
    }
    for (const args of [
      ['send', 'r', '--from', 'a', '--to', 'b', '--type', 'request', '--payload', '1e999'],
      ['send', 'r', '--from', 'a', '--to', 'b', '--type', 'unknown', '--payload', '{}'],
      ['send', 'r', '--from', 'a', '--to', 'b', '--type', 'request', '--payload', '{'],
      ['list', 'r', '--from', 'a'],
      ['get', 'r'],
    ]) {
      const result = spawnSync(
        process.execPath,
        ['--no-env-file', cli, '--direct', '--db', db, 'a2a', ...args],
        { encoding: 'utf8', timeout: 5000 },
      );
      assert.equal(result.status, 2, result.stderr);
      assert.equal(existsSync(home + '/absent'), false);
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
test('A2A request and result retain correlation, Task and immutable Room evidence across daemon and reopened CLI', async () => {
  const home = mkdtempSync('/tmp/org-a2a-cli-'),
    db = home + '/org.db',
    socket = home + '/org.sock';
  const run = (args: string[]) =>
    spawnSync(
      process.execPath,
      [
        '--no-env-file',
        cli,
        '--db',
        db,
        ...(args.includes('--direct') ? [] : ['--socket', socket]),
        ...args,
      ],
      {
        encoding: 'utf8',
        timeout: 5000,
      },
    );
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
  const json = (args: string[]): unknown => {
    const result = run([...args, '--json']);
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
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
    for (const name of ['chief', 'cto', 'outsider'])
      assert.equal(
        run([
          'agent',
          'create',
          name,
          '--role',
          name,
          '--runtime',
          'claude',
          ...(name === 'cto' ? ['--capability', 'can_delegate'] : []),
        ]).status,
        0,
      );
    const agents = json(['agent', 'list']);
    assert.ok(Array.isArray(agents));
    const id = (name: string) => {
      const agent: unknown = agents.find((value: unknown) => record(value) && value.name === name);
      assert.ok(record(agent) && typeof agent.id === 'string');
      return agent.id;
    };
    const chief = id('chief'),
      cto = id('cto');
    const task = json(['task', 'create', 'Research', '--objective', 'Evidence']);
    assert.ok(record(task) && typeof task.id === 'string');
    const room = json([
      'room',
      'create',
      'Agents',
      '--type',
      'agent',
      '--agent',
      chief,
      '--agent',
      cto,
    ]);
    assert.ok(record(room) && typeof room.id === 'string');
    const send = [
      'a2a',
      'send',
      room.id,
      '--from',
      chief,
      '--to',
      cto,
      '--type',
      'request',
      '--payload',
      '{"objective":"Research"}',
    ];
    const request = json([...send, '--task', task.id]);
    assert.ok(record(request) && typeof request.id === 'string');
    assert.equal(request.correlationId, request.id);
    assert.equal(request.taskId, task.id);
    const result = json([
      'a2a',
      'send',
      room.id,
      '--from',
      cto,
      '--to',
      chief,
      '--type',
      'result',
      '--payload',
      '{"evidence":["complete"]}',
      '--reply-to',
      request.id,
    ]);
    assert.ok(record(result) && typeof result.id === 'string');
    assert.equal(result.replyTo, request.id);
    assert.equal(result.correlationId, request.id);
    assert.equal(result.taskId, task.id);
    assert.deepEqual(json(['a2a', 'get', room.id, result.id]), result);
    assert.equal(run([...send, '--task', 'missing']).status, 1);
    assert.equal(
      run([
        'a2a',
        'send',
        room.id,
        '--from',
        cto,
        '--to',
        chief,
        '--type',
        'result',
        '--payload',
        '{}',
        '--reply-to',
        request.id,
        '--correlation',
        'wrong',
      ]).status,
      1,
    );
    assert.equal(
      run([
        'a2a',
        'send',
        room.id,
        '--from',
        id('outsider'),
        '--to',
        chief,
        '--type',
        'question',
        '--payload',
        '{}',
      ]).status,
      1,
    );
    assert.deepEqual(json(['a2a', 'list', room.id]), [request, result]);
    const denied = run([
      'a2a',
      'send',
      room.id,
      '--from',
      chief,
      '--to',
      cto,
      '--type',
      'delegate',
      '--payload',
      '{}',
    ]);
    assert.equal(denied.status, 1);
    assert.match(denied.stderr, /can_delegate/);
    const delegate = json([
      'a2a',
      'send',
      room.id,
      '--from',
      cto,
      '--to',
      chief,
      '--type',
      'delegate',
      '--payload',
      '{}',
    ]);
    assert.deepEqual(json(['--direct', 'agent', 'list']), agents);
    const bypass = json([
      'room',
      'send',
      room.id,
      '--agent',
      chief,
      '--content',
      'reserved delegate',
      '--metadata',
      JSON.stringify({
        a2a: {
          version: 1,
          from: chief,
          to: cto,
          type: 'delegate',
          taskId: null,
          correlationId: 'bypass',
          payload: {},
        },
      }),
    ]);
    assert.ok(record(bypass) && typeof bypass.id === 'string');
    const activation = run(['room', 'activate', room.id, '--message', bypass.id]);
    assert.equal(activation.status, 1);
    assert.match(activation.stderr, /can_delegate/);
    assert.deepEqual(json(['session', 'list']), []);
    const original = json(['room', 'messages', room.id]);
    assert.ok(Array.isArray(original));
    assert.equal(original.length, 4);
    assert.equal(run(['room', 'archive', room.id]).status, 0);
    assert.equal(run(send).status, 1);
    const reopened = json(['--direct', 'a2a', 'list', room.id]);
    assert.ok(Array.isArray(reopened));
    assert.deepEqual(reopened.slice(0, 3), [request, result, delegate]);
    assert.equal(reopened.length, 4);
    assert.deepEqual(json(['--direct', 'room', 'messages', room.id]), original);
  } finally {
    spawnSync(process.execPath, ['--no-env-file', cli, 'daemon', 'stop', '--socket', socket], {
      timeout: 5000,
    });
    daemon.kill('SIGTERM');
    await exited;
    rmSync(home, { recursive: true, force: true });
  }
});
