import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { cli } from './cli-path.js';
import { SqliteMemoryProvider } from '../src/memory/sqlite.js';
import { createMemory } from '../src/memory/domain.js';

test('native Runtime selects host Room and Agent department/project scopes through restart rebuild Task and automatic wake-up without granting other memberships', async () => {
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
      run([
        'agent',
        'create',
        name,
        '--role',
        'worker',
        '--runtime',
        'codex',
        '--capability',
        'can_read',
      ]);
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
        '--coordinator',
        a,
      ]),
    );
    const other = id(
      run(['room', 'create', 'other', '--type', 'direct', '--human', 'founder', '--agent', a]),
    );
    const task = id(
      run([
        'task',
        'create',
        'scope work',
        '--kind',
        'execution_task',
        '--objective',
        'Verify context',
      ]),
    );
    const taskRoom = id(
      run([
        'room',
        'create',
        'task work',
        '--type',
        'task',
        '--task',
        task,
        '--human',
        'founder',
        '--agent',
        a,
      ]),
    );
    const archived = id(
      run(['room', 'create', 'archived', '--type', 'direct', '--human', 'founder', '--agent', a]),
    );
    run(['room', 'archive', archived]);
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
      `#!${process.execPath}\nawait Bun.write('calls', 'called');const i=JSON.parse(await Bun.stdin.text());if(i.message==='FAIL')throw Error('fixture failure');let text='INITIAL';if(i.instruction){const c=JSON.parse(i.instruction);text=JSON.stringify(c.memories.map(m=>m.id).sort());}console.log(JSON.stringify({type:'thread.started',thread_id:'scope-provider'}));console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text}}));console.log(JSON.stringify({type:'turn.completed',usage:{}}));`,
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
        { roomId: taskRoom, agentId: a, scopes: ['department:engineering', 'project:org'] },
      ]),
    );
    for (const grant of [
      { roomId: room, agentId: 'absent', scopes: [] },
      { roomId: other, agentId: b, scopes: [] },
      { roomId: archived, agentId: a, scopes: [] },
    ]) {
      writeFileSync(home + '/invalid.json', JSON.stringify([grant]));
      const rejected = spawnSync(
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
          home + '/runtime.json',
          '--memory-context-config',
          home + '/invalid.json',
        ],
        { encoding: 'utf8', timeout: 10000 },
      );
      assert.equal(rejected.status, 1, rejected.stderr);
      assert.match(rejected.stderr, /active Room participant Agent/);
      assert.equal(existsSync(socket), false);
      assert.equal(existsSync(home + '/calls'), false);
    }
    let retained: string | undefined;
    for (const phase of ['configured', 'restarted', 'legacy', 'auto']) {
      const configured = phase !== 'legacy';
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
        ...(phase === 'auto' ? ['--wake-up', '--poll-interval', '20'] : []),
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
      const check = (reply: unknown, expected = ['department', 'project']) => {
        assert.ok(
          reply &&
            typeof reply === 'object' &&
            'content' in reply &&
            typeof reply.content === 'string',
        );
        assert.deepEqual(JSON.parse(reply.content), expected);
      };
      if (phase === 'auto') {
        const mid = id(
          run(['room', 'send', room, '--human', 'founder', '--content', 'automatic scope'], true),
        );
        const deadline = performance.now() + 5000;
        while (true) {
          const messages = run(['room', 'messages', room], true);
          assert.ok(Array.isArray(messages));
          const reply: unknown = messages.find(
            (m: unknown) => m && typeof m === 'object' && 'replyTo' in m && m.replyTo === mid,
          );
          if (reply) {
            check(reply);
            break;
          }
          assert.ok(performance.now() < deadline, 'Automatic scope reply missing');
          await Bun.sleep(20);
        }
        await stop();
        continue;
      }
      if (phase === 'restarted' && retained) {
        const mid = id(
          run(['room', 'send', room, '--human', 'founder', '--content', 'resume scope'], true),
        );
        check(run(['session', 'reply', retained, '--room-message', mid], true));
        run(['session', 'stop', retained], true);
        retained = undefined;
      }
      if (phase === 'configured') {
        const started = run(
          ['session', 'start', '--agent', a, '--room', room, '--message', 'INITIAL'],
          true,
        );
        assert.ok(started && typeof started === 'object' && 'session' in started);
        const broken = id(started.session);
        const failed = spawnSync(
          process.execPath,
          [
            '--no-env-file',
            cli,
            '--db',
            db,
            '--socket',
            socket,
            'session',
            'send',
            broken,
            '--message',
            'FAIL',
          ],
          { encoding: 'utf8', timeout: 10000 },
        );
        assert.equal(failed.status, 1);
        const saved = run(['session', 'get', broken], true);
        assert.ok(
          saved &&
            typeof saved === 'object' &&
            'status' in saved &&
            saved.status === 'failed' &&
            'version' in saved &&
            typeof saved.version === 'number',
        );
        const rebuilt = run(
          ['session', 'rebuild', broken, '--expected-version', String(saved.version)],
          true,
        );
        const fresh = id(rebuilt);
        const mid = id(
          run(['room', 'send', room, '--human', 'founder', '--content', 'rebuild scope'], true),
        );
        check(run(['session', 'reply', fresh, '--room-message', mid], true));
        run(['session', 'stop', fresh], true);
        const assigned = run(['task', 'assign', task, '--owner', a], true);
        assert.ok(
          assigned &&
            typeof assigned === 'object' &&
            'version' in assigned &&
            typeof assigned.version === 'number',
        );
        const taskStarted = run(
          ['session', 'start', '--agent', a, '--room', taskRoom, '--message', 'INITIAL'],
          true,
        );
        assert.ok(taskStarted && typeof taskStarted === 'object' && 'session' in taskStarted);
        const taskSession = id(taskStarted.session);
        const taskSource = id(
          run(['room', 'send', taskRoom, '--human', 'founder', '--content', 'Task scope'], true),
        );
        const result = run(
          ['task', 'run', task, '--session', taskSession, '--room-message', taskSource],
          true,
        );
        assert.ok(
          result &&
            typeof result === 'object' &&
            'task' in result &&
            result.task !== null &&
            typeof result.task === 'object' &&
            'status' in result.task &&
            result.task.status === 'waiting_approval' &&
            'version' in result.task &&
            typeof result.task.version === 'number',
        );
        const replies = run(['room', 'messages', taskRoom], true);
        assert.ok(Array.isArray(replies));
        const reply: unknown = replies.find(
          (m: unknown) => m && typeof m === 'object' && 'replyTo' in m && m.replyTo === taskSource,
        );
        check(reply);
        assert.ok(
          reply &&
            typeof reply === 'object' &&
            'metadata' in reply &&
            reply.metadata &&
            typeof reply.metadata === 'object' &&
            'taskExecution' in reply.metadata,
        );
        assert.deepEqual(reply.metadata.taskExecution, {
          taskId: task,
          version: assigned.version + 1,
        });
        run(['session', 'stop', taskSession], true);
      }
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
        check(reply, configured && agent === a && roomId === room ? ['department', 'project'] : []);
        if (phase === 'configured' && agent === a && roomId === room) retained = sid;
        else run(['session', 'stop', sid], true);
      }
      await stop();
    }
  } finally {
    await stop();
    rmSync(home, { recursive: true, force: true });
  }
}, 30000);
