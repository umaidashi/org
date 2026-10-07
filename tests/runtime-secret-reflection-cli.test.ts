import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { cli } from './cli-path.js';
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
test('native daemon rejects both provider reflections without Room reply or Memory and preserves failed Sessions across restart', async () => {
  const home = mkdtempSync('/tmp/org-reflection-cli-'),
    db = home + '/org.db',
    socket = home + '/org.sock',
    config = home + '/config.json',
    executable = home + '/driver.ts';
  const env = { ...process.env, ORG_REFLECTION_FIXTURE: 'synthetic-private-token' };
  writeFileSync(
    executable,
    `#!${process.execPath}\nconst source=await Bun.stdin.text();
    const claude=process.argv.includes('--print'); const message=claude?source:JSON.parse(source).message;
    const secret=process.env.ORG_REFLECTION_FIXTURE;
    const id=message==='identity'?secret:'safe-id'; let text=message==='text'?secret:'safe';
    if(message==='private-memory'||message==='safe-memory'){
      const context=JSON.parse(claude?JSON.parse(process.argv[process.argv.indexOf('--system-prompt')+1]).instruction:JSON.parse(source).instruction);
      const original=context.messages.find(m=>m.content===message&&m.sender.kind==='human');
      text=JSON.stringify({version:1,tool:'memory',candidates:[{type:'procedural',content:message==='private-memory'?secret:'Safe practice',confidence:1,sourceMessageIds:[original.id]}]});
    }
    if(message==='malformed'){console.log('not-json '+secret);}
    else if(message==='stderr'){console.error(secret);process.exit(1);}
    else if(claude)console.log(JSON.stringify({type:'result',subtype:'success',is_error:false,session_id:id,result:text}));
    else {console.log(JSON.stringify({type:'thread.started',thread_id:id}));console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text}}));console.log(JSON.stringify({type:'turn.completed'}));}`,
    { mode: 0o700 },
  );
  const entry = {
    executable,
    cwd: home,
    env: ['ORG_REFLECTION_FIXTURE'],
    timeoutMs: 5000,
    maxOutputBytes: 4096,
  };
  writeFileSync(config, JSON.stringify({ codex: entry, claude: entry }));
  const run = (args: string[]) =>
    spawnSync(process.execPath, ['--no-env-file', cli, '--db', db, ...args], {
      encoding: 'utf8',
      timeout: 10000,
      env,
    });
  const json = (args: string[]): unknown => {
    const result = run([...args, '--json']);
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  const rooms: string[] = [];
  const launch = () => {
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
        '--runtime-config',
        config,
        '--wake-up',
        '--poll-interval',
        '20',
        ...rooms.flatMap((room) => ['--memory-extraction-room', room]),
      ],
      { env },
    );
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
    for (const kind of ['codex', 'claude']) {
      assert.equal(
        run([
          '--direct',
          'agent',
          'create',
          kind,
          '--role',
          'worker',
          '--runtime',
          kind,
          '--capability',
          'can_read',
          '--capability',
          'can_write',
        ]).status,
        0,
      );
      const agents = json(['--direct', 'agent', 'list']);
      assert.ok(Array.isArray(agents));
      const agent: unknown = agents.find((value: unknown) => record(value) && value.name === kind);
      assert.ok(record(agent) && typeof agent.id === 'string');
      const room = json([
        '--direct',
        'room',
        'create',
        kind,
        '--type',
        'direct',
        '--human',
        'founder',
        '--agent',
        agent.id,
      ]);
      assert.ok(record(room) && typeof room.id === 'string');
      rooms.push(room.id);
    }
    daemon = launch();
    await daemon.ready;
    const agents = json(['--socket', socket, 'agent', 'list']);
    assert.ok(Array.isArray(agents));
    for (const kind of ['codex', 'claude']) {
      const agent: unknown = agents.find((value: unknown) => record(value) && value.name === kind);
      assert.ok(record(agent) && typeof agent.id === 'string');
      const room = rooms[kind === 'codex' ? 0 : 1];
      assert.ok(room);
      for (const message of ['text', 'identity', 'malformed', 'stderr']) {
        const result = run([
          '--socket',
          socket,
          'session',
          'start',
          '--agent',
          agent.id,
          '--room',
          room,
          '--message',
          message,
        ]);
        assert.equal(result.status, 1);
        assert.equal(result.stdout, '');
        assert.ok(!result.stderr.includes(env.ORG_REFLECTION_FIXTURE));
        if (message === 'stderr') assert.match(result.stderr, /process failed: exited, exit 1/);
        else assert.match(result.stderr, /Runtime output contains private environment value/);
      }
      assert.deepEqual(json(['--socket', socket, 'room', 'messages', room]), []);
    }
    const sessions = json(['--socket', socket, 'session', 'list']);
    assert.ok(Array.isArray(sessions));
    assert.equal(sessions.length, 8);
    for (const session of sessions as unknown[])
      assert.ok(
        record(session) && session.status === 'failed' && session.providerSessionId === null,
      );
    assert.deepEqual(json(['--socket', socket, 'memory', 'list']), []);
    const wait = async (read: () => boolean) => {
      const deadline = performance.now() + 10000;
      while (performance.now() < deadline) {
        if (read()) return;
        await Bun.sleep(20);
      }
      throw new Error('expected activation result');
    };
    for (const room of rooms) {
      const before = json(['--socket', socket, 'session', 'list']);
      assert.ok(Array.isArray(before));
      const original = json([
        '--socket',
        socket,
        'room',
        'send',
        room,
        '--human',
        'founder',
        '--content',
        'private-memory',
      ]);
      assert.ok(record(original));
      await wait(() => {
        const after = json(['--socket', socket, 'session', 'list']);
        return (
          Array.isArray(after) &&
          JSON.stringify(after) !== JSON.stringify(before) &&
          after.every((value: unknown) => record(value) && value.status !== 'running')
        );
      });
      assert.deepEqual(json(['--socket', socket, 'room', 'messages', room]), [original]);
      assert.deepEqual(json(['--socket', socket, 'memory', 'list', '--scope', 'room:' + room]), []);
      const safe = json([
        '--socket',
        socket,
        'room',
        'send',
        room,
        '--human',
        'founder',
        '--content',
        'safe-memory',
      ]);
      assert.ok(record(safe));
      await wait(() => {
        const values = json(['--socket', socket, 'memory', 'list', '--scope', 'room:' + room]);
        return Array.isArray(values) && values.length === 1;
      });
      const memories = json(['--socket', socket, 'memory', 'list', '--scope', 'room:' + room]);
      assert.ok(Array.isArray(memories) && record(memories[0]));
      assert.equal(memories[0].content, 'Safe practice');
      const messages = json(['--socket', socket, 'room', 'messages', room]);
      assert.ok(Array.isArray(messages));
      assert.equal(messages.length, 3);
      assert.ok(messages.some((value: unknown) => record(value) && value.replyTo === safe.id));
    }
    const originals = rooms.map((room) => json(['--socket', socket, 'room', 'messages', room]));
    const finalSessions = json(['--socket', socket, 'session', 'list']);
    const finalMemories = json(['--socket', socket, 'memory', 'list']);
    assert.equal(run(['--socket', socket, 'daemon', 'stop']).status, 0);
    await daemon.exited;
    daemon = undefined;
    daemon = launch();
    await daemon.ready;
    assert.deepEqual(json(['--socket', socket, 'session', 'list']), finalSessions);
    for (const [index, room] of rooms.entries())
      assert.deepEqual(json(['--socket', socket, 'room', 'messages', room]), originals[index]);
    assert.deepEqual(json(['--socket', socket, 'memory', 'list']), finalMemories);
  } finally {
    if (daemon) {
      run(['--socket', socket, 'daemon', 'stop']);
      daemon.child.kill('SIGTERM');
      await daemon.exited;
    }
    rmSync(home, { recursive: true, force: true });
  }
}, 20000);
