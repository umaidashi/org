import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { verifyCodeGitHandoff } from './code-git-handoff.js';
test('native Git handoff commits exact checked files on a branch and leaves fixture main unchanged', async () => {
  const home = mkdtempSync('/tmp/org-code-git-');
  try {
    await assert.rejects(() =>
      verifyCodeGitHandoff(
        [
          { path: '../outside', base64: 'eA==' },
          { path: 'answer.test.ts', base64: 'eA==' },
        ],
        home + '/invalid',
      ),
    );
    assert.equal(existsSync(home + '/invalid'), false);
    const result = await verifyCodeGitHandoff(
      [
        {
          path: 'answer.ts',
          base64: Buffer.from('export const answer = 42;\n').toString('base64'),
        },
        {
          path: 'answer.test.ts',
          base64: Buffer.from('// checked test fixture\n').toString('base64'),
        },
      ],
      home + '/valid',
    );
    assert.notEqual(result.head, result.base);
    assert.equal(result.branch, 'org/fixture-code');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}, 20000);
