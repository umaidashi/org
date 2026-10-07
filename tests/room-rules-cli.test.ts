import { cli } from './cli-path.js';
import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
test('persisted Room rules wake native Runtime only for matching human metadata and do not replay after restart', async () => {
  const home = mkdtempSync('/tmp/org-room-rules-cli-'),
    db = home + '/org.db',
    socket = home + '/org.sock',
    config = home + '/runtime.json',
    driver = home + '/driver.ts',
    count = home + '/turns';
  writeFileSync(count, '');
  writeFileSync(
    driver,
    `#!${process.execPath}\nimport{appendFileSync}from'node:fs';await Bun.stdin.text();appendFileSync(${JSON.stringify(count)},'turn\\n');console.log(JSON.stringify({type:'thread.started',thread_id:'provider'}));console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'RULE_CHECKED'}}));console.log(JSON.stringify({type:'turn.completed',usage:{}}));`,
    { mode: 0o700 },
  );
  writeFileSync(
    config,
    JSON.stringify({
      codex: { executable: driver, cwd: home, env: [], timeoutMs: 5000, maxOutputBytes: 4096 },
    }),
  );
  const run = (args: string[], remote = false): unknown => {
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
    assert.equal(r.status, 0, r.stderr);
    return raw ? r.stdout : JSON.parse(r.stdout);
  };
  const entity = (args: string[], remote = false): Record<string, unknown> & { id: string } => {
    const value = run(args, remote);
    assert.ok(record(value) && typeof value.id === 'string');
    return { ...value, id: value.id };
  };
  const list = (args: string[], remote = false): unknown[] => {
    const value = run(args, remote);
    assert.ok(Array.isArray(value));
    return value;
  };
  let daemon: ReturnType<typeof spawn> | undefined, exited: Promise<unknown> | undefined;
  const start = async () => {
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
  };
  try {
    run([
      'agent',
      'create',
      'worker',
      '--role',
      'Read Room and reply',
      '--runtime',
      'codex',
      '--capability',
      'can_read',
    ]);
    const agent = list(['agent', 'list'])[0];
    assert.ok(record(agent) && typeof agent.id === 'string');
    const room = entity([
      'room',
      'create',
      'Rules',
      '--type',
      'direct',
      '--human',
      'founder',
      '--agent',
      agent.id,
      '--activation-policy',
      'rule_based',
      '--activation-rules',
      JSON.stringify([{ agentId: agent.id, metadata: { topic: 'code' } }]),
    ]);
    assert.ok(record(room) && typeof room.id === 'string');
    const reopened = entity(['room', 'get', room.id]);
    assert.ok(Array.isArray(reopened.activationRules));
    assert.equal(reopened.activationRules.length, 1);
    const ignored = entity([
      'room',
      'send',
      room.id,
      '--human',
      'founder',
      '--content',
      'IGNORE',
      '--metadata',
      '{"topic":"other"}',
    ]);
    assert.deepEqual(run(['room', 'targets', room.id, '--message', ignored.id]), []);
    await start();
    const message = entity(
      [
        'room',
        'send',
        room.id,
        '--human',
        'founder',
        '--content',
        'MATCH',
        '--metadata',
        '{"topic":"code"}',
      ],
      true,
    );
    assert.deepEqual(run(['room', 'targets', room.id, '--message', message.id], true), [agent.id]);
    const end = Date.now() + 5000;
    let messages: unknown[];
    while (true) {
      messages = list(['room', 'messages', room.id], true);
      if (messages.length === 3) break;
      assert.ok(Date.now() < end);
      await Bun.sleep(20);
    }
    const reply: unknown = messages[2];
    assert.ok(record(reply));
    assert.equal(reply.content, 'RULE_CHECKED');
    assert.equal(readFileSync(count, 'utf8'), 'turn\n');
    run(['daemon', 'stop'], true);
    await exited;
    daemon = undefined;
    await start();
    await Bun.sleep(150);
    assert.equal(list(['room', 'messages', room.id], true).length, 3);
    assert.equal(readFileSync(count, 'utf8'), 'turn\n');
  } finally {
    if (daemon) {
      daemon.kill('SIGTERM');
      await exited;
    }
    rmSync(home, { recursive: true, force: true });
  }
}, 15000);
