import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { runPublicReview } from '../scripts/public-review.js';
import { runSemanticReview } from '../scripts/semantic-review.js';
import { runProcess } from '../src/runtime/process.js';
export async function checkGeneratedCode(
  files: readonly { readonly path: string; readonly base64: string }[],
): Promise<void> {
  assert.deepEqual(
    files.map((file) => file.path),
    ['answer.ts', 'answer.test.ts'],
  );
  const root = new URL('../', import.meta.url).pathname;
  const directory = mkdtempSync('/tmp/org-generated-gate-');
  const key = randomUUID();
  const image = 'org-generated-gate:' + key;
  const container = 'org-generated-gate-' + key;
  const env = { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' };
  let built = false;
  const docker = (argv: string[], timeoutMs = 180000) =>
    runProcess({
      argv: ['docker', ...argv],
      input: '',
      cwd: directory,
      env,
      timeoutMs,
      maxOutputBytes: 1048576,
    });
  try {
    for (const name of ['src/fixture', 'tests', 'scripts', 'docs', '.jev-lint/rules'])
      mkdirSync(join(directory, name), { recursive: true });
    for (const name of [
      'package.json',
      'bun.lock',
      'bunfig.toml',
      'tsconfig.json',
      '.oxlintrc.json',
      '.oxfmtrc.json',
      'sgconfig.yml',
      '.jev-lint.yaml',
      '.jev-lint/rules/org-functional-core.yml',
      'docs/coding-guidelines.md',
      'tests/quality-ast.test.ts',
    ])
      cpSync(join(root, name), join(directory, name));
    cpSync(join(root, 'quality'), join(directory, 'quality'), { recursive: true });
    const implementation = files[0],
      tests = files[1];
    assert.ok(implementation && tests);
    writeFileSync(
      join(directory, 'src/fixture/domain.ts'),
      Buffer.from(implementation.base64, 'base64'),
    );
    writeFileSync(join(directory, 'src/fixture/answer.ts'), "export * from './domain.js';\n");
    writeFileSync(
      join(directory, 'src/fixture/answer.test.ts'),
      Buffer.from(tests.base64, 'base64'),
    );
    writeFileSync(
      join(directory, 'tests/generated-code.test.ts'),
      "import '../src/fixture/answer.test.js';\n",
    );
    writeFileSync(
      join(directory, 'Dockerfile'),
      'FROM oven/bun@sha256:7608db4aeb44f1fe8169cc8ec7055376b3013557b106407ccf092b00e426407d\nWORKDIR /app\nCOPY package.json bun.lock ./\nRUN bun install --frozen-lockfile --ignore-scripts\nCOPY . .\n',
    );
    const build = await docker(['build', '--tag', image, '.']);
    assert.equal(build.reason, 'exited');
    assert.equal(build.exitCode, 0, build.stderr);
    built = true;
    const checked = await docker([
      'run',
      '--name',
      container,
      '--rm',
      '--network',
      'none',
      '--read-only',
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges',
      '--pids-limit',
      '128',
      '--memory',
      '1g',
      '--cpus',
      '2',
      '--user',
      `${process.getuid?.() ?? 0}:${process.getgid?.() ?? 0}`,
      '--tmpfs',
      '/tmp:rw,nosuid,size=64m,mode=1777',
      '--tmpfs',
      `/workspace:rw,nosuid,size=64m,uid=${process.getuid?.() ?? 0},gid=${process.getgid?.() ?? 0},mode=0700`,
      '--workdir',
      '/workspace',
      image,
      'sh',
      '-c',
      'for name in src tests scripts docs quality .jev-lint package.json bun.lock bunfig.toml tsconfig.json .oxlintrc.json .oxfmtrc.json sgconfig.yml .jev-lint.yaml; do cp -R /app/$name /workspace/; done; ln -s /app/node_modules /workspace/node_modules; bun run format && bun run check',
    ]);
    assert.equal(checked.reason, 'exited');
    assert.equal(checked.exitCode, 0, checked.stdout + checked.stderr);
    assert.match(checked.stderr, /\b[1-9][0-9]* pass\b/);
    assert.match(checked.stderr, /\b0 fail\b/);
    assert.ok((checked.stdout + checked.stderr).includes('every architecture rule fixture runs'));
    assert.ok(checked.stdout.includes('src/fixture/domain.ts'));
    console.log('GENERATED_BUN_CHECK_OK');
    runPublicReview(directory, root);
    symlinkSync(join(root, 'node_modules'), join(directory, 'node_modules'));
    runSemanticReview(directory, root, ['src/fixture/domain.ts', 'src/fixture/answer.test.ts']);
    console.log('GENERATED_SEMANTIC_REVIEW_OK');
  } finally {
    if (built) {
      const stopped = await docker(['rm', '--force', container], 30000);
      assert.ok(
        stopped.exitCode === 0 || stopped.stderr.includes('No such container'),
        'Generated gate container cleanup failed',
      );
      const removed = await docker(['image', 'rm', image], 30000);
      assert.equal(removed.exitCode, 0, removed.stderr);
    }
    rmSync(directory, { recursive: true, force: true });
  }
}
