import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'bun:test';
import { fileURLToPath } from 'node:url';

function lint(code: string) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const fixture = mkdtempSync(join(tmpdir(), 'org-oxlint-fixture-'));
  try {
    mkdirSync(join(fixture, 'src', 'agents'), { recursive: true });
    symlinkSync(join(root, 'node_modules'), join(fixture, 'node_modules'), 'dir');
    copyFileSync(join(root, '.oxlintrc.json'), join(fixture, '.oxlintrc.json'));
    copyFileSync(join(root, 'tsconfig.json'), join(fixture, 'tsconfig.json'));
    writeFileSync(join(fixture, 'src', 'agents', 'domain.ts'), code);
    return spawnSync(
      process.execPath,
      [
        join(root, 'node_modules', 'oxlint', 'bin', 'oxlint'),
        '--type-aware',
        'src/agents/domain.ts',
        '--format',
        'json',
      ],
      { cwd: fixture, encoding: 'utf8', timeout: 20_000 },
    );
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}
test('lint rejects unsafe generated code and infrastructure imports in domain code', () => {
  const result = lint(`import { readFileSync } from 'node:fs';
export function readGeneratedInput(input: any) { return readFileSync(input); }`);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stdout, /no-restricted-imports/);
  assert.match(result.stdout, /no-explicit-any/);
  assert.match(result.stdout, /no-unsafe-argument/);
});
test('lint accepts a pure function with explicit typed inputs', () => {
  const result = lint('export function label(name: string): string { return name.trim(); }');
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});
