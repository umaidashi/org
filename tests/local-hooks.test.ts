import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { withGitSnapshot } from '../scripts/git-snapshot.js';
import { parsePushUpdates } from '../scripts/push-input.js';

await test('pre-commit reads staged contents even when the worktree contains a passing replacement', () => {
  const root = mkdtempSync(join(tmpdir(), 'org-index-check-'));
  function git(...args: string[]) {
    return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  }
  try {
    git('init', '--quiet');
    writeFileSync(join(root, 'value.txt'), 'staged invalid');
    git('add', 'value.txt');
    writeFileSync(join(root, 'value.txt'), 'unstaged valid');
    let checked: string | undefined;
    assert.throws(
      () =>
        withGitSnapshot(root, { kind: 'index' }, (snapshot) => {
          checked = snapshot;
          assert.equal(readFileSync(join(snapshot, 'value.txt'), 'utf8'), 'staged invalid');
          throw new Error('reject staged invalid');
        }),
      /reject staged invalid/,
    );
    assert.ok(checked);
    const checkedDirectory = checked;
    assert.throws(() => readFileSync(join(checkedDirectory, 'value.txt')));
    assert.equal(readFileSync(join(root, 'value.txt'), 'utf8'), 'unstaged valid');
    assert.equal(git('show', ':value.txt'), 'staged invalid');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

await test('pre-push reads the selected commit rather than staged or working changes', () => {
  const root = mkdtempSync(join(tmpdir(), 'org-commit-check-'));
  function git(...args: string[]) {
    return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  }
  try {
    git('init', '--quiet');
    writeFileSync(join(root, 'value.txt'), 'committed');
    git('add', 'value.txt');
    git(
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.invalid',
      'commit',
      '--quiet',
      '-m',
      'fixture',
    );
    const oid = git('rev-parse', 'HEAD').trim();
    writeFileSync(join(root, 'value.txt'), 'staged');
    git('add', 'value.txt');
    writeFileSync(join(root, 'value.txt'), 'working');
    withGitSnapshot(root, { kind: 'commit', revision: oid }, (snapshot) => {
      assert.equal(readFileSync(join(snapshot, 'value.txt'), 'utf8'), 'committed');
    });
    assert.equal(git('show', ':value.txt'), 'staged');
    assert.equal(readFileSync(join(root, 'value.txt'), 'utf8'), 'working');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

await test('pre-push parses all actual local commits and skips remote deletions', () => {
  const first = '1'.repeat(40);
  const second = '2'.repeat(40);
  const zero = '0'.repeat(40);
  const updates = parsePushUpdates(
    [
      `refs/heads/main ${first} refs/heads/main ${zero}`,
      `refs/heads/topic ${second} refs/heads/topic ${first}`,
      `(delete) ${zero} refs/heads/old ${first}`,
    ].join('\n'),
  );
  assert.deepEqual(updates, [first, second]);
  assert.deepEqual(parsePushUpdates(''), []);
  assert.throws(() => parsePushUpdates('malformed'), /Invalid pre-push/);
  assert.throws(
    () => parsePushUpdates(`refs/heads/main not-an-oid refs/heads/main ${zero}`),
    /Invalid pre-push/,
  );
});

await test('snapshot refuses invalid object ids without running a check', () => {
  const root = mkdtempSync(join(tmpdir(), 'org-invalid-ref-'));
  try {
    execFileSync('git', ['init', '--quiet', root]);
    let called = false;
    assert.throws(
      () =>
        withGitSnapshot(root, { kind: 'commit', revision: '../not-a-ref' }, () => {
          called = true;
        }),
      /full object id/,
    );
    assert.equal(called, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

await test('the actual pre-commit gate blocks bad staged code without modifying the worktree', () => {
  const root = mkdtempSync(join(tmpdir(), 'org-hook-e2e-'));
  const gate = fileURLToPath(new URL('../scripts/local-gate.js', import.meta.url));
  try {
    execFileSync('git', ['init', '--quiet', root]);
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        scripts: {
          'check:static': `node -e "if(require('fs').readFileSync('value.txt','utf8') !== 'valid') process.exit(1)"`,
        },
      }),
    );
    writeFileSync(join(root, 'value.txt'), 'invalid');
    execFileSync('git', ['-C', root, 'add', 'package.json', 'value.txt']);
    writeFileSync(join(root, 'value.txt'), 'valid');
    const failure = spawnSync(process.execPath, [gate, 'pre-commit'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 30_000,
    });
    assert.equal(failure.status, 1, failure.stdout);
    assert.match(failure.stderr, /Local gate failed/);
    assert.equal(readFileSync(join(root, 'value.txt'), 'utf8'), 'valid');
    execFileSync('git', ['-C', root, 'add', 'value.txt']);
    const success = spawnSync(process.execPath, [gate, 'pre-commit'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 30_000,
    });
    assert.equal(success.status, 0, `${success.stdout}\n${success.stderr}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
