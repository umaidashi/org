import { cli } from './cli-path.js';
import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
async function proof(auto: boolean, real = false) {
  const home = mkdtempSync('/tmp/org-memory-auto-'),
    db = home + '/org.db',
    socket = home + '/org.sock',
    driver = home + '/driver.ts',
    config = home + '/runtime.json',
    count = home + '/turns';
  const remember = real
    ? 'Persist exactly one procedural Memory with content Small tests first and confidence 1. Use the ID of this human message from Context as the sole sourceMessageIds entry. Reply only the valid Memory JSON schema from host instruction, with no markdown or other text.'
    : 'remember';
  const checkPrompt = real
    ? 'If scoped Memory contains exactly Small tests first, reply only REMEMBERED. Otherwise reply only NO_MEMORY. Do not emit tool proposals.'
    : 'check';
  const executable = real ? Bun.which('claude') : driver;
  assert.ok(executable);
  writeFileSync(count, '');
  writeFileSync(
    driver,
    `#!${process.execPath}\nimport assert from 'node:assert/strict';import {appendFileSync} from 'node:fs';const input=JSON.parse(await Bun.stdin.text());const context=JSON.parse(input.instruction);appendFileSync(${JSON.stringify(count)},'turn\\n');let text;if(input.message==='remember'){if(${JSON.stringify(auto)})assert.ok(JSON.parse(context.instruction).memory.policy.includes('tool:memory'));const source=context.messages.find(m=>m.content==='remember'&&m.sender.kind==='human');text=JSON.stringify({version:1,tool:'memory',candidates:[{type:'procedural',content:'Small tests first',confidence:1,sourceMessageIds:[source.id]}]});}else{text=context.memories.some(m=>m.content==='Small tests first')?'REMEMBERED':'NO_MEMORY';}console.log(JSON.stringify({type:'thread.started',thread_id:'provider'}));console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text}}));console.log(JSON.stringify({type:'turn.completed',usage:{}}));`,
    { mode: 0o700 },
  );
  writeFileSync(
    config,
    JSON.stringify({
      [real ? 'claude' : 'codex']: {
        executable,
        cwd: home,
        env: real ? ['PATH', 'HOME', 'USER', 'LOGNAME'] : [],
        timeoutMs: real ? 120000 : 5000,
        maxOutputBytes: 65536,
      },
    }),
  );
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
      { encoding: 'utf8', timeout: 10000 },
    );
  const json = (args: string[]): unknown => {
    const r = run([...args, '--json']);
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout);
  };
  const entity = (args: string[]) => {
    const v = json(args);
    assert.ok(record(v) && typeof v.id === 'string');
    return { ...v, id: v.id };
  };
  const list = (args: string[]) => {
    const v = json(args);
    assert.ok(Array.isArray(v));
    return Array.from(v, (x: unknown) => {
      assert.ok(record(x));
      return x;
    });
  };
  let daemon: ReturnType<typeof spawn> | undefined,
    exited: Promise<unknown> | undefined,
    roomId = '';
  const launch = async () => {
    daemon = spawn(process.execPath, [
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
      ...(auto ? ['--memory-extraction-room', roomId] : []),
    ]);
    exited = new Promise((r) => daemon?.once('exit', r));
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('not ready')), 5000);
      daemon?.stdout?.on('data', (b: Buffer) => {
        if (b.toString().includes('"ready"')) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
  };
  const wait = async <T>(read: () => T | undefined) => {
    const deadline = performance.now() + (real ? 130000 : 10000);
    while (performance.now() < deadline) {
      const v = read();
      if (v !== undefined) return v;
      await Bun.sleep(20);
    }
    throw Error('expected projection');
  };
  try {
    assert.equal(
      run([
        '--direct',
        'agent',
        'create',
        'worker',
        '--role',
        'memory',
        '--runtime',
        real ? 'claude' : 'codex',
        '--capability',
        'can_read',
        '--capability',
        'can_write',
      ]).status,
      0,
    );
    const agent = list(['--direct', 'agent', 'list'])[0];
    assert.ok(agent && typeof agent.id === 'string');
    const room = entity([
      '--direct',
      'room',
      'create',
      'Memory',
      '--type',
      'direct',
      '--human',
      'founder',
      '--agent',
      agent.id,
    ]);
    roomId = room.id;
    await launch();
    const source = entity(['room', 'send', roomId, '--human', 'founder', '--content', remember]);
    const reply = await wait(() =>
      list(['room', 'messages', roomId]).find((m) => m.replyTo === source.id),
    );
    assert.ok(typeof reply.id === 'string');
    const memories = auto
      ? await wait(() => {
          const ms = list(['memory', 'list', '--scope', 'room:' + roomId]);
          return ms.length ? ms : undefined;
        })
      : list(['memory', 'list', '--scope', 'room:' + roomId]);
    assert.equal(memories.length, auto ? 1 : 0);
    if (auto) {
      const memory = memories[0];
      assert.ok(memory && typeof memory.id === 'string');
      assert.deepEqual(memory.sourceRefs, [
        { roomId, messageId: source.id },
        { roomId, messageId: reply.id },
      ]);
      assert.deepEqual(
        json(['memory', 'extract', '--room', roomId, '--message', reply.id]),
        memories,
      );
      const check = entity([
        'room',
        'send',
        roomId,
        '--human',
        'founder',
        '--content',
        checkPrompt,
      ]);
      assert.equal(
        (await wait(() => list(['room', 'messages', roomId]).find((m) => m.replyTo === check.id)))
          .content,
        'REMEMBERED',
      );
      json(['memory', 'invalidate', memory.id, '--reason', 'No longer valid']);
      const repeated = entity([
        'room',
        'send',
        roomId,
        '--human',
        'founder',
        '--content',
        remember,
      ]);
      await wait(() => list(['room', 'messages', roomId]).find((m) => m.replyTo === repeated.id));
      const after = list(['memory', 'list', '--scope', 'room:' + roomId]);
      assert.equal(after.length, 1);
      assert.equal(after[0]?.id, memory.id);
      assert.equal(after[0]?.status, 'invalidated');
      const originals = list(['room', 'messages', roomId]);
      json(['daemon', 'stop']);
      await exited;
      daemon = undefined;
      const turns = readFileSync(count, 'utf8');
      await launch();
      await Bun.sleep(100);
      assert.equal(readFileSync(count, 'utf8'), turns);
      assert.deepEqual(list(['room', 'messages', roomId]), originals);
      assert.deepEqual(list(['memory', 'list', '--scope', 'room:' + roomId]), after);
    }
  } finally {
    if (daemon) {
      run(['daemon', 'stop']);
      daemon.kill('SIGTERM');
      await exited;
    }
    rmSync(home, { recursive: true, force: true });
  }
}
test.each([false, true])(
  'native Room Memory proposal auto=%s preserves Context evidence and no revival across restart',
  (auto) => proof(auto),
  20000,
);
test.skipIf(process.env.ORG_MEMORY_EXTRACTION_TEST !== '1')(
  'real Claude Memory proposal auto adoption reaches scoped Context and preserves invalidation across restart',
  () => proof(true, true),
  420000,
);
