import { cli } from './cli-path.js';
import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { SqliteRoomRepository } from '../src/rooms/sqlite.js';
import { createRoom } from '../src/rooms/domain.js';

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
test('native Room permissions persist and human Approval blocks Context before Runtime and after an active turn', async () => {
  const home = mkdtempSync('/tmp/org-room-permission-cli-'),
    db = home + '/org.db',
    socket = home + '/org.sock',
    counter = home + '/counter';
  try {
    const invoke = (args: string[], direct = false) =>
      spawnSync(
        process.execPath,
        [
          '--no-env-file',
          cli,
          '--db',
          db,
          ...(direct ? ['--direct'] : ['--socket', socket]),
          ...args,
        ],
        { encoding: 'utf8', timeout: 5000 },
      );
    const json = (args: string[], direct = false): unknown => {
      const result = invoke([...args, '--json'], direct);
      assert.equal(result.status, 0, result.stderr);
      return JSON.parse(result.stdout);
    };
    const invalid = spawnSync(
      process.execPath,
      [
        '--no-env-file',
        cli,
        '--direct',
        '--db',
        home + '/invalid.db',
        'agent',
        'create',
        'bad',
        '--role',
        'Code',
        '--runtime',
        'codex',
        '--permissions',
        '{"rooms":[],"wildcard":true}',
      ],
      { encoding: 'utf8', timeout: 5000 },
    );
    assert.notEqual(invalid.status, 0);
    assert.ok(!existsSync(home + '/invalid.db'));
    const created = invoke(
      [
        'agent',
        'create',
        'worker',
        '--role',
        'Code',
        '--runtime',
        'codex',
        '--capability',
        'can_read',
        '--permissions',
        '{"rooms":["allowed"]}',
      ],
      true,
    );
    assert.equal(created.status, 0, created.stderr);
    const agents = json(['agent', 'list'], true);
    assert.ok(Array.isArray(agents));
    const agent: unknown = agents[0];
    assert.ok(record(agent) && typeof agent.id === 'string');
    const agentId = agent.id;
    const rooms = new SqliteRoomRepository(db);
    for (const id of ['allowed', 'denied'])
      rooms.create(
        createRoom(
          {
            title: id,
            type: 'direct',
            participants: [
              { kind: 'agent', id: agentId },
              { kind: 'human', id: 'founder' },
            ],
          },
          { id, createdAt: 'before' },
        ),
      );
    rooms.close();
    const driver = home + '/driver.ts',
      config = home + '/runtime.json';
    writeFileSync(
      driver,
      `#!${process.execPath}\nimport {appendFileSync,existsSync} from 'node:fs';const input=JSON.parse(await Bun.stdin.text());appendFileSync(${JSON.stringify(counter)},'x');if(input.message==='late')while(!existsSync(${JSON.stringify(home + '/release')}))await Bun.sleep(10);console.log(JSON.stringify({type:'thread.started',thread_id:'provider'}));console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'safe'}}));console.log(JSON.stringify({type:'turn.completed'}));`,
      { mode: 0o700 },
    );
    writeFileSync(
      config,
      JSON.stringify({
        codex: { executable: driver, cwd: home, env: [], timeoutMs: 5000, maxOutputBytes: 4096 },
      }),
    );
    const daemon = spawn(
      process.execPath,
      ['--no-env-file', cli, '--db', db, 'daemon', '--socket', socket, '--runtime-config', config],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
    const exited = new Promise((resolve) => daemon.once('exit', resolve));
    let active: ReturnType<typeof spawn> | undefined,
      activeExited: Promise<number | null> | undefined;
    const count = () => (existsSync(counter) ? readFileSync(counter, 'utf8').length : 0);
    const change = (allow: string[], revision: number, key: string) => {
      const request = json([
        'approval',
        'request',
        agentId,
        '--key',
        key,
        '--actor',
        'founder',
        '--expected-revision',
        String(revision),
        '--capability',
        'can_read',
        '--permissions',
        JSON.stringify({ rooms: allow }),
      ]);
      assert.ok(record(request) && typeof request.id === 'string');
      assert.notEqual(invoke(['approval', 'apply', request.id, '--actor', 'founder']).status, 0);
      json([
        'approval',
        'decide',
        request.id,
        '--actor',
        'founder',
        '--decision',
        'approve',
        '--reason',
        'Bounded Room access',
      ]);
      return json(['approval', 'apply', request.id, '--actor', 'founder']);
    };
    try {
      for (let i = 0; i < 100 && !existsSync(socket); i++) await Bun.sleep(20);
      assert.ok(existsSync(socket));
      const denied = invoke([
        'session',
        'start',
        '--agent',
        agentId,
        '--room',
        'denied',
        '--message',
        'read',
        '--instruction',
        'test',
      ]);
      assert.notEqual(denied.status, 0);
      assert.match(denied.stderr, /Room permission/);
      assert.equal(count(), 0);
      const started = json([
        'session',
        'start',
        '--agent',
        agentId,
        '--room',
        'allowed',
        '--message',
        'read',
        '--instruction',
        'test',
      ]);
      assert.ok(
        record(started) && record(started.session) && typeof started.session.id === 'string',
      );
      const sessionId = started.session.id;
      assert.equal(count(), 1);
      change([], 0, 'deny');
      const permission = json(['agent', 'capabilities', agent.id]);
      assert.ok(record(permission));
      assert.deepEqual(permission.permissions, { rooms: [] });
      assert.deepEqual(permission.capabilities, ['can_read']);
      const refused = invoke(['session', 'resume', sessionId, '--message', 'read']);
      assert.notEqual(refused.status, 0);
      assert.match(refused.stderr, /Room permission/);
      assert.equal(count(), 1);
      change(['allowed'], 1, 'restore');
      assert.equal(invoke(['session', 'resume', sessionId, '--message', 'read']).status, 0);
      assert.equal(count(), 2);
      active = spawn(
        process.execPath,
        [
          '--no-env-file',
          cli,
          '--db',
          db,
          '--socket',
          socket,
          'session',
          'resume',
          sessionId,
          '--message',
          'late',
        ],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      );
      let error = '';
      active.stderr?.on('data', (chunk) => {
        error += String(chunk);
      });
      active.stdout?.resume();
      activeExited = new Promise((resolve) => active?.once('exit', resolve));
      for (let i = 0; i < 100 && count() < 3; i++) await Bun.sleep(10);
      assert.equal(count(), 3);
      change([], 2, 'late-deny');
      writeFileSync(home + '/release', 'ready');
      assert.notEqual(await activeExited, 0);
      assert.match(error, /Room permission/);
      const failed = json(['session', 'get', sessionId]);
      assert.ok(record(failed));
      assert.equal(failed.status, 'failed');
      assert.equal(failed.providerSessionId, 'provider');
      const history = json(['agent', 'capability-history', agent.id]);
      assert.ok(Array.isArray(history));
      assert.equal(history.length, 3);
      assert.deepEqual(history[2].permissions, { rooms: [] });
      const audit = json(['audit', 'list']);
      assert.ok(Array.isArray(audit));
      assert.equal(audit.filter((entry) => entry.tool === 'agent.capabilities.change').length, 3);
      const reopened = json(['agent', 'list'], true);
      assert.ok(Array.isArray(reopened));
      assert.deepEqual(reopened[0].permissions, { rooms: [] });
      const rebuild = invoke([
        'session',
        'rebuild',
        sessionId,
        '--expected-version',
        String(failed.version),
      ]);
      assert.notEqual(rebuild.status, 0);
      assert.match(rebuild.stderr, /Room permission/);
      assert.equal(count(), 3);
    } finally {
      if (active && active.exitCode === null) active.kill('SIGTERM');
      if (activeExited) await activeExited;
      daemon.kill('SIGTERM');
      await exited;
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}, 15000);
