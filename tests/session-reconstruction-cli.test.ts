import { SqliteSessionStore } from '../src/sessions/sqlite.js';
import { cli } from './cli-path.js';
import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
function record(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}
test('CLI rebuilds a broken provider into a fresh Session with Room history, scoped summary and Agent memory without automatic retry', async () => {
  const home = mkdtempSync('/tmp/org-session-rebuild-cli-'),
    db = home + '/org.db',
    socket = home + '/org.sock',
    config = home + '/runtime.json',
    driver = home + '/driver.ts',
    count = home + '/turns';
  writeFileSync(count, '');
  writeFileSync(
    driver,
    `#!${process.execPath}\nimport assert from'node:assert/strict';import{appendFileSync}from'node:fs';const input=JSON.parse(await Bun.stdin.text());if(input.sessionId)process.exit(1);if(input.message!=='INITIAL'){const context=JSON.parse(input.instruction);assert.ok(context.messages.some(m=>m.content==='HISTORY_MARKER'));assert.ok(context.memories.some(m=>m.content==='ROOM_SUMMARY'));assert.ok(context.memories.some(m=>m.content==='AGENT_FACT'));assert.ok(!context.memories.some(m=>m.content==='OTHER_AGENT_PRIVATE'));appendFileSync(${JSON.stringify(count)},'fresh\\n');}console.log(JSON.stringify({type:'thread.started',thread_id:input.message==='INITIAL'?'broken':'fresh'}));console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'REBUILT_OK'}}));console.log(JSON.stringify({type:'turn.completed',usage:{}}));`,
    { mode: 0o700 },
  );
  writeFileSync(
    config,
    JSON.stringify({
      codex: { executable: driver, cwd: home, env: [], timeoutMs: 5000, maxOutputBytes: 4096 },
    }),
  );
  const run = (args: string[], remote = false, expected = 0): unknown => {
    const raw = args[0] === 'agent' && args[1] === 'create';
    const r = spawnSync(
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
      { encoding: 'utf8', timeout: 5000 },
    );
    assert.equal(r.status, expected, r.stderr);
    return raw || expected !== 0 ? r.stdout : JSON.parse(r.stdout);
  };
  const entity = (args: string[], remote = false): Record<string, unknown> & { id: string } => {
    const v = run(args, remote);
    assert.ok(record(v) && typeof v.id === 'string');
    return { ...v, id: v.id };
  };
  const list = (args: string[], remote = false): unknown[] => {
    const v = run(args, remote);
    assert.ok(Array.isArray(v));
    return v;
  };
  let daemon: ReturnType<typeof spawn> | undefined, exited: Promise<unknown> | undefined;
  try {
    run([
      'agent',
      'create',
      'worker',
      '--role',
      'Read scoped Room context',
      '--runtime',
      'codex',
      '--capability',
      'can_read',
    ]);
    const agent: unknown = list(['agent', 'list'])[0];
    assert.ok(record(agent) && typeof agent.id === 'string');
    const room = entity([
      'room',
      'create',
      'Recovery',
      '--type',
      'direct',
      '--human',
      'founder',
      '--agent',
      agent.id,
    ]);
    const source = entity([
      'room',
      'send',
      room.id,
      '--human',
      'founder',
      '--content',
      'HISTORY_MARKER',
    ]);
    for (const [scope, content] of [
      ['room:' + room.id, 'ROOM_SUMMARY'],
      ['agent:' + agent.id, 'AGENT_FACT'],
      ['agent:other', 'OTHER_AGENT_PRIVATE'],
    ]) {
      assert.ok(scope && content);
      run([
        'memory',
        'capture',
        '--type',
        'semantic',
        '--scope',
        scope,
        '--content',
        content,
        '--confidence',
        '1',
        '--room',
        room.id,
        '--message',
        source.id,
      ]);
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
      config,
    ]);
    exited = new Promise((r) => daemon?.once('exit', r));
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Not ready')), 5000);
      daemon?.stdout?.on('data', (v) => {
        if (v.toString().includes('"ready"')) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    const initial = run(
      ['session', 'start', '--agent', agent.id, '--room', room.id, '--message', 'INITIAL'],
      true,
    );
    assert.ok(record(initial) && record(initial.session) && typeof initial.session.id === 'string');
    const oldId = initial.session.id;
    run(['session', 'send', oldId, '--message', 'FAIL'], true, 1);
    const failed = entity(['session', 'get', oldId], true);
    assert.equal(failed.status, 'failed');
    assert.equal(failed.providerSessionId, 'broken');
    assert.ok(typeof failed.version === 'number');
    const rebuilt = entity(
      ['session', 'rebuild', oldId, '--expected-version', String(failed.version)],
      true,
    );
    assert.notEqual(rebuilt.id, oldId);
    assert.equal(rebuilt.providerSessionId, null);
    assert.deepEqual(rebuilt.rebuiltFrom, { sessionId: oldId, version: failed.version });
    assert.equal(readFileSync(count, 'utf8'), '');
    const message = entity(
      ['room', 'send', room.id, '--human', 'founder', '--content', 'CONTINUE'],
      true,
    );
    const replies = list(['room', 'activate', room.id, '--message', message.id], true);
    const reply: unknown = replies[0];
    assert.ok(record(reply) && record(reply.metadata));
    assert.equal(reply.content, 'REBUILT_OK');
    assert.equal(reply.metadata.sessionId, rebuilt.id);
    assert.equal(readFileSync(count, 'utf8'), 'fresh\n');
    assert.equal(entity(['session', 'get', oldId], true).status, 'stopped');
    run(['session', 'rebuild', oldId, '--expected-version', String(failed.version)], true, 1);
    run(['daemon', 'stop'], true);
    await exited;
    daemon = undefined;
    const reopened = new SqliteSessionStore(db);
    try {
      assert.equal(reopened.get(rebuilt.id).providerSessionId, 'fresh');
      assert.equal(reopened.history(oldId).at(-2)?.status, 'failed');
    } finally {
      reopened.close();
    }
    assert.equal(list(['memory', 'list']).length, 3);
    assert.equal(list(['room', 'messages', room.id]).length, 3);
    const records = list(['audit', 'list']);
    const rebuild = records.find((entry) => record(entry) && entry.tool === 'session.rebuild');
    assert.ok(record(rebuild));
    assert.equal(
      rebuild.inputRef,
      'org://sessions/' + encodeURIComponent(oldId) + '/versions/' + failed.version,
    );
    assert.equal(
      rebuild.outputRef,
      'org://sessions/' + encodeURIComponent(rebuilt.id) + '/versions/0',
    );
    assert.deepEqual(rebuild.actor, { kind: 'system', id: 'runtime-manager' });
    assert.ok(
      records.some(
        (entry) => record(entry) && entry.tool === 'session.runtime' && entry.result === 'failed',
      ),
    );
    assert.deepEqual(list(['audit', 'list']), records);
  } finally {
    if (daemon) {
      daemon.kill('SIGTERM');
      await exited;
    }
    rmSync(home, { recursive: true, force: true });
  }
}, 15000);
