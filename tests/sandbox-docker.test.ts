import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { runDockerSandbox } from '../src/sandbox/docker.js';
import type { ProcessInput } from '../src/runtime/process.js';
test('Docker Sandbox bounds the container and destroys only its successfully created ID', async () => {
  const calls: ProcessInput[] = [];
  const id = 'a'.repeat(64);
  const run = async (input: ProcessInput) => {
    calls.push(input);
    return {
      reason: 'exited' as const,
      exitCode: 0,
      stdout:
        input.argv[1] === 'create'
          ? id + '\n'
          : input.argv.includes('/workspace/.org-execution.ts')
            ? '7\n'
            : '',
      stderr: '',
    };
  };
  const result = await runDockerSandbox(
    run,
    { executable: 'docker', env: { PATH: '/bin' }, cwd: '/tmp', uid: 501, gid: 20 },
    { code: 'console.log(7)', files: [], writable: false, timeoutMs: 1000, maxOutputBytes: 4096 },
  );
  assert.equal(result.stdout, '7\n');
  assert.ok(calls[0]?.argv.includes('--network=none'));
  assert.ok(calls[0]?.argv.includes('--read-only'));
  assert.ok(calls[0]?.argv.includes('--cap-drop=ALL'));
  assert.deepEqual(calls.at(-1)?.argv, ['docker', 'rm', '--force', id]);
  assert.ok(!calls.some((c) => c.argv.some((a) => a.startsWith('--volume'))));
});
test('Docker creation failure never deletes an existing container name', async () => {
  const calls: ProcessInput[] = [];
  await assert.rejects(
    runDockerSandbox(
      async (input) => {
        calls.push(input);
        return { reason: 'exited', exitCode: 1, stdout: '', stderr: 'conflict' };
      },
      { executable: 'docker', env: {}, cwd: '/tmp', uid: 501, gid: 20 },
      { code: 'console.log(7)', files: [], writable: false, timeoutMs: 1000, maxOutputBytes: 4096 },
    ),
    /create/,
  );
  assert.equal(calls.length, 1);
});
