import { cli } from './cli-path.js';
import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';

test('real CLI logs reads immutable approval Audit and rejects invalid filters before creating a database', () => {
  const home = mkdtempSync('/tmp/org-logs-');
  const run = (args: string[], db = home + '/org.db') =>
    spawnSync(process.execPath, ['--no-env-file', cli, '--direct', '--db', db, ...args], {
      encoding: 'utf8',
      timeout: 5000,
    });
  try {
    const initial = run(['logs', '--json']);
    assert.equal(initial.status, 0, initial.stderr);
    assert.deepEqual(JSON.parse(initial.stdout), []);
    const request = run([
      'approval',
      'request-workflow',
      'workflow',
      '--key',
      'request',
      '--actor',
      'founder',
      '--host',
      'http://localhost:5678',
      '--input-digest',
      'a'.repeat(64),
      '--request-id',
      'invoke',
      '--effect',
      'write',
      '--json',
    ]);
    assert.equal(request.status, 0, request.stderr);
    const full = run(['audit', 'list', '--json']);
    const logs = run(['logs', '--limit', '1', '--json']);
    assert.equal(logs.status, 0, logs.stderr);
    assert.deepEqual(JSON.parse(logs.stdout), JSON.parse(full.stdout));
    const filtered = run(['logs', '--task', 'missing', '--json']);
    assert.equal(filtered.status, 0, filtered.stderr);
    assert.deepEqual(JSON.parse(filtered.stdout), []);
    for (const args of [
      ['--limit', '0'],
      ['--limit', '1.5'],
      ['--limit', '1001'],
      ['--task', ''],
      ['extra'],
      ['--reason', 'body'],
    ]) {
      assert.equal(run(['logs', ...args], home + '/absent/db').status, 2);
      assert.equal(existsSync(home + '/absent'), false);
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
