import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { cli } from './cli-path.js';
test('native CLI consolidates exact Room Memory with stable receipt, retains evidence and rejects invalid requests before DB creation', () => {
  const home = mkdtempSync('/tmp/org-memory-consolidation-cli-'),
    db = home + '/org.db';
  const raw = (args: string[], path = db) =>
    spawnSync(process.execPath, ['--no-env-file', cli, '--direct', '--db', path, ...args], {
      encoding: 'utf8',
      timeout: 10000,
    });
  const run = (args: string[]): unknown => {
    const p = raw([...args, '--json']);
    assert.equal(p.status, 0, p.stderr);
    return JSON.parse(p.stdout);
  };
  const id = (value: unknown): string => {
    assert.ok(value && typeof value === 'object' && 'id' in value && typeof value.id === 'string');
    return value.id;
  };
  try {
    const invalid = home + '/uncreated/org.db';
    assert.equal(
      raw(
        [
          'memory',
          'consolidate',
          '--scope',
          'unknown',
          '--key',
          'first',
          '--at',
          '2026-10-06T00:00:00.000Z',
        ],
        invalid,
      ).status,
      2,
    );
    assert.equal(existsSync(home + '/uncreated'), false);
    assert.equal(
      raw(['agent', 'create', 'worker', '--role', 'work', '--runtime', 'codex']).status,
      0,
    );
    const agents = run(['agent', 'list']);
    assert.ok(Array.isArray(agents));
    const roomId = id(
      run([
        'room',
        'create',
        'work',
        '--type',
        'direct',
        '--human',
        'founder',
        '--agent',
        id(agents[0]),
      ]),
    );
    const messageId = id(
      run(['room', 'send', roomId, '--human', 'founder', '--content', 'Use SQLite']),
    );
    const capture = [
      'memory',
      'capture',
      '--type',
      'semantic',
      '--scope',
      'room:' + roomId,
      '--content',
      'Use SQLite',
      '--confidence',
      '1',
      '--room',
      roomId,
      '--message',
      messageId,
    ];
    const first = run(capture),
      second = run(capture);
    const args = [
      'memory',
      'consolidate',
      '--scope',
      'room:' + roomId,
      '--key',
      'first',
      '--at',
      '2026-10-06T00:00:00.000Z',
    ];
    const receipt = run(args);
    assert.ok(
      receipt && typeof receipt === 'object' && 'keepers' in receipt && 'invalidated' in receipt,
    );
    assert.deepEqual(receipt.keepers, [id(first)]);
    assert.deepEqual(receipt.invalidated, [id(second)]);
    assert.deepEqual(run(args), receipt);
    const duplicate = run(['memory', 'get', id(second)]);
    assert.ok(
      duplicate &&
        typeof duplicate === 'object' &&
        'status' in duplicate &&
        'sourceRefs' in duplicate,
    );
    assert.equal(duplicate.status, 'invalidated');
    assert.deepEqual(duplicate.sourceRefs, [{ roomId, messageId }]);
    const active = run([
      'memory',
      'list',
      '--scope',
      'room:' + roomId,
      '--at',
      '2026-10-06T00:00:00.000Z',
    ]);
    assert.ok(Array.isArray(active));
    assert.equal(active.length, 1);
    const taskId = id(
      run(['task', 'create', 'Memory scope fixture', '--objective', 'Verify consolidation']),
    );
    for (const scope of [
      'global',
      'company',
      'department:engineering',
      'project:kernel',
      'agent:' + id(agents[0]),
      'task:' + taskId,
    ]) {
      const scopedCapture = [...capture];
      scopedCapture[5] = scope;
      const keeper = id(run(scopedCapture)),
        obsolete = id(run(scopedCapture));
      const scopedArgs = [
        'memory',
        'consolidate',
        '--scope',
        scope,
        '--key',
        'manual:' + scope,
        '--at',
        '2026-10-06T00:00:00.000Z',
      ];
      const scopedReceipt = run(scopedArgs);
      assert.ok(
        scopedReceipt &&
          typeof scopedReceipt === 'object' &&
          'keepers' in scopedReceipt &&
          'invalidated' in scopedReceipt,
      );
      assert.deepEqual(scopedReceipt.keepers, [keeper]);
      assert.deepEqual(scopedReceipt.invalidated, [obsolete]);
      assert.deepEqual(run(scopedArgs), scopedReceipt);
      assert.deepEqual(run(['memory', 'consolidations', '--scope', scope]), [scopedReceipt]);
    }
    for (const scope of ['agent:missing', 'task:missing']) {
      const missing = raw([
        'memory',
        'consolidate',
        '--scope',
        scope,
        '--key',
        'missing:' + scope,
        '--at',
        '2026-10-06T00:00:00.000Z',
      ]);
      assert.equal(missing.status, 1, missing.stderr);
      assert.deepEqual(run(['memory', 'consolidations', '--scope', scope]), []);
    }
    for (const key of ['nightly-memory:manual', 'nightly-scoped-memory:manual'])
      assert.equal(
        raw([
          'memory',
          'consolidate',
          '--scope',
          'company',
          '--key',
          key,
          '--at',
          '2026-10-06T00:00:00.000Z',
        ]).status,
        2,
      );
    const originals = run(['room', 'messages', roomId]);
    assert.ok(Array.isArray(originals));
    assert.equal(originals.length, 1);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
