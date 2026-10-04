import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'bun:test';
import { publicHistoryFiles } from '../scripts/public-history.js';
import { checkPublicFiles } from '../scripts/public-content.js';
import { runPublicReview } from '../scripts/public-review.js';

test('public history gate catches a credential removed from the ref tip', () => {
  const root = mkdtempSync(join(tmpdir(), 'org-public-history-'));
  function git(...args: string[]) {
    return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  }
  try {
    git('init', '--quiet');
    writeFileSync(join(root, '.env'), 'KEY=private-value\n');
    git('add', '.env');
    git(
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.invalid',
      'commit',
      '-qm',
      'add credential',
    );
    unlinkSync(join(root, '.env'));
    writeFileSync(join(root, 'README.md'), 'Safe tip');
    git('add', '-A');
    git(
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.invalid',
      'commit',
      '-qm',
      'remove credential',
    );
    assert.throws(
      () => checkPublicFiles(publicHistoryFiles(root, [git('rev-parse', 'HEAD').trim()]), []),
      /Credential file/,
    );
    git('update-ref', 'refs/remotes/private/main', git('rev-parse', 'HEAD~1').trim());
    assert.throws(
      () => checkPublicFiles(publicHistoryFiles(root, [git('rev-parse', 'HEAD').trim()]), []),
      /Credential file/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('history-only public review does not read an unstaged deletion from the worktree', () => {
  const root = mkdtempSync(join(tmpdir(), 'org-public-isolation-'));
  function git(...args: string[]) {
    return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  }
  try {
    git('init', '--quiet');
    writeFileSync(join(root, 'README.md'), 'Safe committed contents');
    git('add', 'README.md');
    git(
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.invalid',
      'commit',
      '-qm',
      'safe commit',
    );
    const revision = git('rev-parse', 'HEAD').trim();
    unlinkSync(join(root, 'README.md'));
    assert.doesNotThrow(() => runPublicReview(root, root, [revision]));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
