import assert from 'node:assert/strict';
import { isDocumentationOnlyTree } from '../scripts/documentation-tree.js';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'bun:test';
import { fileURLToPath } from 'node:url';
import { withGitSnapshot } from '../scripts/git-snapshot.js';
import { parsePushUpdates } from '../scripts/push-input.js';

test('pre-commit reads staged contents even when the worktree contains a passing replacement', () => {
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

test('pre-push reads the selected commit rather than staged or working changes', () => {
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

test('pre-push parses all actual local commits and skips remote deletions', () => {
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

test('snapshot refuses invalid object ids without running a check', () => {
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

test('the actual pre-commit gate blocks bad staged code without modifying the worktree', () => {
  const root = mkdtempSync(join(tmpdir(), 'org-hook-e2e-'));
  const gate = fileURLToPath(new URL('../scripts/local-gate.ts', import.meta.url));
  try {
    execFileSync('git', ['init', '--quiet', root]);
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        scripts: {
          'check:static': `bun -e "if(require('fs').readFileSync('value.txt','utf8') !== 'valid') process.exit(1)"`,
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

test('documentation-only bootstrap trees skip runtime gates but source trees require a manifest', () => {
  const root = mkdtempSync(join(tmpdir(), 'org-bootstrap-gate-'));
  try {
    writeFileSync(join(root, 'AGENTS.md'), 'Development instructions');
    assert.equal(isDocumentationOnlyTree(root), true);
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'src', 'cli.ts'), 'export const value = 1;');
    assert.equal(isDocumentationOnlyTree(root), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('configured pre-push job executes even when the pushed revision contains documentation only', () => {
  const project = fileURLToPath(new URL('../', import.meta.url));
  const root = mkdtempSync(join(tmpdir(), 'org-lefthook-push-'));
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  try {
    git('init', '--quiet');
    writeFileSync(join(root, 'README.md'), 'Documentation-only bootstrap');
    git('add', 'README.md');
    git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'docs');
    const revision = git('rev-parse', 'HEAD').trim();
    writeFileSync(join(root, 'lefthook.yml'), readFileSync(join(project, 'lefthook.yml')));
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        scripts: { 'hook:push': 'bun --no-env-file scripts/local-gate.ts pre-push' },
      }),
    );
    symlinkSync(join(project, 'scripts'), join(root, 'scripts'), 'dir');
    symlinkSync(join(project, 'node_modules'), join(root, 'node_modules'), 'dir');
    const result = spawnSync(
      process.execPath,
      [
        '--no-env-file',
        join(project, 'node_modules', 'lefthook', 'bin', 'index.js'),
        'run',
        'pre-push',
      ],
      {
        cwd: root,
        encoding: 'utf8',
        timeout: 20_000,
        input: `refs/heads/main ${revision} refs/heads/main ${'0'.repeat(40)}\n`,
      },
    );
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout + result.stderr, new RegExp(`Verifying committed tree ${revision}`));
    assert.match(result.stdout + result.stderr, /Documentation-only bootstrap tree/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
