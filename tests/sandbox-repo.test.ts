import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { exportSandboxRepo } from '../src/sandbox/repo.js';
test('Sandbox exports committed regular files, excluding environment and untracked data', async () => {
  const dir = mkdtempSync('/tmp/org-sandbox-repo-');
  const git = (...args: string[]) => {
    const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
  };
  try {
    git('init', '--quiet');
    writeFileSync(dir + '/source.ts', 'export const marker=7;');
    writeFileSync(dir + '/.env', 'fixture-secret');
    git('add', 'source.ts', '.env');
    git(
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.invalid',
      'commit',
      '--quiet',
      '-m',
      'Fixture',
    );
    writeFileSync(dir + '/source.ts', 'uncommitted');
    writeFileSync(dir + '/untracked.txt', 'private');
    const files = await exportSandboxRepo(dir);
    assert.deepEqual(files, [
      { path: 'source.ts', base64: Buffer.from('export const marker=7;').toString('base64') },
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
