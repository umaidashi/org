import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

await test('every architecture rule fixture runs and detects its planted violations', () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const fixtures = readdirSync(join(root, 'quality', 'ast', 'tests')).filter((file) =>
    file.endsWith('.yml'),
  );
  assert.ok(fixtures.length > 0, 'AST gate must have fixtures');
  const result = spawnSync(
    join(root, 'node_modules', '.bin', 'ast-grep'),
    ['test', '--skip-snapshot-tests', '--color', 'never'],
    { cwd: root, encoding: 'utf8', timeout: 10_000 },
  );
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.doesNotMatch(result.stdout + result.stderr, /Configuration not found/);
  assert.match(
    result.stdout,
    new RegExp(`test result: ok\\. ${fixtures.length} passed; 0 failed;`),
  );
});
