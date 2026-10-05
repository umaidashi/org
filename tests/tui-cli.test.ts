import { cli } from './cli-path.js';
import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';

test('real TUI CLI requires a terminal and rejects direct or extra arguments without database creation', () => {
  const home = mkdtempSync('/tmp/org-tui-cli-');
  const db = home + '/absent/org.db';
  const run = (args: string[]) =>
    spawnSync(process.execPath, ['--no-env-file', cli, '--db', db, ...args], {
      encoding: 'utf8',
      timeout: 5000,
    });
  try {
    const noTerminal = run(['tui']);
    assert.equal(noTerminal.status, 1, noTerminal.stderr);
    assert.match(noTerminal.stderr, /interactive terminal/);
    for (const args of [
      ['--direct', 'tui'],
      ['tui', 'extra'],
      ['tui', '--json'],
    ])
      assert.equal(run(args).status, 2);
    assert.equal(existsSync(home + '/absent'), false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
