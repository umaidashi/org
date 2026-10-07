import { cli } from './cli-path.js';
import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { SqliteWakeupJournal } from '../src/activation/sqlite.js';
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
test('daemon automatic wake-up persists outcomes once, drains cancelled turns and does not replay after restart', async () => {
  const home = mkdtempSync('/tmp/org-auto-wake-'),
    db = home + '/org.db',
    socket = home + '/org.sock',
    driver = home + '/driver.ts',
    config = home + '/config.json',
    count = home + '/turns';
  writeFileSync(count, '');
  writeFileSync(
    driver,
    `#!${process.execPath}\nimport {appendFileSync} from 'node:fs'; const input=JSON.parse(await Bun.stdin.text()); appendFileSync(${JSON.stringify(count)},'turn\\n'); if(input.message==='wait')setInterval(()=>{},100);else if(input.message==='fail')process.exit(1);else{const context=JSON.parse(input.instruction);if(!context.messages.some(m=>m.content===input.message))throw new Error('Missing source context');console.log(JSON.stringify({type:'thread.started',thread_id:'provider'}));console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'Answer:'+input.message}}));console.log(JSON.stringify({type:'turn.completed',usage:{}}));}\n`,
    { mode: 0o700 },
  );
  writeFileSync(
    config,
    JSON.stringify({
      codex: { executable: driver, cwd: home, env: [], timeoutMs: 10000, maxOutputBytes: 4096 },
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
      { encoding: 'utf8', timeout: 5000 },
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
  const turns = () => readFileSync(count, 'utf8').trim().split('\n').filter(Boolean).length;
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
      '--wake-up',
      '--poll-interval',
      '20',
    ]);
    const exited = new Promise((resolve) => child.once('exit', resolve));
    let error = '';
    child.stderr.on('data', (v: Buffer) => {
      error += v.toString();
    });
    const ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Not ready:' + error)), 5000);
      child.stdout.on('data', (v: Buffer) => {
        if (v.toString().includes('"ready"')) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    return { child, exited, ready };
  };
  const receipt = (id: string) => {
    const all = json(['daemon', 'wakeups']);
    assert.ok(Array.isArray(all));
    const found: unknown = all.find((r: unknown) => record(r) && r.messageId === id);
    if (found === undefined) return undefined;
    assert.ok(record(found));
    return found;
  };
  const wait = async (check: () => boolean) => {
    const limit = Date.now() + 5000;
    while (!check()) {
      if (Date.now() > limit) throw new Error('Timed out');
      await Bun.sleep(20);
    }
  };
  let daemon: ReturnType<typeof launch> | undefined;
  try {
    for (const name of ['chief', 'cto'])
      assert.equal(
        run([
          '--direct',
          'agent',
          'create',
          name,
          '--role',
          name,
          '--runtime',
          'codex',
          '--capability',
          'can_read',
        ]).status,
        0,
      );
    const agents = json(['--direct', 'agent', 'list']);
    assert.ok(Array.isArray(agents));
    const id = (name: string) => {
      const v: unknown = agents.find((a: unknown) => record(a) && a.name === name);
      assert.ok(record(v) && typeof v.id === 'string');
      return v.id;
    };
    const chief = id('chief'),
      cto = id('cto');
    const room = entity([
      '--direct',
      'room',
      'create',
      'Company',
      '--type',
      'group',
      '--human',
      'founder',
      '--agent',
      chief,
      '--agent',
      cto,
      '--coordinator',
      chief,
    ]);
    const first = entity([
      '--direct',
      'room',
      'send',
      room.id,
      '--human',
      'founder',
      '--content',
      'First',
    ]);
    daemon = launch();
    await daemon.ready;
    await wait(() => receipt(first.id)?.status === 'completed');
    assert.equal(turns(), 1);
    const sessions = json(['session', 'list']);
    assert.ok(Array.isArray(sessions) && sessions.length === 1);
    assert.ok(record(sessions[0]));
    assert.equal(sessions[0].agentId, chief);
    const mentioned = entity([
      'room',
      'send',
      room.id,
      '--human',
      'founder',
      '--content',
      'CTO',
      '--mention',
      cto,
    ]);
    await wait(() => receipt(mentioned.id)?.status === 'completed');
    assert.equal(turns(), 2);
    const bad = entity(['room', 'send', room.id, '--human', 'founder', '--content', 'fail']);
    await wait(() => receipt(bad.id)?.status === 'failed');
    assert.equal(turns(), 3);
    const next = entity(['room', 'send', room.id, '--human', 'founder', '--content', 'Next']);
    await wait(() => receipt(next.id)?.status === 'completed');
    assert.equal(turns(), 4);
    const pending = entity(['room', 'send', room.id, '--human', 'founder', '--content', 'wait']);
    await wait(() => receipt(pending.id)?.status === 'running' && turns() === 5);
    assert.equal(run(['daemon', 'stop']).status, 0);
    await daemon.exited;
    daemon = undefined;
    const store = new SqliteWakeupJournal(db);
    try {
      assert.equal(store.get(pending.id)?.status, 'failed');
    } finally {
      store.close();
    }
    const interrupted = entity([
      '--direct',
      'room',
      'send',
      room.id,
      '--human',
      'founder',
      '--content',
      'Interrupted',
    ]);
    const journal = new SqliteWakeupJournal(db);
    try {
      assert.equal(
        journal.claim({ messageId: interrupted.id, roomId: room.id, startedAt: 'before restart' }),
        true,
      );
    } finally {
      journal.close();
    }
    daemon = launch();
    await daemon.ready;
    await wait(() => receipt(interrupted.id)?.status === 'failed');
    const final = entity(['room', 'send', room.id, '--human', 'founder', '--content', 'Final']);
    await wait(() => receipt(final.id)?.status === 'completed');
    assert.equal(turns(), 6);
    assert.equal(receipt(first.id)?.status, 'completed');
    assert.equal(receipt(bad.id)?.status, 'failed');
    assert.equal(receipt(pending.id)?.status, 'failed');
    assert.equal(receipt(interrupted.id)?.error, 'Room activation interrupted by daemon restart');
  } finally {
    if (daemon) {
      spawnSync(process.execPath, ['--no-env-file', cli, 'daemon', 'stop', '--socket', socket], {
        timeout: 5000,
      });
      daemon.child.kill('SIGTERM');
      await daemon.exited;
    }
    rmSync(home, { recursive: true, force: true });
  }
}, 20000);
