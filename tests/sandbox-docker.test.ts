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

test('Docker credential transport uses stdin only and rejects reflected values before returning artifacts', async () => {
  const calls: ProcessInput[] = [];
  const secret = 'synthetic-private-credential-701';
  const host = {
    executable: 'docker',
    env: {},
    cwd: '/tmp',
    uid: 501,
    gid: 20,
    credentials: { SERVICE_TOKEN: secret },
  };
  const input = {
    code: 'console.log(7)',
    files: [],
    writable: false,
    timeoutMs: 1000,
    maxOutputBytes: 4096,
  };
  const result = await runDockerSandbox(
    async (request) => {
      calls.push(request);
      return {
        reason: 'exited',
        exitCode: 0,
        stdout: request.argv[1] === 'create' ? 'a'.repeat(64) : '',
        stderr: '',
      };
    },
    host,
    input,
  );
  assert.equal(result.exitCode, 0);
  const injected = calls.filter((request) => request.input.includes(secret));
  assert.equal(injected.length, 1);
  assert.ok(injected[0]?.argv.includes('-i'));
  for (const request of calls) {
    assert.ok(!JSON.stringify(request.argv).includes(secret));
    assert.ok(!JSON.stringify(request.env).includes(secret));
  }
  await assert.rejects(
    runDockerSandbox(
      async (request) => ({
        reason: 'exited',
        exitCode: 0,
        stdout:
          request.argv[1] === 'create'
            ? 'b'.repeat(64)
            : request.input.includes(secret)
              ? secret
              : '',
        stderr: '',
      }),
      host,
      input,
    ),
    /credential output rejected/,
  );
});

test('Docker credential guard covers cleanup process exceptions as well as stdout and stderr', async () => {
  const secret = 'synthetic-cleanup-private-token-704';
  await assert.rejects(
    runDockerSandbox(
      async (request) => {
        if (request.argv[1] === 'rm') throw new Error(secret);
        return {
          reason: 'exited',
          exitCode: 0,
          stdout: request.argv[1] === 'create' ? 'c'.repeat(64) : '',
          stderr: '',
        };
      },
      {
        executable: 'docker',
        env: {},
        cwd: '/tmp',
        uid: 501,
        gid: 20,
        credentials: { SERVICE_TOKEN: secret },
      },
      { code: 'console.log(7)', writable: false, files: [], timeoutMs: 1000, maxOutputBytes: 4096 },
    ),
    /credential output rejected/,
  );
});
