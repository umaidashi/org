import { cli } from './cli-path.js';
import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
test('CLI saves exact Workflow approval, exposes human decision and Audit, and refuses capability apply', () => {
  const home = mkdtempSync('/tmp/org-workflow-approval-cli-'),
    db = home + '/org.db';
  const run = (args: string[]) =>
    spawnSync(process.execPath, ['--no-env-file', cli, '--direct', '--db', db, ...args, '--json'], {
      encoding: 'utf8',
      timeout: 5000,
    });
  const json = (args: string[]): unknown => {
    const result = run(args);
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  const args = [
    'approval',
    'request-workflow',
    'flow',
    '--key',
    'operation',
    '--actor',
    'founder',
    '--host',
    'https://n8n.example',
    '--input-digest',
    'a'.repeat(64),
    '--request-id',
    'workflow:approved:one',
    '--effect',
    'write',
  ];
  try {
    const invalid = [...args];
    invalid[invalid.indexOf('--input-digest') + 1] = 'invalid';
    assert.equal(run(invalid).status, 2);
    assert.equal(existsSync(db), false);
    const request = json(args);
    assert.ok(record(request) && typeof request.id === 'string');
    assert.deepEqual(json(args), request);
    assert.equal(run(['approval', 'apply', request.id, '--actor', 'founder']).status, 1);
    json([
      'approval',
      'decide',
      request.id,
      '--actor',
      'founder',
      '--decision',
      'approve',
      '--reason',
      'Verified exact operation',
    ]);
    const audit = json(['audit', 'list']);
    assert.ok(Array.isArray(audit));
    assert.deepEqual(
      audit.map((v: unknown) => {
        assert.ok(record(v));
        return v.result;
      }),
      ['pending', 'approved'],
    );
    assert.equal(run(['approval', 'apply', request.id, '--actor', 'founder']).status, 1);
    assert.equal(
      run([
        'approval',
        'decide',
        request.id,
        '--actor',
        'founder',
        '--decision',
        'reject',
        '--reason',
        'Changed',
      ]).status,
      1,
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}, 15000);
