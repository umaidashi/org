import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
test('Schedule CLI publishes a due Event once across worker restarts and preserves enable state', () => {
  const home = mkdtempSync('/tmp/org-schedule-cli-'),
    db = home + '/org.db';
  const run = (args: string[], path = db) =>
    spawnSync(
      process.execPath,
      ['--no-env-file', cli, ...(args[0] === 'daemon' ? [] : ['--direct']), '--db', path, ...args],
      { encoding: 'utf8', timeout: 5000 },
    );
  const json = (args: string[]): unknown => {
    const r = run([...args, '--json']);
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout);
  };
  try {
    const invalid = home + '/absent/org.db';
    for (const value of ['0', '-1', 'Infinity', '1.5']) {
      assert.equal(
        run(
          [
            'schedule',
            'create',
            'Bad',
            '--every-ms',
            value,
            '--start-at',
            '2026-10-05T00:00:00.000Z',
            '--event',
            'schedule.tick',
          ],
          invalid,
        ).status,
        2,
      );
      assert.equal(existsSync(home + '/absent'), false);
    }
    const start = new Date().toISOString();
    const created = json([
      'schedule',
      'create',
      'Pulse',
      '--every-ms',
      '60000',
      '--start-at',
      start,
      '--event',
      'schedule.tick',
      '--payload',
      '{"marker":"pulse"}',
    ]);
    assert.ok(
      created !== null &&
        typeof created === 'object' &&
        'id' in created &&
        typeof created.id === 'string',
    );
    assert.equal(run(['daemon', '--once']).status, 0);
    const events = json(['event', 'list']);
    assert.ok(Array.isArray(events));
    assert.equal(events.length, 1);
    assert.equal(run(['daemon', '--once']).status, 0);
    assert.deepEqual(json(['event', 'list']), events);
    const disabled = json(['schedule', 'disable', created.id]);
    assert.ok(disabled !== null && typeof disabled === 'object' && 'enabled' in disabled);
    assert.equal(disabled.enabled, false);
    assert.equal(run(['daemon', '--once']).status, 0);
    assert.deepEqual(json(['event', 'list']), events);
    assert.deepEqual(json(['schedule', 'get', created.id]), disabled);
    const enabled = json(['schedule', 'enable', created.id]);
    assert.ok(enabled !== null && typeof enabled === 'object' && 'enabled' in enabled);
    assert.equal(enabled.enabled, true);
    assert.equal(run(['daemon', '--once']).status, 0);
    assert.deepEqual(json(['event', 'list']), events);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
