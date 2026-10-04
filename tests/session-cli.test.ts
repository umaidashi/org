import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SqliteSessionStore } from '../src/sessions/sqlite.js';
import { transitionSession } from '../src/sessions/domain.js';
const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
test('Session CLI runs configured daemon runtime and cancels pending turns before daemon stop and restart recovery', async () => {
  const home = mkdtempSync('/tmp/org-session-cli-');
  const db = join(home, 'org.db');
  const socket = join(home, 'org.sock');
  const executable = join(home, 'runtime.ts');
  const config = join(home, 'runtime.json');
  const marker = join(home, 'started');
  writeFileSync(
    executable,
    `#!${process.execPath}\nconst input = JSON.parse(await Bun.stdin.text());
    if (input.message === 'wait') { await Bun.write(${JSON.stringify(marker)}, 'ready'); setInterval(() => {}, 100); }
    else { if(input.message === 'room question' && !JSON.parse(input.instruction).memories.some(m=>m.content === 'Room practice')) throw new Error('Scoped Memory missing'); console.log(JSON.stringify({type:'thread.started',thread_id:'provider'})); console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:input.message}})); console.log(JSON.stringify({type:'turn.completed',usage:{}})); }\n`,
    { mode: 0o700 },
  );
  writeFileSync(
    config,
    JSON.stringify({
      codex: { executable, cwd: home, env: [], timeoutMs: 5000, maxOutputBytes: 4096 },
    }),
  );
  const run = (args: string[]) =>
    spawnSync(process.execPath, ['--no-env-file', cli, '--db', db, ...args], {
      encoding: 'utf8',
      timeout: 10000,
    });
  const json = (args: string[]) => {
    const result = run([...args, '--json']);
    assert.equal(result.status, 0, result.stderr);
    const value: unknown = JSON.parse(result.stdout);
    return value;
  };
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
    ]);
    const exited = new Promise<number | null>((resolve) => child.once('exit', resolve));
    let error = '';
    child.stderr.on('data', (value: Buffer) => {
      error += value.toString();
    });
    const ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Daemon not ready: ${error}`)), 5000);
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
  const pending: ReturnType<typeof spawn>[] = [];
  try {
    assert.equal(
      run(['--direct', 'agent', 'create', 'chief', '--role', 'Chief', '--runtime', 'codex']).status,
      0,
    );
    const list = json(['--direct', 'agent', 'list']);
    assert.ok(Array.isArray(list) && record(list[0]) && typeof list[0].id === 'string');
    const room = json([
      '--direct',
      'room',
      'create',
      'work',
      '--type',
      'direct',
      '--human',
      'founder',
      '--agent',
      list[0].id,
    ]);
    assert.ok(record(room) && typeof room.id === 'string');
    const direct = run(['--direct', 'session', 'list']);
    assert.equal(direct.status, 2);
    daemon = launch();
    await daemon.ready;
    const start = json([
      '--socket',
      socket,
      'session',
      'start',
      '--agent',
      list[0].id,
      '--room',
      room.id,
      '--message',
      'first',
    ]);
    assert.ok(record(start) && record(start.session) && typeof start.session.id === 'string');
    const id = start.session.id;
    assert.equal(start.text, 'first');
    const resume = json(['--socket', socket, 'session', 'resume', id, '--message', 'again']);
    assert.ok(record(resume));
    assert.equal(resume.text, 'again');
    const source = json([
      '--socket',
      socket,
      'room',
      'send',
      room.id,
      '--human',
      'founder',
      '--content',
      'room question',
    ]);
    assert.ok(record(source) && typeof source.id === 'string');
    json([
      '--socket',
      socket,
      'memory',
      'capture',
      '--type',
      'procedural',
      '--scope',
      'room:' + room.id,
      '--room',
      room.id,
      '--message',
      source.id,
      '--confidence',
      '0.8',
      '--content',
      'Room practice',
    ]);
    const reply = json(['--socket', socket, 'session', 'reply', id, '--room-message', source.id]);
    assert.ok(record(reply) && typeof reply.id === 'string');
    assert.equal(reply.content, 'room question');
    assert.equal(reply.replyTo, source.id);
    const repeated = json([
      '--socket',
      socket,
      'session',
      'reply',
      id,
      '--room-message',
      source.id,
    ]);
    assert.ok(record(repeated));
    assert.equal(repeated.id, reply.id);
    const conversation = json(['--socket', socket, 'room', 'messages', room.id]);
    assert.ok(Array.isArray(conversation));
    assert.equal(conversation.length, 2);
    const beginWait = () => {
      const child = spawn(process.execPath, [
        '--no-env-file',
        cli,
        '--socket',
        socket,
        'session',
        'send',
        id,
        '--message',
        'wait',
        '--json',
      ]);
      pending.push(child);
      child.stdout.resume();
      child.stderr.resume();
      return new Promise<number | null>((resolve) => child.once('exit', resolve));
    };
    const waitForMarker = async () => {
      const until = Date.now() + 4000;
      while (!existsSync(marker)) {
        if (Date.now() > until) throw new Error('Runtime not started');
        await Bun.sleep(10);
      }
      unlinkSync(marker);
    };
    const sending = beginWait();
    await waitForMarker();
    const stopped = json(['--socket', socket, 'session', 'stop', id]);
    assert.ok(record(stopped));
    assert.equal(stopped.status, 'stopped');
    assert.equal(await sending, 1);
    assert.ok(Array.isArray(json(['--socket', socket, 'session', 'history', id])));
    const second = beginWait();
    await waitForMarker();
    assert.equal(run(['daemon', 'stop', '--socket', socket]).status, 0);
    assert.equal(await second, 1);
    assert.equal(await daemon.exited, 0);
    daemon = undefined;
    const store = new SqliteSessionStore(db);
    try {
      const current = store.get(id);
      store.save(transitionSession(current, { type: 'begin', at: 'restart' }), current.version);
    } finally {
      store.close();
    }
    daemon = launch();
    await daemon.ready;
    const recovered = json(['--socket', socket, 'session', 'get', id]);
    assert.ok(record(recovered));
    assert.equal(recovered.status, 'failed');
    assert.equal(recovered.providerSessionId, 'provider');
    assert.equal(run(['daemon', 'stop', '--socket', socket]).status, 0);
    assert.equal(await daemon.exited, 0);
    daemon = undefined;
  } finally {
    if (daemon) {
      daemon.child.kill('SIGTERM');
      await daemon.exited;
    }
    for (const child of pending) if (child.exitCode === null) child.kill('SIGTERM');
    rmSync(home, { recursive: true, force: true });
  }
}, 20000);
