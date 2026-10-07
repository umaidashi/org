import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { cli } from './cli-path.js';
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
test('opt-in native daemon consolidates allowed active Room once daily and restart preserves receipt and new same-day records', async () => {
  const home = mkdtempSync('/tmp/org-memory-nightly-cli-'),
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
    assert.ok(record(v) && typeof v.id === 'string');
    return v.id;
  };
  const list = (args: string[], remote = false): readonly unknown[] => {
    const v = run(args, remote);
    assert.ok(Array.isArray(v));
    return v;
  };
  let daemon: ReturnType<typeof spawn> | undefined, exited: Promise<unknown> | undefined;
  try {
    run(['agent', 'create', 'worker', '--role', 'work', '--runtime', 'codex']);
    const agentId = id(list(['agent', 'list'])[0]);
    const room = (name: string) =>
      id(
        run(['room', 'create', name, '--type', 'direct', '--human', 'founder', '--agent', agentId]),
      );
    const target = room('target'),
      excluded = room('excluded'),
      archived = room('archived');
    const source = new Map<string, string>();
    const capture = (roomId: string, remote = false, scope = 'room:' + roomId) =>
      run(
        [
          'memory',
          'capture',
          '--type',
          'semantic',
          '--scope',
          scope,
          '--content',
          'Use SQLite',
          '--confidence',
          '1',
          '--room',
          roomId,
          '--message',
          source.get(roomId) ?? 'missing',
        ],
        remote,
      );
    for (const roomId of [target, excluded, archived]) {
      source.set(
        roomId,
        id(run(['room', 'send', roomId, '--human', 'founder', '--content', 'Use SQLite'])),
      );
      capture(roomId);
      capture(roomId);
    }
    for (const scope of ['department:engineering', 'project:excluded']) {
      capture(target, false, scope);
      capture(target, false, scope);
    }
    run(['room', 'archive', archived]);
    const start = async () => {
      daemon = spawn(process.execPath, [
        '--no-env-file',
        cli,
        '--db',
        db,
        'daemon',
        '--socket',
        socket,
        '--memory-consolidation-room',
        target,
        '--memory-consolidation-room',
        archived,
        '--memory-consolidation-scope',
        'department:engineering',
        '--poll-interval',
        '50',
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
    };
    await start();
    const receipts = list(['memory', 'consolidations', '--scope', 'room:' + target], true);
    assert.equal(receipts.length, 1);
    const receipt = receipts[0];
    assert.ok(record(receipt) && typeof receipt.key === 'string');
    assert.match(receipt.key, /^nightly-memory:[a-f0-9]{64}:\d{4}-\d{2}-\d{2}$/);
    assert.deepEqual(list(['memory', 'consolidations', '--scope', 'room:' + excluded], true), []);
    assert.deepEqual(list(['memory', 'consolidations', '--scope', 'room:' + archived], true), []);
    const active = (roomId: string) =>
      list(['memory', 'list', '--scope', 'room:' + roomId, '--at', new Date().toISOString()], true);
    assert.equal(active(target).length, 1);
    assert.equal(active(excluded).length, 2);
    assert.equal(active(archived).length, 2);
    const scopedReceipts = list(
      ['memory', 'consolidations', '--scope', 'department:engineering'],
      true,
    );
    assert.equal(scopedReceipts.length, 1);
    assert.ok(record(scopedReceipts[0]) && typeof scopedReceipts[0].key === 'string');
    assert.match(scopedReceipts[0].key, /^nightly-scoped-memory:[a-f0-9]{64}:\d{4}-\d{2}-\d{2}$/);
    assert.deepEqual(list(['memory', 'consolidations', '--scope', 'project:excluded'], true), []);
    assert.equal(
      list(
        ['memory', 'list', '--scope', 'department:engineering', '--at', new Date().toISOString()],
        true,
      ).length,
      1,
    );
    const scopedFresh = id(capture(target, true, 'department:engineering'));
    const fresh = id(capture(target, true));
    await Bun.sleep(200);
    assert.equal(active(target).length, 2);
    run(['daemon', 'stop'], true);
    await exited;
    daemon = undefined;
    await start();
    await Bun.sleep(100);
    assert.deepEqual(
      list(['memory', 'consolidations', '--scope', 'room:' + target], true),
      receipts,
    );
    assert.deepEqual(
      list(['memory', 'consolidations', '--scope', 'department:engineering'], true),
      scopedReceipts,
    );
    const scopedRecord = run(['memory', 'get', scopedFresh], true);
    assert.ok(record(scopedRecord));
    assert.equal(scopedRecord.status, 'active');
    const freshRecord = run(['memory', 'get', fresh], true);
    assert.ok(record(freshRecord));
    assert.equal(freshRecord.status, 'active');
    assert.equal(list(['room', 'messages', target], true).length, 1);
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
