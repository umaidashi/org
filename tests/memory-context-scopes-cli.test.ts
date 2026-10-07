import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { cli } from './cli-path.js';
import { SqliteMemoryProvider } from '../src/memory/sqlite.js';
import { createMemory } from '../src/memory/domain.js';

test('native Runtime selects host Room and Agent department/project scopes across restart without granting other memberships', async () => {
  const home = mkdtempSync('/tmp/org-context-scopes-'),
    db = home + '/org.db',
    socket = home + '/org.sock';
  const run = (args: string[], remote = false): unknown => {
    const raw = args[0] === 'agent' && args[1] === 'create';
    const p = spawnSync(
      process.execPath,
      [
        '--no-env-file',
        cli,
        '--db',
        db,
        ...(remote ? ['--socket', socket] : ['--direct']),
        ...args,
        ...(raw ? [] : ['--json']),
      ],
      { encoding: 'utf8', timeout: 10000 },
    );
    assert.equal(p.status, 0, p.stderr);
    return raw ? p.stdout : JSON.parse(p.stdout);
  };
  const id = (v: unknown): string => {
    assert.ok(v && typeof v === 'object' && 'id' in v && typeof v.id === 'string');
    return v.id;
  };
  let daemon: ReturnType<typeof spawn> | undefined, exited: Promise<unknown> | undefined;
  const stop = async () => {
    if (!daemon) return;
    try {
      run(['daemon', 'stop'], true);
    } catch {
      daemon.kill('SIGTERM');
    }
    await exited;
    daemon = undefined;
  };
  try {
    for (const name of ['a', 'b'])
      run(['agent', 'create', name, '--role', 'worker', '--runtime', 'codex']);
    const agents = run(['agent', 'list']);
    assert.ok(Array.isArray(agents));
    const a = id(agents[0]),
      b = id(agents[1]);
    const room = id(
      run([
        'room',
        'create',
        'work',
        '--type',
        'group',
        '--human',
        'founder',
        '--agent',
        a,
        '--agent',
        b,
      ]),
    );
    const other = id(
      run(['room', 'create', 'other', '--type', 'direct', '--human', 'founder', '--agent', a]),
    );
    const source = id(run(['room', 'send', room, '--human', 'founder', '--content', 'query']));
    const provider = new SqliteMemoryProvider(db);
    try {
      for (const [mid, scope] of [
        ['department', 'department:engineering'],
        ['project', 'project:org'],
        ['foreignDepartment', 'department:sales'],
        ['foreignProject', 'project:elsewhere'],
        ['expired', 'department:engineering'],
        ['invalid', 'project:org'],
      ]) {
        assert.ok(mid && scope);
        provider.create(
          createMemory(
            {
              type: 'semantic',
              scope,
              content: mid,
              confidence: 1,
              sourceRefs: [{ roomId: room, messageId: source }],
              ...(mid === 'expired' ? { validUntil: 1 } : {}),
            },
            { id: mid, at: '2026-10-01T00:00:00.000Z' },
          ),
        );
      }
      provider.invalidate('invalid', 'fixture', '2026-10-01T00:00:01.000Z');
    } finally {
      provider.close();
    }
    const driver = home + '/driver.ts';
    writeFileSync(
      driver,
      `#!${process.execPath}\nconst i=JSON.parse(await Bun.stdin.text());let text='INITIAL';if(i.instruction){const c=JSON.parse(i.instruction);text=JSON.stringify(c.memories.map(m=>m.id).sort());}console.log(JSON.stringify({type:'thread.started',thread_id:'scope-provider'}));console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text}}));console.log(JSON.stringify({type:'turn.completed',usage:{}}));`,
      { mode: 0o700 },
    );
    writeFileSync(
      home + '/runtime.json',
      JSON.stringify({
        codex: { executable: driver, cwd: home, env: [], timeoutMs: 5000, maxOutputBytes: 4096 },
      }),
    );
    writeFileSync(
      home + '/context.json',
      JSON.stringify([
        { roomId: room, agentId: a, scopes: ['department:engineering', 'project:org'] },
      ]),
    );
    for (const configured of [true, true, false]) {
      daemon = spawn(process.execPath, [
        '--no-env-file',
        cli,
        '--db',
        db,
        'daemon',
        '--socket',
        socket,
        '--runtime-config',
        home + '/runtime.json',
        ...(configured ? ['--memory-context-config', home + '/context.json'] : []),
      ]);
      exited = new Promise((resolve) => daemon?.once('exit', resolve));
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Daemon not ready')), 5000);
        let stderr = '';
        daemon?.stderr?.on('data', (v: Buffer) => {
          stderr += v.toString();
        });
        daemon?.stdout?.on('data', (v: Buffer) => {
          if (v.toString().includes('"ready"')) {
            clearTimeout(timer);
            resolve();
          }
        });
        daemon?.once('exit', () => {
          clearTimeout(timer);
          reject(new Error(stderr || 'Daemon exited before ready'));
        });
      });
      for (const [agent, roomId] of [
        [a, room],
        [b, room],
        [a, other],
      ]) {
        assert.ok(agent && roomId);
        const started = run(
          ['session', 'start', '--agent', agent, '--room', roomId, '--message', 'INITIAL'],
          true,
        );
        assert.ok(started && typeof started === 'object' && 'session' in started);
        const sid = id(started.session);
        const mid = id(
          run(['room', 'send', roomId, '--human', 'founder', '--content', 'query'], true),
        );
        const reply = run(['session', 'reply', sid, '--room-message', mid], true);
        assert.ok(
          reply &&
            typeof reply === 'object' &&
            'content' in reply &&
            typeof reply.content === 'string',
        );
        assert.deepEqual(
          JSON.parse(reply.content),
          configured && agent === a && roomId === room ? ['department', 'project'] : [],
        );
        run(['session', 'stop', sid], true);
      }
      await stop();
    }
  } finally {
    await stop();
    rmSync(home, { recursive: true, force: true });
  }
}, 20000);
