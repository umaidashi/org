import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'bun:test';

test('native type checker rejects a bad assignment and accepts a strictly typed module', () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const fixture = mkdtempSync(join(tmpdir(), 'org-tsgo-fixture-'));
  try {
    mkdirSync(join(fixture, 'src'));
    symlinkSync(join(root, 'node_modules'), join(fixture, 'node_modules'), 'dir');
    copyFileSync(join(root, 'tsconfig.json'), join(fixture, 'tsconfig.json'));
    const file = join(fixture, 'src', 'example.ts');
    const args = [
      '--no-env-file',
      join(root, 'node_modules', '@typescript', 'native-preview', 'bin', 'tsgo'),
      '--noEmit',
    ];
    writeFileSync(file, "export const count: number = 'wrong';");
    const red = spawnSync(process.execPath, args, {
      cwd: fixture,
      encoding: 'utf8',
      timeout: 10_000,
    });
    assert.notEqual(red.status, 0);
    assert.match(red.stdout + red.stderr, /TS2322/);
    writeFileSync(file, 'export const count: number = 42;');
    const green = spawnSync(process.execPath, args, {
      cwd: fixture,
      encoding: 'utf8',
      timeout: 10_000,
    });
    assert.equal(green.status, 0, green.stdout + green.stderr);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
