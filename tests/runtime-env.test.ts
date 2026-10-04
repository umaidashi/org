import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'bun:test';

test('project Bun configuration prevents dotenv autoload while explicit loading remains possible', () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const fixture = mkdtempSync(join(tmpdir(), 'org-env-policy-'));
  try {
    if (existsSync(join(root, 'bunfig.toml')))
      copyFileSync(join(root, 'bunfig.toml'), join(fixture, 'bunfig.toml'));
    writeFileSync(join(fixture, '.env'), 'ORG_ENV_ISOLATION_PROBE=sentinel-value\n');
    const code = 'process.stdout.write(process.env.ORG_ENV_ISOLATION_PROBE ?? "absent")';
    const result = spawnSync(process.execPath, ['-e', code], { cwd: fixture, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, 'absent');
    const explicit = spawnSync(process.execPath, ['--env-file=.env', '-e', code], {
      cwd: fixture,
      encoding: 'utf8',
    });
    assert.equal(explicit.stdout, 'sentinel-value');
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
