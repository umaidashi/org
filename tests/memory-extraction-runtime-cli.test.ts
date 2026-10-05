import { SqliteMemoryProvider } from '../src/memory/sqlite.js';
import { createMemory } from '../src/memory/domain.js';
import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { cli } from './cli-path.js';
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
test('daemon Runtime original proposal projects scoped Memory and the next Room turn retrieves it with scoped full-text tie-breaking without rewriting evidence', async () => {
  const home = mkdtempSync('/tmp/org-memory-runtime-'),
    db = home + '/org.db',
    socket = home + '/org.sock';
  const driver = home + '/driver.ts';
  writeFileSync(
    driver,
    `#!${process.execPath}\nimport assert from'node:assert/strict';const i=JSON.parse(await Bun.stdin.text());let text='INITIAL';if(i.message!=='INITIAL'){const c=JSON.parse(i.instruction);if(i.message==='SQLite'){assert.deepEqual(c.memories.filter(m=>['a-miss','z-hit','foreign','expired'].includes(m.id)).map(m=>m.id),['z-hit','a-miss']);text='FTS_CONTEXT_OK';}else if(i.message==='VERIFY'){assert.ok(c.memories.some(m=>m.type==='procedural'&&m.content==='先に最小UTを実行する'&&m.scope==='room:'+c.room.id));text='CONTEXT_OK';}else{text=JSON.stringify({version:1,tool:'memory',candidates:[{type:'procedural',content:'先に最小UTを実行する',confidence:1,sourceMessageIds:[c.messages.at(-1).id]}]});}}console.log(JSON.stringify({type:'thread.started',thread_id:'memory-provider'}));console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text}}));console.log(JSON.stringify({type:'turn.completed',usage:{}}));`,
    { mode: 0o700 },
  );
  writeFileSync(
    home + '/runtime.json',
    JSON.stringify({
      codex: { executable: driver, cwd: home, env: [], timeoutMs: 5000, maxOutputBytes: 4096 },
    }),
  );
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
    assert.ok(record(v) && typeof v.id === 'string');
    return v.id;
  };
  let daemon: ReturnType<typeof spawn> | undefined, exited: Promise<unknown> | undefined;
  try {
    run([
      'agent',
      'create',
      'worker',
      '--role',
      'Memory proposer',
      '--runtime',
      'codex',
      '--capability',
      'can_read',
      '--capability',
      'can_write',
    ]);
    const agents = run(['agent', 'list']);
    assert.ok(Array.isArray(agents));
    const agentId = id(agents[0]);
    const roomId = id(
      run(['room', 'create', 'work', '--type', 'direct', '--human', 'founder', '--agent', agentId]),
    );
    const sourceId = id(
      run(['room', 'send', roomId, '--human', 'founder', '--content', '先に最小UTを実行する']),
    );
    const memoryProvider = new SqliteMemoryProvider(db);
    try {
      for (const [id, content, scope] of [
        ['a-miss', 'different fact', 'room:' + roomId],
        ['z-hit', 'SQLite is local', 'room:' + roomId],
        ['foreign', 'SQLite private', 'agent:other'],
        ['expired', 'SQLite expired', 'room:' + roomId],
      ]) {
        assert.ok(id && content && scope);
        memoryProvider.create(
          createMemory(
            {
              type: 'semantic',
              scope,
              content,
              confidence: 1,
              sourceRefs: [{ roomId, messageId: sourceId }],
              ...(id === 'expired' ? { validUntil: 1 } : {}),
            },
            { id, at: '2026-10-01T00:00:00.000Z' },
          ),
        );
      }
    } finally {
      memoryProvider.close();
    }
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
    ]);
    exited = new Promise((resolve) => daemon?.once('exit', resolve));
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Daemon not ready')), 5000);
      daemon?.stdout?.on('data', (v: Buffer) => {
        if (v.toString().includes('"ready"')) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    const started = run(
      ['session', 'start', '--agent', agentId, '--room', roomId, '--message', 'INITIAL'],
      true,
    );
    assert.ok(record(started));
    const sessionId = id(started.session);
    const proposalId = id(run(['session', 'reply', sessionId, '--room-message', sourceId], true));
    const memories = run(['memory', 'extract', '--room', roomId, '--message', proposalId], true);
    assert.ok(Array.isArray(memories));
    assert.equal(memories.length, 1);
    const verifyId = id(
      run(['room', 'send', roomId, '--human', 'founder', '--content', 'VERIFY'], true),
    );
    const reply = run(['session', 'reply', sessionId, '--room-message', verifyId], true);
    assert.ok(record(reply));
    assert.equal(reply.content, 'CONTEXT_OK');
    const messages = run(['room', 'messages', roomId], true);
    assert.ok(Array.isArray(messages));
    const originals: readonly unknown[] = messages;
    const source = originals.find((m) => record(m) && m.id === sourceId);
    assert.ok(record(source));
    assert.equal(source.content, '先に最小UTを実行する');
    assert.deepEqual(
      run(['memory', 'extract', '--room', roomId, '--message', proposalId], true),
      memories,
    );
    const queryId = id(
      run(['room', 'send', roomId, '--human', 'founder', '--content', 'SQLite'], true),
    );
    const fullTextReply = run(['session', 'reply', sessionId, '--room-message', queryId], true);
    assert.ok(record(fullTextReply));
    assert.equal(fullTextReply.content, 'FTS_CONTEXT_OK');
  } finally {
    if (daemon) {
      try {
        run(['daemon', 'stop'], true);
      } catch {
        daemon.kill('SIGTERM');
      }
      await exited;
    }
    rmSync(home, { recursive: true, force: true });
  }
}, 15000);
