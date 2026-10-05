import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { runProcess } from '../src/runtime/process.js';
import { exportSandboxRepo } from '../src/sandbox/repo.js';

export async function verifyCodeGitHandoff(
  files: readonly { readonly path: string; readonly base64: string }[],
  directory: string,
): Promise<{ readonly base: string; readonly head: string; readonly branch: string }> {
  assert.deepEqual(
    files.map((f) => f.path),
    ['answer.ts', 'answer.test.ts'],
  );
  for (const file of files) {
    const bytes = Buffer.from(file.base64, 'base64');
    assert.ok(bytes.length <= 1048576 && bytes.toString('base64') === file.base64);
  }
  mkdirSync(directory, { mode: 0o700 });
  const repo = directory + '/repo',
    remote = directory + '/remote.git',
    branch = 'org/fixture-code';
  const git = async (args: readonly string[]) => {
    const result = await runProcess({
      argv: [
        'git',
        '-c',
        'core.hooksPath=/dev/null',
        '-c',
        'user.name=Fixture',
        '-c',
        'user.email=fixture@example.invalid',
        ...args,
      ],
      input: '',
      cwd: directory,
      timeoutMs: 10000,
      maxOutputBytes: 65536,
      env: {
        PATH: process.env.PATH ?? '',
        HOME: directory,
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_ALLOW_PROTOCOL: 'file',
        GIT_NO_LAZY_FETCH: '1',
        GIT_TERMINAL_PROMPT: '0',
      },
    });
    assert.equal(result.reason, 'exited');
    assert.equal(result.exitCode, 0, result.stderr);
    return result.stdout.trim();
  };
  await git(['init', '--bare', remote]);
  await git(['init', '--initial-branch=main', repo]);
  writeFileSync(repo + '/README.md', 'Owned local Git handoff fixture\n');
  await git(['-C', repo, 'add', 'README.md']);
  await git(['-C', repo, 'commit', '-m', 'Fixture base']);
  const base = await git(['-C', repo, 'rev-parse', 'HEAD']);
  await git(['-C', repo, 'switch', '-c', branch]);
  for (const file of files)
    writeFileSync(repo + '/' + file.path, Buffer.from(file.base64, 'base64'), { flag: 'wx' });
  await git(['-C', repo, 'add', '--', ...files.map((f) => f.path)]);
  await git(['-C', repo, 'commit', '-m', 'Checked code fixture']);
  const head = await git(['-C', repo, 'rev-parse', 'HEAD']);
  assert.notEqual(head, base);
  assert.equal(await git(['-C', repo, 'rev-parse', 'main']), base);
  assert.equal(await git(['-C', repo, 'status', '--porcelain']), '');
  assert.deepEqual(
    (await git(['-C', repo, 'diff', '--name-only', base, head])).split('\n').sort(),
    ['answer.test.ts', 'answer.ts'],
  );
  const exported = await exportSandboxRepo(repo);
  for (const file of files)
    assert.deepEqual(
      exported.find((f) => f.path === file.path),
      file,
    );
  await git(['-C', repo, 'push', remote, `HEAD:refs/heads/${branch}`]);
  assert.equal(await git(['--git-dir', remote, 'rev-parse', `refs/heads/${branch}`]), head);
  console.log('LOCAL_GIT_HANDOFF_OK');
  return { base, head, branch };
}
