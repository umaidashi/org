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

test('Sandbox repo export cancels before starting Git', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(exportSandboxRepo('/missing-repo', controller.signal), {
    name: 'Error',
    message: 'Sandbox execution cancelled',
  });
});

test('Sandbox repo export refuses missing partial-clone blobs without fetching them', async () => {
  const dir = mkdtempSync('/tmp/org-sandbox-partial-');
  const source = dir + '/source';
  const clone = dir + '/clone';
  const git = (...args: string[]) => {
    const result = spawnSync('git', args, {
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH ?? '',
        HOME: process.env.HOME ?? '',
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: '/dev/null',
      },
    });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  const missing = (object: string) => {
    const result = spawnSync('git', ['--no-lazy-fetch', '-C', clone, 'cat-file', '-e', object]);
    assert.notEqual(result.status, 0);
  };
  try {
    git('init', '--quiet', source);
    git('-C', source, 'config', 'uploadpack.allowFilter', 'true');
    writeFileSync(source + '/source.ts', 'export const marker=7;');
    git('-C', source, 'add', 'source.ts');
    git(
      '-C',
      source,
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.invalid',
      'commit',
      '--quiet',
      '-m',
      'Fixture',
    );
    git(
      '-c',
      'protocol.file.allow=always',
      'clone',
      '--quiet',
      '--filter=blob:none',
      '--no-checkout',
      'file://' + source,
      clone,
    );
    git('-C', clone, 'config', 'protocol.file.allow', 'always');
    const object = git('-C', clone, 'rev-parse', 'HEAD:source.ts');
    missing(object);
    await assert.rejects(exportSandboxRepo(clone));
    missing(object);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
