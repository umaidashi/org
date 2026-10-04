import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

await test('lint rejects unsafe generated code and infrastructure imports in domain code', () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const code = `import { readFileSync } from 'node:fs';
export function readGeneratedInput(input: any) { return readFileSync(input); }`;
  const result = spawnSync(
    process.execPath,
    [
      join(root, 'node_modules', 'eslint', 'bin', 'eslint.js'),
      '--stdin',
      '--stdin-filename',
      'src/agents/domain.ts',
      '--format',
      'json',
    ],
    { cwd: root, input: code, encoding: 'utf8', timeout: 10_000 },
  );
  assert.equal(result.status, 1, result.stderr);
  const report: unknown = JSON.parse(result.stdout);
  assert.ok(Array.isArray(report));
  const messages = String(result.stdout);
  assert.match(messages, /no-restricted-imports/);
  assert.match(messages, /no-explicit-any/);
  assert.match(messages, /no-unsafe-argument/);
});

await test('lint accepts a pure function with explicit typed inputs', () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const result = spawnSync(
    process.execPath,
    [
      join(root, 'node_modules', 'eslint', 'bin', 'eslint.js'),
      '--stdin',
      '--stdin-filename',
      'src/agents/domain.ts',
    ],
    {
      cwd: root,
      input: 'export function label(name: string): string { return name.trim(); }',
      encoding: 'utf8',
      timeout: 10_000,
    },
  );
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});
