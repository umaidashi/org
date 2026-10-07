import { SqliteEventBus } from '../src/events/sqlite.js';
import { createEvent } from '../src/events/domain.js';
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
    `#!${process.execPath}\nimport assert from 'node:assert/strict';import {appendFileSync} from 'node:fs';const input=JSON.parse(await Bun.stdin.text());const context=JSON.parse(input.instruction);appendFileSync(${JSON.stringify(count)},'turn\\n');let text;if(input.message==='remember'){if(${JSON.stringify(auto)})assert.ok(JSON.parse(context.instruction).memory.policy.includes('tool:memory'));const source=context.messages.find(m=>m.content==='remember'&&m.sender.kind==='human');text=JSON.stringify({version:1,tool:'memory',candidates:[{type:'procedural',content:'Small tests first',confidence:1,sourceMessageIds:[source.id],sourceUris:['org://events/fixture-source']}]});}else{text=context.memories.some(m=>m.content==='Small tests first')?'REMEMBERED':'NO_MEMORY';}console.log(JSON.stringify({type:'thread.started',thread_id:'provider'}));console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text}}));console.log(JSON.stringify({type:'turn.completed',usage:{}}));`,
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
  const entity = (args: string[]): Record<string, unknown> & { id: string } => {
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
    if (!real) {
      const bus = new SqliteEventBus(db);
      try {
        bus.publish(
          createEvent(
            { type: 'fixture.observed', source: 'fixture', payload: {} },
            { id: 'fixture-source', createdAt: '2026-10-01T00:00:00.000Z' },
          ),
        );
      } finally {
        bus.close();
      }
    }
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
        ...(!real ? [{ uri: 'org://events/fixture-source' }] : []),
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
      if (real) {
        const summaryPrompt =
          'Supplied facts: the database is SQLite; the runtime is Claude Max. Summarize both facts into exactly one semantic Room Memory with confidence 1. Preserve both product names. Use this human message ID from Context as the sole sourceMessageIds entry. Reply only the host Memory JSON schema, no markdown.';
        const summarySource = entity([
          'room',
          'send',
          roomId,
          '--human',
          'founder',
          '--content',
          summaryPrompt,
        ]);
        const summaryReply = await wait(() =>
          list(['room', 'messages', roomId]).find((m) => m.replyTo === summarySource.id),
        );
        const summary = await wait(() =>
          list(['memory', 'list', '--scope', 'room:' + roomId]).find(
            (m) => m.type === 'semantic' && m.status === 'active',
          ),
        );
        assert.ok(typeof summary.content === 'string');
        assert.match(summary.content, /SQLite/);
        assert.match(summary.content, /Claude Max/);
        assert.deepEqual(summary.sourceRefs, [
          { roomId, messageId: summarySource.id },
          { roomId, messageId: summaryReply.id },
        ]);
        const old = list(['session', 'list']).find(
          (s) => s.agentId === agent.id && s.roomId === roomId && s.status === 'idle',
        );
        assert.ok(old && typeof old.id === 'string' && typeof old.providerSessionId === 'string');
        assert.equal(entity(['session', 'stop', old.id]).status, 'stopped');
        for (let i = 0; i < 31; i++)
          entity([
            'room',
            'send',
            roomId,
            '--agent',
            agent.id,
            '--content',
            'Retention fixture ' + i,
          ]);
        assert.ok(
          !list(['room', 'messages', roomId])
            .slice(-30)
            .some((m) => m.id === summarySource.id || m.id === summaryReply.id),
        );
        const recall = entity([
          'room',
          'send',
          roomId,
          '--human',
          'founder',
          '--content',
          'Use only the semantic Room Memory in the Context memories array. If it preserves both supplied facts from the summary, reply only ROOM_SUMMARY_OK; otherwise reply only NO_SUMMARY. Do not emit tool proposals.',
        ]);
        const recalled = await wait(() =>
          list(['room', 'messages', roomId]).find((m) => m.replyTo === recall.id),
        );
        assert.equal(recalled.content, 'ROOM_SUMMARY_OK');
        const fresh = list(['session', 'list']).find(
          (s) =>
            s.id !== old.id && s.agentId === agent.id && s.roomId === roomId && s.status === 'idle',
        );
        assert.ok(fresh && typeof fresh.providerSessionId === 'string');
        assert.notEqual(fresh.providerSessionId, old.providerSessionId);
        assert.equal(
          recalled.metadata && record(recalled.metadata) ? recalled.metadata.sessionId : undefined,
          fresh.id,
        );
        const summaryOriginals = list(['room', 'messages', roomId]),
          summaryMemories = list(['memory', 'list', '--scope', 'room:' + roomId]);
        assert.equal(
          summaryOriginals.find((m) => m.id === summarySource.id)?.content,
          summaryPrompt,
        );
        json(['daemon', 'stop']);
        await exited;
        daemon = undefined;
        await launch();
        await Bun.sleep(100);
        assert.deepEqual(list(['room', 'messages', roomId]), summaryOriginals);
        assert.deepEqual(list(['memory', 'list', '--scope', 'room:' + roomId]), summaryMemories);
      }
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
  'real Claude adopts Room Memory and restores generated summary into a fresh Session beyond the history window without rewriting originals',
  () => proof(true, true),
  720000,
);
