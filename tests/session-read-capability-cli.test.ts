import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { cli } from './cli-path.js';
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
test('native Session and Room activation refuse absent or revoked read grants before Runtime across restart', async () => {
  const home = mkdtempSync('/tmp/org-read-capability-'),
    db = home + '/org.db',
    socket = home + '/org.sock',
    config = home + '/config.json',
    executable = home + '/driver.ts',
    calls = home + '/calls';
  writeFileSync(calls, '');
  writeFileSync(
    executable,
    `#!${process.execPath}\nimport{appendFileSync}from'node:fs';const input=JSON.parse(await Bun.stdin.text());appendFileSync(${JSON.stringify(calls)},'turn\\n');if(input.message==='fail')process.exit(1);console.log(JSON.stringify({type:'thread.started',thread_id:'provider'}));console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'safe'}}));console.log(JSON.stringify({type:'turn.completed'}));`,
    { mode: 0o700 },
  );
  writeFileSync(
    config,
    JSON.stringify({
      codex: { executable, cwd: home, env: [], timeoutMs: 5000, maxOutputBytes: 4096 },
    }),
  );
  const run = (args: string[]) =>
    spawnSync(process.execPath, ['--no-env-file', cli, '--db', db, ...args], {
      encoding: 'utf8',
      timeout: 10000,
    });
  const json = (args: string[]): unknown => {
    const result = run([...args, '--json']);
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  const entity = (args: string[]) => {
    const value = json(args);
    assert.ok(record(value) && typeof value.id === 'string');
    return { ...value, id: value.id };
  };
  const launch = () => {
    const child = spawn(process.execPath, [
      '--no-env-file',
      cli,
      '--db',
      db,
      'daemon',
      '--socket',
      socket,
      '--runtime-config',
      config,
    ]);
    const exited = new Promise((resolve) => child.once('exit', resolve));
    const ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('daemon not ready')), 5000);
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
    for (const [name, grants] of [
      ['legacy', []],
      ['reader', ['--capability', 'can_read']],
    ] as const)
      assert.equal(
        run([
          '--direct',
          'agent',
          'create',
          name,
          '--role',
          'worker',
          '--runtime',
          'codex',
          ...grants,
        ]).status,
        0,
      );
    const agents = json(['--direct', 'agent', 'list']);
    assert.ok(Array.isArray(agents));
    const agent = (name: string) => {
      const value: unknown = agents.find((value: unknown) => record(value) && value.name === name);
      assert.ok(record(value) && typeof value.id === 'string');
      return value.id;
    };
    const legacy = agent('legacy'),
      reader = agent('reader');
    const room = entity([
      '--direct',
      'room',
      'create',
      'read',
      '--type',
      'group',
      '--human',
      'founder',
      '--agent',
      reader,
      '--agent',
      legacy,
    ]);
    daemon = launch();
    await daemon.ready;
    const refused = (args: string[]) => {
      const result = run(['--socket', socket, ...args]);
      assert.equal(result.status, 1);
      assert.equal(result.stdout, '');
      assert.match(result.stderr, /can_read/);
    };
    refused(['session', 'start', '--agent', legacy, '--room', room.id, '--message', 'deny']);
    assert.deepEqual(json(['--socket', socket, 'session', 'list']), []);
    assert.equal(readFileSync(calls, 'utf8'), '');
    const source = entity([
      '--socket',
      socket,
      'room',
      'send',
      room.id,
      '--human',
      'founder',
      '--content',
      'deny',
      '--mention',
      legacy,
    ]);
    refused(['room', 'activate', room.id, '--message', source.id]);
    assert.equal(readFileSync(calls, 'utf8'), '');
    assert.deepEqual(json(['--socket', socket, 'room', 'messages', room.id]), [source]);
    const started = json([
      '--socket',
      socket,
      'session',
      'start',
      '--agent',
      reader,
      '--room',
      room.id,
      '--message',
      'allow',
    ]);
    assert.ok(record(started) && record(started.session) && typeof started.session.id === 'string');
    const sessionId = started.session.id;
    assert.equal(readFileSync(calls, 'utf8'), 'turn\n');
    const task = entity([
      '--socket',
      socket,
      'task',
      'create',
      'read task',
      '--kind',
      'execution_task',
      '--objective',
      'Read only with grant',
    ]);
    json(['--socket', socket, 'task', 'assign', task.id, '--owner', reader]);
    const taskRoom = entity([
      '--socket',
      socket,
      'room',
      'create',
      'task read',
      '--type',
      'task',
      '--task',
      task.id,
      '--human',
      'founder',
      '--agent',
      reader,
    ]);
    const taskStart = json([
      '--socket',
      socket,
      'session',
      'start',
      '--agent',
      reader,
      '--room',
      taskRoom.id,
      '--message',
      'ready',
    ]);
    assert.ok(
      record(taskStart) && record(taskStart.session) && typeof taskStart.session.id === 'string',
    );
    const taskInput = entity([
      '--socket',
      socket,
      'room',
      'send',
      taskRoom.id,
      '--human',
      'founder',
      '--content',
      'read task',
    ]);
    assert.equal(
      run(['--socket', socket, 'session', 'send', sessionId, '--message', 'fail']).status,
      1,
    );
    const failed = json(['--socket', socket, 'session', 'get', sessionId]);
    assert.ok(record(failed) && failed.status === 'failed' && typeof failed.version === 'number');
    const permission = json(['--socket', socket, 'agent', 'capabilities', reader]);
    assert.ok(record(permission) && typeof permission.revision === 'number');
    const approval = entity([
      '--socket',
      socket,
      'approval',
      'request',
      reader,
      '--key',
      'revoke-read',
      '--actor',
      'founder',
      '--expected-revision',
      String(permission.revision),
    ]);
    json([
      '--socket',
      socket,
      'approval',
      'decide',
      approval.id,
      '--actor',
      'founder',
      '--decision',
      'approve',
      '--reason',
      'test read revocation',
    ]);
    json(['--socket', socket, 'approval', 'apply', approval.id, '--actor', 'founder']);
    refused(['session', 'resume', sessionId, '--message', 'deny after revocation']);
    refused(['session', 'rebuild', sessionId, '--expected-version', String(failed.version)]);
    refused([
      'task',
      'run',
      task.id,
      '--session',
      taskStart.session.id,
      '--room-message',
      taskInput.id,
    ]);
    const taskResult = json(['--socket', socket, 'task', 'get', task.id]);
    assert.ok(record(taskResult) && taskResult.status === 'failed');
    assert.deepEqual(json(['--socket', socket, 'task', 'artifacts', task.id]), []);
    const denied = entity([
      '--socket',
      socket,
      'room',
      'send',
      room.id,
      '--human',
      'founder',
      '--content',
      'deny after revocation',
      '--mention',
      reader,
    ]);
    refused(['room', 'activate', room.id, '--message', denied.id]);
    assert.equal(readFileSync(calls, 'utf8'), 'turn\nturn\nturn\n');
    const sessions = json(['--socket', socket, 'session', 'list']);
    const originals = json(['--socket', socket, 'room', 'messages', room.id]);
    assert.equal(run(['--socket', socket, 'daemon', 'stop']).status, 0);
    await daemon.exited;
    daemon = undefined;
    daemon = launch();
    await daemon.ready;
    refused(['session', 'resume', sessionId, '--message', 'still denied']);
    refused(['session', 'rebuild', sessionId, '--expected-version', String(failed.version)]);
    refused(['room', 'activate', room.id, '--message', denied.id]);
    assert.equal(readFileSync(calls, 'utf8'), 'turn\nturn\nturn\n');
    assert.deepEqual(json(['--socket', socket, 'session', 'list']), sessions);
    assert.deepEqual(json(['--socket', socket, 'room', 'messages', room.id]), originals);
  } finally {
    if (daemon) {
      run(['--socket', socket, 'daemon', 'stop']);
      daemon.child.kill('SIGTERM');
      await daemon.exited;
    }
    rmSync(home, { recursive: true, force: true });
  }
}, 20000);
