import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'bun:test';
import { runSemanticReview } from '../scripts/semantic-review.js';

test('semantic process runner rejects exit failures and incomplete or malformed output', () => {
  const root = mkdtempSync(join(tmpdir(), 'org-semantic-process-'));
  const cli = join(root, 'node_modules', 'jev-lint', 'dist', 'cli.js');
  mkdirSync(join(root, 'node_modules', 'jev-lint', 'dist'), { recursive: true });
  try {
    for (const source of [
      'process.exit(1);',
      'console.log("invalid JSON");',
      'console.log(JSON.stringify({ findings: [{severity:"warning"}], stats:{subjects:2,missing:1},errors:["network failure"],degraded:[] }));',
    ]) {
      writeFileSync(cli, source);
      assert.throws(() => runSemanticReview(root, root));
    }
    writeFileSync(
      cli,
      'console.log(JSON.stringify({ findings: [{severity:"warning"}], stats:{subjects:2,missing:0},errors:[],degraded:[] }));',
    );
    assert.doesNotThrow(() => runSemanticReview(root, root));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
