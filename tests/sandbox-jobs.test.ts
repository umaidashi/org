import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { parseSandboxCommand, runSandboxCommand } from '../src/sandbox/cli.js';
import { SandboxJobs } from '../src/sandbox/jobs.js';
test('Sandbox slot cancels only its Task, drains before shutdown and rejects new launches', async () => {
  const jobs = new SandboxJobs();
  assert.deepEqual(jobs.list(), []);
  let stopped = false;
  const active = jobs.run('task', async (signal) => {
    await new Promise<void>((resolve) =>
      signal.addEventListener('abort', () => resolve(), { once: true }),
    );
    await Promise.resolve();
    stopped = true;
  });
  await assert.rejects(
    jobs.run('other', async () => {}),
    /busy/,
  );
  assert.throws(() => jobs.cancel('other'), /not running/);
  assert.equal(stopped, false);
  const snapshot = jobs.list();
  assert.deepEqual(snapshot, [{ taskId: 'task', state: 'running' }]);
  jobs.cancel('task');
  assert.deepEqual(snapshot, [{ taskId: 'task', state: 'running' }]);
  assert.deepEqual(jobs.list(), [{ taskId: 'task', state: 'cancelling' }]);
  await active;
  assert.deepEqual(jobs.list(), []);
  assert.equal(stopped, true);
  const running = jobs.run('second', async (signal) => {
    await new Promise<void>((resolve) =>
      signal.addEventListener('abort', () => resolve(), { once: true }),
    );
  });
  await Promise.resolve();
  await jobs.shutdown();
  await running;
  await assert.rejects(
    jobs.run('third', async () => {}),
    /shut down/,
  );
});
test('Sandbox slot releases a failed job so a later Task can run', async () => {
  const jobs = new SandboxJobs();
  await assert.rejects(
    jobs.run('failed', async () => {
      throw new Error('fixture failure');
    }),
    /fixture failure/,
  );
  let called = false;
  await jobs.run('next', async () => {
    called = true;
  });
  assert.equal(called, true);
  await jobs.shutdown();
  const failing = new SandboxJobs();
  const active = failing.run('cleanup', async (signal) => {
    await new Promise<void>((resolve) =>
      signal.addEventListener('abort', () => resolve(), { once: true }),
    );
    throw new Error('cleanup failure');
  });
  const failure = assert.rejects(active, /cleanup failure/);
  await Promise.resolve();
  await assert.rejects(failing.shutdown(), /cleanup failure/);
  await failure;
});

test('Sandbox list accepts no target or execution options and refuses direct execution without touching Docker', async () => {
  const command = parseSandboxCommand([
    'sandbox',
    'list',
    '--db',
    '/tmp/org-sandbox-list-parse.db',
    '--json',
  ]);
  assert.equal(command.action, 'list');
  for (const args of [
    ['sandbox', 'list', 'task'],
    ['sandbox', 'list', '--code', 'secret'],
    ['sandbox', 'list', '--repo', '/tmp'],
    ['sandbox', 'list', '--timeout-ms', '1'],
  ])
    assert.throws(() => parseSandboxCommand(args));
  await assert.rejects(
    () =>
      runSandboxCommand(command, () => {
        throw Error('unexpected output');
      }),
    /requires daemon/,
  );
});
